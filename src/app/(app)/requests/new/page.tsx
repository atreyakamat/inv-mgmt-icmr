import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { getCatalog, getStockLevels } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { NewRequestForm } from "./new-request-form";

export const metadata: Metadata = { title: "New request" };

export default async function NewRequestPage() {
  await requirePermission("requests.submit");
  const [{ items, categories, locations }, levels] = await Promise.all([getCatalog(), getStockLevels()]);

  const totals = new Map<number, number>();
  for (const l of levels) totals.set(l.item_id, (totals.get(l.item_id) ?? 0) + l.quantity);

  return (
    <>
      <PageHeader title="New request" lead="Pick what you need and say what it is for. A reviewer and the approver will see it next." help="requests" />
      <NewRequestForm
        items={items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, sku: i.sku, unit: i.unit, category_id: i.category_id, in_stock: totals.get(i.id) ?? 0 }))}
        categories={categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
        locations={locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))}
      />
    </>
  );
}
