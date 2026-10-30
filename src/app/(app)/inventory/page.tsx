import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { getCatalog, getStockLevels } from "@/lib/queries";
import { Empty, PageHeader, StockLevelMark, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  await requireMember();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const filter = sp.filter === "low" ? "low" : sp.filter === "out" ? "out" : "all";
  const categoryId = typeof sp.category === "string" ? Number(sp.category) : null;

  const [{ items, categories, locations }, levels] = await Promise.all([getCatalog(), getStockLevels()]);
  const activeLocations = locations.filter((l) => l.active);

  const byItem = new Map<number, Map<number, number>>();
  for (const l of levels) {
    if (!byItem.has(l.item_id)) byItem.set(l.item_id, new Map());
    byItem.get(l.item_id)!.set(l.location_id, l.quantity);
  }

  const rows = items
    .filter((i) => i.active)
    .filter((i) => !categoryId || i.category_id === categoryId)
    .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.sku ?? "").toLowerCase().includes(q))
    .map((i) => {
      const per = byItem.get(i.id) ?? new Map<number, number>();
      const total = Array.from(per.values()).reduce((a, b) => a + b, 0);
      return { item: i, per, total };
    })
    .filter((r) =>
      filter === "all" ? true : filter === "out" ? r.total === 0 : r.item.reorder_level > 0 && r.total <= r.item.reorder_level,
    );

  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader title="Inventory" lead="What is in each location right now. Totals come from the stock ledger." help="inventory" />

      <form className="mb-5 flex flex-wrap items-end gap-3" role="search">
        <input name="q" defaultValue={q} placeholder="Search items or codes" className="field w-64" aria-label="Search items" />
        <select name="category" defaultValue={categoryId ?? ""} className="field w-48" aria-label="Category">
          <option value="">All categories</option>
          {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="hidden" name="filter" value={filter} />
        <button className="rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">Filter</button>
        <div className="ml-auto flex gap-1 text-sm">
          {(["all", "low", "out"] as const).map((f) => (
            <Link
              key={f}
              href={{ pathname: "/inventory", query: { ...(q && { q }), ...(categoryId && { category: categoryId }), ...(f !== "all" && { filter: f }) } }}
              className={cx("rounded-sm px-3 py-1.5", filter === f ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}
            >
              {f === "all" ? "Everything" : f === "low" ? "Low" : "Out"}
            </Link>
          ))}
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty title={items.length === 0 ? "No items in the catalog yet" : "Nothing matches"}>
          {items.length === 0 && "The store manager adds categories, locations and items under Catalog."}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="register text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                {activeLocations.map((l) => <th key={l.id} className="r">{l.name}</th>)}
                <th className="r">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, per, total }) => (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium">{item.name}</div>
                    {item.sku && <div className="text-xs text-ink-3">{item.sku}</div>}
                  </td>
                  <td className="text-ink-2">{catName.get(item.category_id)}</td>
                  {activeLocations.map((l) => {
                    const n = per.get(l.id) ?? 0;
                    return <td key={l.id} className={cx("num r", n === 0 && "text-ink-3")}>{n}</td>;
                  })}
                  <td className="num r font-semibold">{total} <span className="font-normal text-ink-3">{item.unit}</span></td>
                  <td><StockLevelMark qty={total} reorder={item.reorder_level} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
