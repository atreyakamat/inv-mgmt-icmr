import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category, Item, Location, Profile, RequestRow, Role, StockLevel } from "@/lib/database.types";

export async function getCatalog() {
  const supabase = await createClient();
  const [items, categories, locations] = await Promise.all([
    supabase.from("items").select("*").order("name"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("locations").select("*").order("name"),
  ]);
  return {
    items: (items.data ?? []) as Item[],
    categories: (categories.data ?? []) as Category[],
    locations: (locations.data ?? []) as Location[],
  };
}

export async function getStockLevels() {
  const supabase = await createClient();
  const { data } = await supabase.from("stock_levels").select("*");
  return (data ?? []) as StockLevel[];
}

export async function getPeopleIndex() {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email, role_id, active");
  const map = new Map<string, Pick<Profile, "id" | "full_name" | "email" | "role_id" | "active">>();
  for (const p of data ?? []) map.set(p.id, p);
  return map;
}

export async function getRoles() {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("*").order("id");
  return (data ?? []) as Role[];
}

export async function getRequests(filter?: { status?: RequestRow["status"][]; mine?: string }) {
  const supabase = await createClient();
  let q = supabase.from("requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter?.status) q = q.in("status", filter.status);
  if (filter?.mine) q = q.eq("requester_id", filter.mine);
  const { data } = await q;
  return (data ?? []) as RequestRow[];
}

export function nameOf<T extends { id: number | string; name?: string; full_name?: string }>(
  list: Map<T["id"], T> | T[],
  id: T["id"] | null | undefined,
) {
  if (id == null) return "";
  const hit = list instanceof Map ? list.get(id) : list.find((x) => x.id === id);
  return hit?.name ?? hit?.full_name ?? "";
}
