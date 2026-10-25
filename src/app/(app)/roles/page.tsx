import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRoles } from "@/lib/queries";
import type { Permission, RolePermission } from "@/lib/database.types";
import { PageHeader, cx } from "@/components/ui";
import { RoleForm } from "./forms";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage({ searchParams }: PageProps<"/roles">) {
  const me = await requirePermission("roles.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  const [roles, permsRes, rpRes, countRes] = await Promise.all([
    getRoles(),
    supabase.from("permissions").select("*").order("sort_order"),
    supabase.from("role_permissions").select("*"),
    supabase.from("profiles").select("role_id, active"),
  ]);
  const permissions = (permsRes.data ?? []) as Permission[];
  const rp = (rpRes.data ?? []) as RolePermission[];
  const members = new Map<number, number>();
  for (const p of countRes.data ?? []) if (p.active) members.set(p.role_id, (members.get(p.role_id) ?? 0) + 1);

  const grants = new Map<number, Set<string>>();
  for (const r of rp) {
    if (!grants.has(r.role_id)) grants.set(r.role_id, new Set());
    grants.get(r.role_id)!.add(r.permission_key);
  }

  const selectedId = sp.role === "new" ? null : typeof sp.role === "string" ? Number(sp.role) : roles.find((r) => !r.is_locked)?.id ?? null;
  const selected = selectedId ? roles.find((r) => r.id === selectedId) ?? null : null;
  const creating = sp.role === "new";

  return (
    <>
      <PageHeader
        title="Roles"
        lead="Who can do what. Each role is a set of permissions; change a role and everyone holding it changes with it."
        actions={<Link href="/roles?role=new" className="inline-flex items-center rounded-sm border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:bg-ink-2">New role</Link>}
      />

      {/* Matrix */}
      <div className="mb-10 overflow-x-auto">
        <table className="register text-sm">
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="r">
                  <Link href={`/roles?role=${r.id}`} className={cx("hover:underline", selected?.id === r.id && "text-stamp", r.hidden && "text-stamp")}>{r.name}</Link>
                  <div className="num text-xs font-normal text-ink-3">{members.get(r.id) ?? 0} {members.get(r.id) === 1 ? "person" : "people"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.key}>
                <td>
                  <div className="font-medium">{p.description}</div>
                  <div className="text-xs text-ink-3">{p.key}</div>
                </td>
                {roles.map((r) => {
                  const on = grants.get(r.id)?.has(p.key);
                  return (
                    <td key={r.id} className="r">
                      <span aria-label={on ? "granted" : "not granted"} className={cx("inline-block size-3 rounded-[2px]", on ? "rotate-[-8deg] bg-stamp" : "border border-rule")} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || selected) && (
        <div className="max-w-xl">
          <RoleForm
            key={creating ? "new" : selected!.id}
            role={creating ? null : selected}
            granted={creating ? [] : Array.from(grants.get(selected!.id) ?? [])}
            permissions={permissions}
            memberCount={creating ? 0 : members.get(selected!.id) ?? 0}
            isOwnRole={!creating && selected!.id === me.role.id}
          />
        </div>
      )}
    </>
  );
}
