"use client";

import { useRouter } from "next/navigation";
import type { Permission, Role } from "@/lib/database.types";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Notice, Textarea } from "@/components/ui";
import { createRole, deleteRole, updateRole } from "./actions";

export function RoleForm({
  role,
  granted,
  permissions,
  memberCount,
  isOwnRole,
}: {
  role: Role | null;
  granted: string[];
  permissions: Permission[];
  memberCount: number;
  isOwnRole: boolean;
}) {
  const router = useRouter();
  const locked = Boolean(role?.is_locked) || isOwnRole;
  const reason = role?.is_locked
    ? `${role.name} is a system role with a fixed set of permissions.`
    : isOwnRole
      ? "You cannot change the permissions of your own role."
      : null;

  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">{role ? role.name : "New role"}</h2>
      {reason && <div className="mt-3"><Notice>{reason}</Notice></div>}

      <ActionForm
        action={role ? updateRole : createRole}
        hidden={role ? { role_id: role.id } : undefined}
        submitLabel={role ? "Save role" : "Create role"}
        className="mt-4 space-y-4"
        onDone={(s) => s?.ok && !role && router.replace("/roles")}
      >
        <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
          {!role && (
            <Field label="Key" hint="Short internal name, cannot change later. e.g. lab_lead">
              <Input name="key" required pattern="[a-z][a-z0-9_]{1,39}" maxLength={40} />
            </Field>
          )}
          <Field label="Name"><Input name="name" required maxLength={60} defaultValue={role?.name ?? ""} /></Field>
          <Field label="Description" hint="Shown when assigning the role"><Textarea name="description" rows={2} maxLength={300} defaultValue={role?.description ?? ""} /></Field>

          <div>
            <div className="mb-1.5 text-sm text-ink-2">Permissions</div>
            <ul className="divide-y divide-rule-soft border-y border-rule">
              {permissions.map((p) => (
                <li key={p.key}>
                  <label className="flex cursor-pointer items-start gap-3 py-2.5">
                    <input type="checkbox" name="permissions" value={p.key} defaultChecked={granted.includes(p.key)} className="mt-1 size-4 accent-stamp" />
                    <span className="text-sm">
                      <span className="block">{p.description}</span>
                      <span className="block text-xs text-ink-3">{p.key}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </fieldset>
      </ActionForm>

      {role && !role.is_system && (
        <div className="mt-8 border-t border-rule pt-4">
          <ActionForm
            action={deleteRole}
            hidden={{ role_id: role.id }}
            submitLabel="Delete role"
            variant="danger"
            confirm={`Delete the ${role.name} role?`}
            onDone={(s) => s?.ok && router.replace("/roles")}
          >
            <p className="text-sm text-ink-2">
              {memberCount > 0 ? `${memberCount} ${memberCount === 1 ? "person holds" : "people hold"} this role. Move them first.` : "Nobody holds this role."}
            </p>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
