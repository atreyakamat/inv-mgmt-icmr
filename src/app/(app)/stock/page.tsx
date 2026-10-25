import type { Metadata } from "next";
import Link from "next/link";
import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, nameOf } from "@/lib/queries";
import type { MovementKind, StockMovement } from "@/lib/database.types";
import { Empty, PageHeader, cx, formatDate } from "@/components/ui";
import { StockForms } from "./forms";

export const metadata: Metadata = { title: "Stock movements" };

const kindLabel: Record<MovementKind, string> = {
  receive: "Received",
  issue: "Issued",
  adjust: "Adjusted",
  transfer_out: "Moved out",
  transfer_in: "Moved in",
};

export default async function StockPage() {
  const me = await requirePermission("stock.write", "stock.read_history");
  const supabase = await createClient();
  const [{ items, locations }, people, movesRes] = await Promise.all([
    getCatalog(),
    getPeopleIndex(),
    supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(150),
  ]);
  const moves = (movesRes.data ?? []) as StockMovement[];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const canWrite = can(me, "stock.write");

  return (
    <>
      <PageHeader title="Stock movements" lead="The ledger. Every change to stock is a line here and cannot be edited; corrections are new lines." />

      <div className={cx("grid gap-10", canWrite && "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        <div>
          {moves.length === 0 ? (
            <Empty title="No movements yet">{canWrite ? "Receive the first stock using the form." : "Nothing has been received or issued."}</Empty>
          ) : (
            <table className="register text-sm">
              <thead>
                <tr><th>When</th><th>Item</th><th>Location</th><th>Kind</th><th className="r">Qty</th><th>Note</th><th>By</th></tr>
              </thead>
              <tbody>
                {moves.map((m) => {
                  const item = itemMap.get(m.item_id);
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-ink-3">{formatDate(m.created_at, true)}</td>
                      <td><div className="font-medium">{item?.name ?? m.item_id}</div></td>
                      <td className="text-ink-2">{nameOf(locations, m.location_id)}</td>
                      <td className="text-ink-2">{kindLabel[m.kind]}</td>
                      <td className={cx("num r font-semibold", m.quantity < 0 ? "text-bad" : "text-ok")}>{m.quantity > 0 ? "+" : ""}{m.quantity} <span className="font-normal text-ink-3">{item?.unit}</span></td>
                      <td className="max-w-[28ch] truncate text-ink-2">
                        {m.request_id ? <Link href={`/requests/${m.request_id}`} className="hover:underline">Request #{m.request_id}</Link> : m.note}
                      </td>
                      <td className="text-ink-3">{nameOf(people, m.created_by) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {canWrite && (
          <div className="lg:sticky lg:top-8 lg:self-start">
            <StockForms
              items={items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
              locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
            />
          </div>
        )}
      </div>
    </>
  );
}
