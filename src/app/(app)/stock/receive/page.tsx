import type { Metadata } from "next";
import { can, requirePermission } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import { LinkButton, PageHeader } from "@/components/ui";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Receive stock" };

/**
 * Record a delivery. Deliberately shows no current stock levels: the person
 * receiving records what physically arrived, not what the system expects.
 */
export default async function ReceivePage() {
  const me = await requirePermission("stock.write");
  const { items, categories, locations } = await getCatalog();

  return (
    <>
      <PageHeader
        title="Receive stock"
        help="receive"
        lead="Record a delivery as it arrives: where it is going, what came in, and how many. New items can be added to the catalog here."
        actions={<LinkButton href="/stock">Stock movements</LinkButton>}
      />
      <ReceiveForm
        items={items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, sku: i.sku, unit: i.unit }))}
        categories={categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
        locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
        canAddItems={can(me, "catalog.write")}
      />
    </>
  );
}
