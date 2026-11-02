import type { Metadata } from "next";
import Link from "next/link";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, nameOf } from "@/lib/queries";
import type { MovementKind, StockMovement } from "@/lib/database.types";
import { Empty, LinkButton, PageHeader, cx, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Stock movements" };

const PAGE = 100;

const kinds: { key: MovementKind | "all"; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "receive", label: "Received" },
  { key: "issue", label: "Handed over" },
  { key: "adjust", label: "Corrections" },
  { key: "transfer_out", label: "Moves" },
];

const kindLabel: Record<MovementKind, string> = {
  receive: "Received",
  issue: "Handed over",
  adjust: "Correction",
  transfer_out: "Moved out",
  transfer_in: "Moved in",
};

export default async function StockMovementsPage({ searchParams }: PageProps<"/stock">) {
  const me = await requirePermission("stock.write", "stock.read_history");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const kind = kinds.find((k) => k.key === sp.kind)?.key ?? "all";
  const locationId = typeof sp.location === "string" && /^\d+$/.test(sp.location) ? Number(sp.location) : null;
  const page = Math.max(1, Number(sp.page) || 1);

  const supabase = await createClient();
  const [{ items, locations }, people] = await Promise.all([getCatalog(), getPeopleIndex()]);
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const matchingItems = q
    ? items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()) || (i.sku ?? "").toLowerCase().includes(q.toLowerCase())).map((i) => i.id)
    : null;

  let moves: StockMovement[] = [];
  if (!matchingItems || matchingItems.length > 0) {
    let query = supabase
      .from("stock_movements")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1);
    if (kind === "transfer_out") query = query.in("kind", ["transfer_out", "transfer_in"]);
    else if (kind !== "all") query = query.eq("kind", kind);
    if (locationId) query = query.eq("location_id", locationId);
    if (matchingItems) query = query.in("item_id", matchingItems.slice(0, 300));
    moves = ((await query).data ?? []) as StockMovement[];
  }

  const params = (patch: Record<string, string | number | null>) => {
    const base: Record<string, string> = {};
    if (q) base.q = q;
    if (kind !== "all") base.kind = kind;
    if (locationId) base.location = String(locationId);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "all") delete base[k];
      else base[k] = String(v);
    }
    return base;
  };
  const filtered = Boolean(q || kind !== "all" || locationId);

  return (
    <>
      <PageHeader
        title="Stock movements"
        help="ledger"
        lead="The ledger: every unit that came in, went out, or moved. Lines cannot be edited; corrections are new lines."
        actions={
          can(me, "stock.write") && (
            <>
              <LinkButton href="/stock/adjust">Correct or move</LinkButton>
              <LinkButton href="/stock/receive" variant="primary">Receive stock</LinkButton>
            </>
          )
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input name="q" defaultValue={q} placeholder="Search item or code" aria-label="Search item or code" className="field w-64" />
        <select name="location" defaultValue={locationId ?? ""} aria-label="Location" className="field w-64">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {kind !== "all" && <input type="hidden" name="kind" value={kind} />}
        <button className="rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">Filter</button>
        {filtered && <Link href="/stock" className="pb-2 text-sm text-ink-3 hover:text-ink">Clear</Link>}
      </form>

      <nav aria-label="Movement type" className="mb-5 flex flex-wrap gap-1 text-sm">
        {kinds.map((k) => (
          <Link
            key={k.key}
            href={{ pathname: "/stock", query: params({ kind: k.key, page: null }) }}
            aria-current={kind === k.key ? "page" : undefined}
            className={cx("rounded-sm px-3 py-1.5", kind === k.key ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}
          >
            {k.label}
          </Link>
        ))}
      </nav>

      {moves.length === 0 ? (
        <Empty title={filtered ? "No movements match these filters" : "No movements yet"}>
          {!filtered && can(me, "stock.write") && <Link href="/stock/receive" className="underline">Receive the first delivery</Link>}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="register text-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Location</th>
                <th className="r">Change</th>
                <th>Reference / reason</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const item = itemMap.get(m.item_id);
                return (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-ink-3">{formatDate(m.created_at, true)}</td>
                    <td className="min-w-[12rem]">
                      <div className="font-medium">{item?.name ?? `Item ${m.item_id}`}</div>
                      {item?.sku && <div className="text-xs text-ink-3">{item.sku}</div>}
                    </td>
                    <td className="text-ink-2">{nameOf(locations, m.location_id)}</td>
                    <td className="r whitespace-nowrap">
                      <div className={cx("num font-semibold", m.quantity < 0 ? "text-bad" : "text-ok")}>
                        {m.quantity > 0 ? "+" : ""}{m.quantity} <span className="font-normal text-ink-3">{item?.unit}</span>
                      </div>
                      <div className="text-xs text-ink-3">{kindLabel[m.kind]}</div>
                    </td>
                    <td className="min-w-[14rem] max-w-[26rem]">
                      <div className="text-ink-2">
                        {m.request_id ? (
                          <Link href={`/requests/${m.request_id}`} className="hover:underline">Request #{m.request_id}</Link>
                        ) : (
                          <span className="line-clamp-2" title={m.note ?? undefined}>{m.note || "—"}</span>
                        )}
                      </div>
                      <div className="text-xs text-ink-3">by {nameOf(people, m.created_by) || "system"}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {page > 1 ? <Link href={{ pathname: "/stock", query: params({ page: page - 1 }) }} className="hover:underline">Newer</Link> : <span />}
        {moves.length === PAGE && <Link href={{ pathname: "/stock", query: params({ page: page + 1 }) }} className="hover:underline">Older</Link>}
      </div>
    </>
  );
}
