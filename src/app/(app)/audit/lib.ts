import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { AuditEntry, Category, DirectoryEntry, Item, Location, Role } from "@/lib/database.types";

/* ---------------------------------------------------------------- filters */

export const views = [
  { key: "all", label: "All changes" },
  { key: "requests", label: "Requests" },
  { key: "stock", label: "Stock" },
  { key: "catalog", label: "Catalog" },
  { key: "accounts", label: "Accounts & roles" },
  { key: "signins", label: "Sign-ins" },
  { key: "database", label: "Direct database edits" },
] as const;
export type View = (typeof views)[number]["key"];

export type AuditFilters = {
  view: View;
  person: string | null;
  from: string | null; // yyyy-mm-dd, IST
  to: string | null; // yyyy-mm-dd, IST, inclusive
  item: string; // name or code
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export function parseFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  return {
    view: views.find((v) => v.key === sp.view)?.key ?? "all",
    person: isUuid(sp.person) ? sp.person : null,
    from: isDate(sp.from) ? sp.from : null,
    to: isDate(sp.to) ? sp.to : null,
    item: typeof sp.item === "string" ? sp.item.trim().slice(0, 80) : "",
  };
}

export function filterParams(f: AuditFilters, patch: Record<string, string | null> = {}) {
  const base: Record<string, string> = {};
  if (f.view !== "all") base.view = f.view;
  if (f.person) base.person = f.person;
  if (f.from) base.from = f.from;
  if (f.to) base.to = f.to;
  if (f.item) base.item = f.item;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || (k === "view" && v === "all")) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** Item ids whose name or code matches; null when no item filter is set. */
export function matchItems(items: Item[], text: string): number[] | null {
  if (!text) return null;
  const s = text.toLowerCase();
  return items
    .filter((i) => i.name.toLowerCase().includes(s) || (i.sku ?? "").toLowerCase() === s || (i.sku ?? "").toLowerCase().includes(s))
    .slice(0, 60)
    .map((i) => i.id);
}

// Applies the filters to a select on audit_log. Typed loosely: the builder's
// generic types do not survive being passed around.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilters(q: any, f: AuditFilters, itemIds: number[] | null) {
  switch (f.view) {
    case "requests":
      q = q.in("table_name", ["requests", "request_lines"]);
      break;
    case "stock":
      q = q.eq("table_name", "stock_movements");
      break;
    case "catalog":
      q = q.in("table_name", ["items", "categories", "locations"]);
      break;
    case "accounts":
      q = q.in("table_name", ["profiles", "roles", "role_permissions", "auth.users"]);
      break;
    case "signins":
      q = q.eq("table_name", "sessions");
      break;
    case "database":
      q = q.eq("actor_kind", "database");
      break;
    default:
      q = q.or("table_name.is.null,table_name.neq.sessions");
  }
  if (f.person) q = q.eq("actor_id", f.person);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00+05:30`);
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00+05:30`);
    end.setUTCDate(end.getUTCDate() + 1);
    q = q.lt("created_at", end.toISOString());
  }
  if (itemIds) {
    const ids = itemIds.length ? itemIds.join(",") : "0";
    q = q.or(`and(table_name.eq.items,row_id.in.(${ids})),new_data->>item_id.in.(${ids}),old_data->>item_id.in.(${ids})`);
  }
  return q;
}

