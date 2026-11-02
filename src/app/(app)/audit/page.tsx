import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, getRoles } from "@/lib/queries";
import type { AuditEntry } from "@/lib/database.types";
import { Empty, PageHeader, cx, formatDate } from "@/components/ui";
import { SealCheck } from "./seal-check";
import {
  applyFilters, changes, describe, filterParams, how, itemOf, matchItems, parseFilters, sessionDetail, views, who,
  type Lookups,
} from "./lib";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePermission("audit.read");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  const [{ items, categories, locations }, people, roles] = await Promise.all([getCatalog(), getPeopleIndex(), getRoles()]);
  const itemIds = matchItems(items, f.item);

  const query = applyFilters(supabase.from("audit_log").select("*"), f, itemIds)
    .order("seq", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const entries = (data ?? []) as AuditEntry[];

  const L: Lookups = {
    people,
    roles: new Map(roles.map((r) => [r.id, r])),
    items: new Map(items.map((i) => [i.id, i])),
    categories: new Map(categories.map((c) => [c.id, c])),
    locations: new Map(locations.map((l) => [l.id, l])),
  };
  const filtered = Boolean(f.person || f.from || f.to || f.item);
  const exportHref = `/audit/export?${new URLSearchParams(filterParams(f)).toString()}`;
  const signins = f.view === "signins";

  return (
    <>
      <PageHeader
        title="Audit log"
        lead="Every change and every sign-in: who, when, and what exactly changed. Nobody can edit or remove entries, and the seal shows if anyone tried."
        help="audit"
        actions={<a href={exportHref} className="rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">Download CSV</a>}
      />

      <SealCheck />

      <nav aria-label="Kind of entry" className="mb-4 flex flex-wrap gap-1 text-sm">
        {views.map((v) => (
          <Link
            key={v.key}
            href={{ pathname: "/audit", query: filterParams(f, { view: v.key }) }}
            aria-current={f.view === v.key ? "page" : undefined}
            className={cx("rounded-sm px-3 py-1.5", f.view === v.key ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm" role="search">
        {f.view !== "all" && <input type="hidden" name="view" value={f.view} />}
        <label className="grid gap-1">
          <span className="text-xs text-ink-3">Person</span>
          <select name="person" defaultValue={f.person ?? ""} className="field w-56">
            <option value="">Everyone</option>
            {[...people.values()].map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}{p.active ? "" : " (switched off)"}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-ink-3">From</span>
          <input type="date" name="from" defaultValue={f.from ?? ""} className="field w-40" />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-ink-3">To</span>
          <input type="date" name="to" defaultValue={f.to ?? ""} className="field w-40" />
        </label>
        {!signins && (
          <label className="grid gap-1">
            <span className="text-xs text-ink-3">Item</span>
            <input name="item" defaultValue={f.item} placeholder="Name or code" className="field w-52" list="audit-items" />
            <datalist id="audit-items">
              {items.slice(0, 500).map((i) => <option key={i.id} value={i.name} />)}
            </datalist>
          </label>
        )}
        <button className="rounded-sm border border-rule bg-sheet px-3.5 py-2 font-medium hover:border-ink-3">Filter</button>
        {filtered && (
          <Link href={{ pathname: "/audit", query: filterParams(f, { person: null, from: null, to: null, item: null }) }} className="pb-2 text-ink-3 hover:text-ink">
            Clear
          </Link>
        )}
      </form>

      {f.item && itemIds?.length === 0 && <p className="mb-4 text-sm text-ink-3">No item matches “{f.item}”.</p>}

      {entries.length === 0 ? (
        <Empty title={filtered || f.view !== "all" ? "Nothing matches these filters" : "Nothing recorded yet"} />
      ) : (
        <div className="overflow-x-auto">
          <table className="register text-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>{signins ? "What" : "What changed"}</th>
                <th className="r">Entry</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const diffs = changes(e, L);
                const item = itemOf(e, L);
                const detail = sessionDetail(e);
                return (
                  <tr key={e.id} className={cx(e.actor_kind === "database" && "bg-warn-soft/40", e.action === "code_failed" && "text-bad")}>
                    <td className="num whitespace-nowrap align-top text-ink-3">{formatDate(e.created_at, true)}</td>
                    <td className="min-w-[10rem] align-top">
                      {e.actor_id ? (
                        <Link href={{ pathname: "/audit", query: filterParams(f, { person: e.actor_id, view: "all" }) }} className="font-medium hover:underline" title="Everything this person did">
                          {who(e, L)}
                        </Link>
                      ) : (
                        <span className={cx("font-medium", e.actor_kind === "database" && "text-warn")}>{who(e, L)}</span>
                      )}
                      <div className="text-xs text-ink-3">{how(e)}</div>
                    </td>
                    <td className="min-w-[18rem] align-top">
                      <div>{describe(e, L)}</div>
                      {detail && <div className="text-xs text-ink-3">{detail}</div>}
                      {e.note && !["sessions"].includes(e.table_name ?? "") && !describe(e, L).includes(e.note) && (
                        <div className="text-xs text-ink-2">“{e.note}”</div>
                      )}
                      {diffs.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-ink-3">
                          {diffs.slice(0, 8).map((d) => <li key={d} className="break-words">{d}</li>)}
                          {diffs.length > 8 && <li>+{diffs.length - 8} more (in the CSV)</li>}
                        </ul>
                      )}
                      {item && f.item !== item.name && (
                        <Link href={{ pathname: "/audit", query: filterParams(f, { item: item.name, view: "all" }) }} className="mt-1 inline-block text-xs text-ink-3 underline-offset-2 hover:underline">
                          History of {item.name}
                        </Link>
                      )}
                    </td>
                    <td className="num r align-top text-xs text-ink-3">#{e.seq}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {page > 1 ? <Link href={{ pathname: "/audit", query: { ...filterParams(f), page: page - 1 } }} className="hover:underline">Newer</Link> : <span />}
        {entries.length === PAGE && <Link href={{ pathname: "/audit", query: { ...filterParams(f), page: page + 1 } }} className="hover:underline">Older</Link>}
      </div>
    </>
  );
}
