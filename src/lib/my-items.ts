import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category, Item, RequestLine, RequestRow } from "@/lib/database.types";

export type ReceivedItem = {
  item: Pick<Item, "id" | "name" | "sku" | "unit">;
  quantity: number;
  times: number;
  lastReceived: string | null;
  requestIds: number[];
};

export type ReceivedByCategory = {
  category: Pick<Category, "id" | "name">;
  items: ReceivedItem[];
  units: number;
};

export type MyItemsSummary = {
  categories: ReceivedByCategory[];
  distinctItems: number;
  units: number;
  handedOver: number;
  inProgress: number;
  firstReceived: string | null;
};

/**
 * Everything the store has handed to the signed-in member: approved quantities
 * on their fulfilled requests, grouped by category. RLS limits every read to
 * the caller's own requests.
 */
export async function getMyItems(userId: string): Promise<MyItemsSummary> {
  const supabase = await createClient();
  const { data: reqData } = await supabase
    .from("requests")
    .select("id, status, closed_at")
    .eq("requester_id", userId);
  const requests = (reqData ?? []) as Pick<RequestRow, "id" | "status" | "closed_at">[];
  const fulfilled = requests.filter((r) => r.status === "fulfilled");
  const inProgress = requests.filter((r) => ["submitted", "recommended", "not_recommended", "approved"].includes(r.status)).length;

  if (fulfilled.length === 0) {
    return { categories: [], distinctItems: 0, units: 0, handedOver: 0, inProgress, firstReceived: null };
  }

  const closedAt = new Map(fulfilled.map((r) => [r.id, r.closed_at]));
  const [{ data: lineData }, { data: itemData }, { data: catData }] = await Promise.all([
    supabase.from("request_lines").select("request_id, item_id, approved_qty").in("request_id", fulfilled.map((r) => r.id)),
    supabase.from("items").select("id, name, sku, unit, category_id"),
    supabase.from("categories").select("id, name"),
  ]);
  const lines = (lineData ?? []) as Pick<RequestLine, "request_id" | "item_id" | "approved_qty">[];
  const items = new Map(((itemData ?? []) as Pick<Item, "id" | "name" | "sku" | "unit" | "category_id">[]).map((i) => [i.id, i]));
  const cats = new Map(((catData ?? []) as Pick<Category, "id" | "name">[]).map((c) => [c.id, c]));

  const byItem = new Map<number, ReceivedItem & { categoryId: number }>();
  for (const l of lines) {
    const qty = l.approved_qty ?? 0;
    if (qty <= 0) continue;
    const it = items.get(l.item_id);
    if (!it) continue;
    const when = closedAt.get(l.request_id) ?? null;
    const row = byItem.get(it.id) ?? {
      item: { id: it.id, name: it.name, sku: it.sku, unit: it.unit },
      categoryId: it.category_id, quantity: 0, times: 0, lastReceived: null, requestIds: [],
    };
    row.quantity += qty;
    row.times += 1;
    row.requestIds.push(l.request_id);
    if (when && (!row.lastReceived || when > row.lastReceived)) row.lastReceived = when;
    byItem.set(it.id, row);
  }

  const grouped = new Map<number, ReceivedByCategory>();
  for (const row of byItem.values()) {
    const cat = cats.get(row.categoryId) ?? { id: row.categoryId, name: "Uncategorised" };
    const g = grouped.get(cat.id) ?? { category: cat, items: [], units: 0 };
    g.items.push(row);
    g.units += row.quantity;
    grouped.set(cat.id, g);
  }
  const categories = [...grouped.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => b.quantity - a.quantity || a.item.name.localeCompare(b.item.name)) }))
    .sort((a, b) => b.units - a.units || a.category.name.localeCompare(b.category.name));

  const dates = fulfilled.map((r) => r.closed_at).filter((d): d is string => Boolean(d)).sort();
  return {
    categories,
    distinctItems: byItem.size,
    units: categories.reduce((n, c) => n + c.units, 0),
    handedOver: fulfilled.length,
    inProgress,
    firstReceived: dates[0] ?? null,
  };
}
