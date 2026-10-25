"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";
import { changeRole, createAccount, resendInvite, resetAuthenticator, setMemberActive } from "./actions";

type RoleOpt = { id: number; name: string; description?: string | null };

export function CreateAccountForm({ roles }: { roles: RoleOpt[] }) {
  const [roleId, setRoleId] = useState<string>("");
  const chosen = roles.find((r) => String(r.id) === roleId);
  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Add a person</h2>
      <ActionForm action={createAccount} submitLabel="Create account and send invite" pendingLabel="Sending invite…" className="mt-3 space-y-4">
        <Field label="Full name"><Input name="full_name" required maxLength={120} /></Field>
        <Field label="Work email"><Input name="email" type="email" required /></Field>
        <Field label="Role" hint={chosen?.description ?? undefined}>
          <Select name="role_id" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="" disabled>Choose a role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
      </ActionForm>
    </div>
  );
}

export function MemberControls({
  userId,
  active,
  roleId,
  roleLocked,
  roles,
}: {
  userId: string;
  active: boolean;
  roleId: number;
  roleLocked: boolean;
  roles: RoleOpt[];
}) {
  const [open, setOpen] = useState(false);
  const [roleState, roleAction, rolePending] = useActionState<ActionState, FormData>(changeRole, null);
  const [activeState, activeAction, activePending] = useActionState<ActionState, FormData>(setMemberActive, null);
  const [mfaState, mfaAction, mfaPending] = useActionState<ActionState, FormData>(resetAuthenticator, null);
  const [inviteState, inviteAction, invitePending] = useActionState<ActionState, FormData>(resendInvite, null);
  const notice = [roleState, activeState, mfaState, inviteState].find(Boolean);

  return (
    <div className="relative inline-block text-left">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-sm border border-rule bg-sheet px-2.5 py-1 text-xs font-medium hover:border-ink-3">
        Manage
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 space-y-3 rounded-sm border border-rule bg-sheet p-3 text-sm shadow-[0_8px_24px_-12px_rgba(22,35,58,0.35)]">
          <form action={roleAction} className="flex items-end gap-2">
            <input type="hidden" name="user_id" value={userId} />
            <label className="flex-1">
              <span className="mb-1 block text-xs text-ink-3">Role</span>
              <select name="role_id" defaultValue={roleId} disabled={roleLocked} className="field py-1.5 text-sm">
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <Button type="submit" variant="secondary" disabled={rolePending || roleLocked} className="py-1.5 text-xs">Save</Button>
          </form>

          <div className="flex flex-wrap gap-2 border-t border-rule-soft pt-3">
            <form action={inviteAction}>
              <input type="hidden" name="user_id" value={userId} />
              <Button type="submit" variant="ghost" disabled={invitePending} className="px-2 py-1 text-xs">Resend sign-in link</Button>
            </form>
            <form action={mfaAction} onSubmit={(e) => { if (!confirm("Remove this person's authenticator? They will set up a new one at next sign-in.")) e.preventDefault(); }}>
              <input type="hidden" name="user_id" value={userId} />
              <Button type="submit" variant="ghost" disabled={mfaPending} className="px-2 py-1 text-xs">Reset authenticator</Button>
            </form>
            <form action={activeAction} onSubmit={(e) => { if (active && !confirm("Deactivate this account? They are signed out everywhere immediately.")) e.preventDefault(); }}>
              <input type="hidden" name="user_id" value={userId} />
              <input type="hidden" name="active" value={String(!active)} />
              <Button type="submit" variant={active ? "danger" : "secondary"} disabled={activePending} className={cx("px-2 py-1 text-xs")}>
                {active ? "Deactivate" : "Reactivate"}
              </Button>
            </form>
          </div>

          {notice && <Notice tone={notice.ok ? "ok" : "bad"}>{notice.ok ? notice.message : notice.error}</Notice>}
        </div>
      )}
    </div>
  );
}
