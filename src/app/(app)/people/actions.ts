"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthState } from "@/lib/auth";
import { env } from "@/lib/env";
import { friendlyError, intId, str, type ActionState } from "@/lib/actions";

/**
 * The only module that touches the service-role key. Every entry point first
 * proves the caller holds users.manage through their own (RLS-bound) session,
 * and every privileged step is written to the audit log.
 */
async function requireManager() {
  const state = await getAuthState();
  if (state.kind !== "member" || !state.me.permissions.includes("users.manage")) {
    throw new Error("You do not have permission to manage accounts.");
  }
  return state.me;
}

async function audit(actorId: string, action: string, rowId: string, note?: string, data?: Record<string, unknown>) {
  const admin = createAdminClient();
  await admin.from("audit_log").insert({
    actor_id: actorId,
    actor_kind: "server",
    action,
    table_name: "auth.users",
    row_id: rowId,
    note: note ?? null,
    new_data: data ?? null,
  });
}

function bump() {
  revalidatePath("/people");
  revalidatePath("/audit");
}

const createSchema = z.object({
  full_name: str(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role_id: intId,
});

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let me;
  try {
    me = await requireManager();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const { full_name, email, role_id } = parsed.data;

  // The role must be one the caller is allowed to see (hidden roles stay hidden).
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, name").eq("id", role_id).maybeSingle();
  if (!role) return { ok: false, error: "Choose a role." };

  const admin = createAdminClient();

  // Already a member? Refuse rather than silently re-inviting.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, error: "That person already has an account." };

  // Create (or reuse) the auth user and send the invite link.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${env.appUrl}/auth/callback?next=/auth/set-password`,
  });

  let userId = invited?.user?.id;
  if (inviteErr) {
    // The email may already exist in auth (shared project). Reuse it and send a reset link instead.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const found = list?.users.find((u) => u.email?.toLowerCase() === email);
    if (!found) return { ok: false, error: inviteErr.message };
    userId = found.id;
    await admin.auth.resetPasswordForEmail(email, { redirectTo: `${env.appUrl}/auth/callback?next=/auth/set-password` });
  }
  if (!userId) return { ok: false, error: "Could not create the account." };

  const { error: profErr } = await admin.from("profiles").insert({ id: userId, email, full_name, role_id, created_by: me.id });
  if (profErr) return { ok: false, error: friendlyError(profErr) };

  await audit(me.id, "create_account", userId, `Invited ${email} as ${role.name}`, { email, role_id });
  bump();
  return { ok: true, message: `Invite sent to ${email}. They set a password, then their authenticator.` };
}

export async function changeRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ user_id: z.string().uuid(), role_id: intId }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Choose a role." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", { p_user_id: p.data.user_id, p_role_id: p.data.role_id });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: "Role updated." };
}

export async function setMemberActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ user_id: z.string().uuid(), active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Invalid request." };
  const active = p.data.active === "true";

  // 1. Flip the profile (checks permission, writes audit) through the caller's session.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_active", { p_user_id: p.data.user_id, p_active: active });
  if (error) return { ok: false, error: friendlyError(error) };

  // 2. Kill or restore their ability to sign in at all.
  const me = await requireManager();
  const admin = createAdminClient();
  const { error: banErr } = await admin.auth.admin.updateUserById(p.data.user_id, {
    ban_duration: active ? "none" : "876000h", // ~100 years
  });
  if (banErr) return { ok: false, error: `Profile updated but sign-in could not be ${active ? "restored" : "blocked"}: ${banErr.message}` };
  if (!active) await admin.auth.admin.signOut(p.data.user_id, "global").catch(() => undefined);
  await audit(me.id, active ? "unban_user" : "ban_user", p.data.user_id);
  bump();
  return { ok: true, message: active ? "Reactivated. They can sign in again." : "Deactivated. Open sessions were ended." };
}

export async function resetAuthenticator(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ user_id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Invalid request." };
  let me;
  try {
    me = await requireManager();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (p.data.user_id === me.id) return { ok: false, error: "Ask another admin to reset your own authenticator." };

  // Only members the caller can see (hidden roles stay hidden).
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("id, email").eq("id", p.data.user_id).maybeSingle();
  if (!target) return { ok: false, error: "Member not found." };

  const admin = createAdminClient();
  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: target.id });
  for (const f of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId: target.id, id: f.id });
  }
  await admin.auth.admin.signOut(target.id, "global").catch(() => undefined);
  await audit(me.id, "reset_mfa", target.id, `Authenticator reset for ${target.email}`);
  bump();
  return { ok: true, message: "Authenticator removed. They will set up a new one at next sign-in." };
}

export async function resendInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ user_id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Invalid request." };
  let me;
  try {
    me = await requireManager();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("id, email").eq("id", p.data.user_id).maybeSingle();
  if (!target) return { ok: false, error: "Member not found." };

  const admin = createAdminClient();
  const { error } = await admin.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${env.appUrl}/auth/callback?next=/auth/set-password`,
  });
  if (error) return { ok: false, error: error.message };
  await audit(me.id, "resend_invite", target.id, `Sign-in link re-sent to ${target.email}`);
  return { ok: true, message: `Sign-in link sent to ${target.email}.` };
}
