import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import { LinkButton, PageHeader } from "@/components/ui";
import { AdjustForm, TransferForm } from "./forms";

export const metadata: Metadata = { title: "Correct or move stock" };

export default async function AdjustPage() {
  await requirePermission("stock.write");
  const { items, locations } = await getCatalog();
  const itemOpts = items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, unit: i.unit, sku: i.sku }));
  const locOpts = locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }));

  return (
    <>
      <PageHeader
        title="Correct or move stock"
        help="correct"
        lead="For anything that is not a delivery or a hand-over: count corrections, damage, loss, and moving stock between locations. Every change is kept in the ledger with your reason."
        actions={<LinkButton href="/stock">Stock movements</LinkButton>}
      />
      <div className="grid gap-12 lg:grid-cols-2">
        <AdjustForm items={itemOpts} locations={locOpts} />
        <TransferForm items={itemOpts} locations={locOpts} />
      </div>
    </>
  );
}
