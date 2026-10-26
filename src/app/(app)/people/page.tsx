import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRoles } from "@/lib/queries";
import type { Profile } from "@/lib/database.types";
import { Empty, PageHeader, cx, formatDate } from "@/components/ui";
import { CreateAccountForm, MemberControls } from "./forms";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage() {
  const me = await requirePermission("users.manage");
  const supabase = await createClient();
  const [profilesRes, roles] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    getRoles(),
  ]);
  const profiles = (profilesRes.data ?? []) as Profile[];
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const assignable = roles.filter((r) => !r.hidden || me.role.hidden);

  return (
    <>
      <PageHeader
        title="People"
        lead="Accounts are created here, never by sign-up. New people get an email link, set a password, then set up their authenticator."
      />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {profiles.length === 0 ? (
            <Empty title="No members yet" />
          ) : (
            <table className="register text-sm">
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th className="r">Added</th><th></th></tr></thead>
              <tbody>
                {profiles.map((p) => {
                  const role = roleMap.get(p.role_id);
                  const self = p.id === me.id;
                  return (
                    <tr key={p.id} className={cx(!p.active && "text-ink-3")}>
                      <td>
                        <div className="font-medium">{p.full_name}{self && <span className="ml-2 text-xs font-normal text-ink-3">you</span>}</div>
                        <div className="text-xs text-ink-3">{p.email}</div>
                      </td>
                      <td>
                        <span className={cx(role?.hidden && "text-stamp")}>{role?.name ?? "—"}</span>
                        {role?.hidden && <span className="ml-1 text-xs text-ink-3">hidden</span>}
                      </td>
                      <td>{p.active ? <span className="text-ok">Active</span> : "Deactivated"}</td>
                      <td className="r text-ink-3">{formatDate(p.created_at)}</td>
                      <td className="r">
                        {!self && (
                          <MemberControls
                            userId={p.id}
                            active={p.active}
                            roleId={p.role_id}
                            roleLocked={Boolean(role?.hidden && !me.role.hidden)}
                            roles={assignable.map((r) => ({ id: r.id, name: r.name }))}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="xl:sticky xl:top-8 xl:self-start">
          <CreateAccountForm roles={assignable.filter((r) => !r.is_locked || r.key === "super_user").map((r) => ({ id: r.id, name: r.name, description: r.description }))} />
        </div>
      </div>
    </>
  );
}
