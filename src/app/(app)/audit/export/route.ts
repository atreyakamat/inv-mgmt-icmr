import { can, getAuthState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, getRoles } from "@/lib/queries";
import { changes, describe, fetchAll, how, matchItems, parseFilters, sessionDetail, who, type Lookups } from "../lib";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise formulas so a cell never runs in Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

const ist = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The audit log as CSV, with the same filters as the page. */
export async function GET(request: Request) {
  const state = await getAuthState();
  if (state.kind !== "member" || !can(state.me, "audit.read")) {
    return new Response("You do not have permission to download the audit log.", { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const f = parseFilters(sp);

  const supabase = await createClient();
  const [{ items, categories, locations }, people, roles] = await Promise.all([getCatalog(), getPeopleIndex(), getRoles()]);
  const L: Lookups = {
    people,
    roles: new Map(roles.map((r) => [r.id, r])),
    items: new Map(items.map((i) => [i.id, i])),
    categories: new Map(categories.map((c) => [c.id, c])),
    locations: new Map(locations.map((l) => [l.id, l])),
  };
  const entries = await fetchAll(supabase, f, matchItems(items, f.item));

  const header = ["Entry", "When (IST)", "Who", "How", "What", "Details", "Changes", "Note", "Table", "Row", "Action", "Seal"];
  const lines = [header.map(cell).join(",")];
  for (const e of entries) {
    lines.push([
      e.seq, ist(e.created_at), who(e, L), how(e), describe(e, L), sessionDetail(e) ?? "",
      changes(e, L).join("; "), e.note ?? "", e.table_name ?? "", e.row_id ?? "", e.action,
      e.hash.replace(/^\\x/, "").slice(0, 16),
    ].map(cell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
