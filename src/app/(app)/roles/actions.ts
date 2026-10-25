"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, intId, optStr, str, type ActionState, guarded } from "@/lib/actions";

function bump() {
  revalidatePath("/roles");
  revalidatePath("/people");
}

function permissionsFrom(formData: FormData) {
  return formData.getAll("permissions").map(String).filter((k) => /^[a-z_]+\.[a-z_]+$/.test(k));
}

async function createRoleImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z
    .object({ key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/, "Key: lowercase letters, numbers and underscores, e.g. lab_lead"), name: str(60), description: optStr(300) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the fields." };
  const permissions = permissionsFrom(formData);
  if (permissions.length === 0) return { ok: false, error: "Tick at least one permission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_role", { p_key: p.data.key, p_name: p.data.name, p_description: p.data.description, p_permissions: permissions });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: "Role created." };
}

async function updateRoleImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ role_id: intId, name: str(60), description: optStr(300) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the fields." };
  const permissions = permissionsFrom(formData);
  if (permissions.length === 0) return { ok: false, error: "Tick at least one permission." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_role", { p_role_id: p.data.role_id, p_name: p.data.name, p_description: p.data.description, p_permissions: permissions });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: "Role saved." };
}

async function deleteRoleImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("role_id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_role", { p_role_id: id });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: "Role deleted." };
}

export const createRole = guarded("createRole", createRoleImpl);
export const updateRole = guarded("updateRole", updateRoleImpl);
export const deleteRole = guarded("deleteRole", deleteRoleImpl);
