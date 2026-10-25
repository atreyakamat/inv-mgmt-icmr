import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeopleIndex, nameOf } from "@/lib/queries";
import type { AuditEntry } from "@/lib/database.types";
import { Empty, PageHeader, cx, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

function describe(e: AuditEntry): string {
  const t = e.table_name?.replace("auth.users", "account") ?? "";
  const name = (e.new_data?.name ?? e.old_data?.name ?? e.new_data?.full_name ?? e.old_data?.full_name) as string | undefined;
  const subject = name ? `${t.replace(/s$/, "")} “${name}”` : `${t.replace(/s$/, "")} ${e.row_id ?? ""}`.trim();
  switch (e.action) {
    case "insert": return `Added ${subject}`;
    case "update": return `Changed ${subject}`;
    case "delete": return `Removed ${subject}`;
    default: return `${e.action.replace(/_/g, " ")}${e.note ? `: ${e.note}` : ` (${subject})`}`;
  }
}

function changed(e: AuditEntry): string[] {
  if (e.action !== "update" || !e.old_data || !e.new_data) return [];
  const out: string[] = [];
  for (const k of Object.keys(e.new_data)) {
    if (k === "updated_at") continue;
    const a = JSON.stringify(e.old_data[k]);
    const b = JSON.stringify(e.new_data[k]);
    if (a !== b) out.push(`${k}: ${a ?? "∅"} → ${b ?? "∅"}`);
  }
  return out;
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const table = typeof sp.table === "string" ? sp.table : "";

  const supabase = await createClient();
  let q = supabase.from("audit_log").select("*").order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (table) q = q.eq("table_name", table);
  const [{ data }, people] = await Promise.all([q, getPeopleIndex()]);
  const entries = (data ?? []) as AuditEntry[];

  const tables = ["profiles", "roles", "role_permissions", "items", "categories", "locations", "requests", "request_lines", "stock_movements", "auth.users"];

  return (
    <>
      <PageHeader title="Audit log" lead="Every change, by whom, when. Nothing here can be edited or removed." />

      <div className="mb-5 flex flex-wrap gap-1 text-sm">
        <Link href="/audit" className={cx("rounded-sm px-3 py-1.5", !table ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}>Everything</Link>
        {tables.map((t) => (
          <Link key={t} href={`/audit?table=${t}`} className={cx("rounded-sm px-3 py-1.5", table === t ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}>
            {t.replace("auth.users", "accounts").replace("_", " ")}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <table className="register text-sm">
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {entries.map((e) => {
              const diffs = changed(e);
              return (
                <tr key={e.id}>
                  <td className="num whitespace-nowrap text-ink-3">{formatDate(e.created_at, true)}</td>
                  <td className="whitespace-nowrap">{nameOf(people, e.actor_id) || (e.actor_kind === "server" ? "System" : "—")}</td>
                  <td>
                    <div>{describe(e)}</div>
                    {diffs.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
                        {diffs.slice(0, 6).map((d) => <li key={d} className="truncate">{d}</li>)}
                        {diffs.length > 6 && <li>+{diffs.length - 6} more</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {page > 1 ? <Link href={{ pathname: "/audit", query: { ...(table && { table }), page: page - 1 } }} className="hover:underline">Newer</Link> : <span />}
        {entries.length === PAGE && <Link href={{ pathname: "/audit", query: { ...(table && { table }), page: page + 1 } }} className="hover:underline">Older</Link>}
      </div>
    </>
  );
}