/** Every matching entry, newest first, up to `limit` (the Data API caps one page at 1000). */
export async function fetchAll(supabase: Awaited<ReturnType<typeof createClient>>, f: AuditFilters, itemIds: number[] | null, limit = 20000) {
  const out: AuditEntry[] = [];
  const PAGE = 1000;
  for (let from = 0; from < limit; from += PAGE) {
    const q = applyFilters(supabase.from("audit_log").select("*"), f, itemIds)
      .order("seq", { ascending: false })
      .range(from, Math.min(from + PAGE, limit) - 1);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as AuditEntry[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/* ---------------------------------------------------------------- wording */

export type Lookups = {
  people: Map<string, DirectoryEntry>;
  roles: Map<number, Role>;
  items: Map<number, Item>;
  categories: Map<number, Category>;
  locations: Map<number, Location>;
};

const nouns: Record<string, string> = {
  profiles: "account",
  "auth.users": "account",
  roles: "role",
  role_permissions: "role permission",
  items: "item",
  categories: "category",
  locations: "location",
  requests: "request",
  request_lines: "request line",
  stock_movements: "stock movement",
};

const actionWords: Record<string, string> = {
  sign_in: "Signed in",
  sign_out: "Signed out",
  code_failed: "Entered a wrong authenticator code",
  password_set: "Set a new password",
  create_account: "Created an account",
  resend_invite: "Re-sent a sign-in link",
  reset_mfa: "Reset an authenticator",
  ban_user: "Switched off sign-in",
  unban_user: "Switched sign-in back on",
  set_member_role: "Changed a member's role",
  create_role: "Created a role",
  update_role: "Changed a role's permissions",
  delete_role: "Deleted a role",
  receive_delivery: "Received a delivery",
};

const movementWords: Record<string, string> = {
  receive: "Received",
  issue: "Handed over",
  adjust: "Corrected",
  transfer_out: "Moved out",
  transfer_in: "Moved in",
};

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

export function who(e: AuditEntry, L: Lookups): string {
  if (e.actor_id) return L.people.get(e.actor_id)?.full_name ?? "Former member";
  if (e.actor_kind === "database") return `Database (${e.db_user ?? "unknown login"})`;
  return "System";
}

export function how(e: AuditEntry): string {
  switch (e.actor_kind) {
    case "member": return "In the app";
    case "server": return "In the app (account service)";
    case "database": return `Directly in the database as ${e.db_user ?? "unknown"}`;
    default: return "System";
  }
}

export function describe(e: AuditEntry, L: Lookups): string {
  const d = (e.new_data ?? e.old_data ?? {}) as Record<string, unknown>;
  if (e.table_name === "sessions") return actionWords[e.action] ?? e.action;

  if (e.table_name === "stock_movements" && e.action === "insert") {
    const item = L.items.get(num(d.item_id) ?? -1);
    const loc = L.locations.get(num(d.location_id) ?? -1);
    const q = num(d.quantity) ?? Number(d.quantity);
    const qty = `${q > 0 ? "+" : ""}${q}${item?.unit ? ` ${item.unit}` : ""}`;
    return `${movementWords[String(d.kind)] ?? "Stock"} ${qty} ${item?.name ?? "an item"}${loc ? ` at ${loc.name}` : ""}`;
  }
  if (e.table_name === "requests") {
    const id = e.row_id ? `#${e.row_id}` : "";
    if (e.action === "insert") return `Raised request ${id}`;
    if (e.action === "update" && e.old_data?.status !== e.new_data?.status)
      return `Request ${id}: ${String(e.old_data?.status ?? "").replace(/_/g, " ")} → ${String(e.new_data?.status ?? "").replace(/_/g, " ")}`;
    return `Changed request ${id}`;
  }
  if (e.table_name === "request_lines") {
    const item = L.items.get(num(d.item_id) ?? -1);
    return `${e.action === "insert" ? "Added" : e.action === "update" ? "Changed" : "Removed"} ${item?.name ?? "a line"} on request #${d.request_id ?? "?"}`;
  }
  if (actionWords[e.action]) return e.note ? `${actionWords[e.action]}: ${e.note}` : actionWords[e.action];

  const noun = nouns[e.table_name ?? ""] ?? e.table_name ?? "entry";
  const name = (d.name ?? d.full_name ?? d.email) as string | undefined;
  const subject = name ? `${noun} “${name}”` : `${noun}${e.row_id ? ` ${e.row_id}` : ""}`;
  switch (e.action) {
    case "insert": return `Added ${subject}`;
    case "update": return `Changed ${subject}`;
    case "delete": return `Removed ${subject}`;
    default: return `${e.action.replace(/_/g, " ")}${e.note ? `: ${e.note}` : ` (${subject})`}`;
  }
}

const labels: Record<string, string> = {
  role_id: "role", category_id: "category", location_id: "location", item_id: "item",
  reorder_level: "reorder at", full_name: "name", active: "active", status: "status",
  approved_qty: "approved", requested_qty: "requested", needed_by: "needed by",
  approver_id: "approver", reviewer_id: "reviewer", fulfiller_id: "handed over by", requester_id: "raised by",
  approver_note: "approver's note", reviewer_note: "reviewer's note",
};
const hidden = new Set(["updated_at", "created_at", "id", "created_by", "reviewed_at", "approved_at", "closed_at"]);

function show(key: string, v: unknown, L: Lookups): string {
  if (v === null || v === undefined || v === "") return "empty";
  const n = num(v);
  if (n !== null) {
    if (key === "role_id") return L.roles.get(n)?.name ?? String(v);
    if (key === "category_id") return L.categories.get(n)?.name ?? String(v);
    if (key === "location_id") return L.locations.get(n)?.name ?? String(v);
    if (key === "item_id") return L.items.get(n)?.name ?? String(v);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (key.endsWith("_id") && typeof v === "string" && L.people.has(v)) return L.people.get(v)!.full_name;
  if (typeof v === "string") return v.replace(/_/g, " ");
  return JSON.stringify(v);
}

/** "reorder at: 5 → 10" lines for an update. */
export function changes(e: AuditEntry, L: Lookups): string[] {
  if (e.action !== "update" || !e.old_data || !e.new_data) return [];
  const out: string[] = [];
  for (const k of Object.keys(e.new_data)) {
    if (hidden.has(k)) continue;
    const a = e.old_data[k];
    const b = e.new_data[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${labels[k] ?? k.replace(/_/g, " ")}: ${show(k, a, L)} → ${show(k, b, L)}`);
  }
  return out;
}

/** Second line: device and address for sign-ins, the reason for stock lines. */
export function sessionDetail(e: AuditEntry): string | null {
  if (!e.new_data) return null;
  if (e.table_name === "sessions") {
    const parts = [e.new_data.device, e.new_data.ip].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (e.table_name === "stock_movements" && typeof e.new_data.note === "string" && e.new_data.note) {
    return `“${e.new_data.note}”`;
  }
  return null;
}

/** The item an entry is about, for the "history of this item" link. */
export function itemOf(e: AuditEntry, L: Lookups): Item | null {
  if (e.table_name === "items" && e.row_id) return L.items.get(Number(e.row_id)) ?? null;
  const d = (e.new_data ?? e.old_data ?? {}) as Record<string, unknown>;
  const id = num(d.item_id);
  return id !== null ? L.items.get(id) ?? null : null;
}
