import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import type { Item } from "@/lib/database.types";
import { Empty, PageHeader, cx } from "@/components/ui";
import { EntryForm, ToggleActive } from "./forms";

export const metadata: Metadata = { title: "Catalog" };

const tabs = [
  { key: "items", label: "Items" },
  { key: "categories", label: "Categories" },
  { key: "locations", label: "Locations" },
] as const;

export default async function CatalogPage({ searchParams }: PageProps<"/catalog">) {
  await requirePermission("catalog.write");
  const sp = await searchParams;
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "items";
  const editId = typeof sp.edit === "string" ? Number(sp.edit) : null;
  const showRetired = sp.retired === "1";

  const { items, categories, locations } = await getCatalog();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const catOptions = categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }));

  const list = tab === "items" ? items : tab === "categories" ? categories : locations;
  const rows = list.filter((r) => showRetired || r.active);
  const editing = editId ? list.find((r) => r.id === editId) ?? null : null;

  return (
    <>
      <PageHeader
        title="Catalog"
        lead="What the store stocks and where. Nothing is deleted here; retired entries keep their history."
      />

      <div className="mb-6 flex flex-wrap items-center gap-1 text-sm">
        {tabs.map((t) => (
          <Link key={t.key} href={{ pathname: "/catalog", query: { tab: t.key } }} className={cx("rounded-sm px-3 py-1.5", tab === t.key ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}>
            {t.label}
          </Link>
        ))}
        <Link href={{ pathname: "/catalog", query: { tab, ...(showRetired ? {} : { retired: "1" }) } }} className="ml-auto text-ink-3 hover:text-ink">
          {showRetired ? "Hide retired" : "Show retired"}
        </Link>
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 overflow-x-auto">
          {rows.length === 0 ? (
            <Empty title={`No ${tab} yet`}>
              {tab === "items" && categories.filter((c) => c.active).length === 0
                ? "Add a category first, then items."
                : "Use the form to add the first one."}
            </Empty>
          ) : (
            <table className="register text-sm">
              <thead>
                <tr>
                  <th>Name</th>
                  {tab === "items" && <><th>Category</th><th>Unit</th><th className="r">Reorder at</th></>}
                  {tab !== "items" && <th>Description</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const item = tab === "items" ? (r as Item) : null;
                  return (
                  <tr key={r.id} className={cx(!r.active && "text-ink-3")}>
                    <td>
                      <div className="font-medium">{r.name}{!r.active && <span className="ml-2 text-xs font-normal">retired</span>}</div>
                      {item?.sku && <div className="text-xs text-ink-3">{item.sku}</div>}
                    </td>
                    {item && (
                      <>
                        <td className="text-ink-2">{catName.get(item.category_id)}</td>
                        <td className="text-ink-2">{item.unit}</td>
                        <td className="num r">{item.reorder_level || "—"}</td>
                      </>
                    )}
                    {tab !== "items" && <td className="max-w-[40ch] truncate text-ink-2">{r.description}</td>}
                    <td className="r whitespace-nowrap">
                      <Link href={{ pathname: "/catalog", query: { tab, edit: r.id, ...(showRetired && { retired: "1" }) } }} className="mr-3 text-ink-2 hover:underline">Edit</Link>
                      <ToggleActive kind={tab} id={r.id} active={r.active} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="xl:sticky xl:top-8 xl:self-start">
          <EntryForm
            key={`${tab}-${editing?.id ?? "new"}`}
            kind={tab}
            entry={editing}
            categories={catOptions}
            cancelHref={`/catalog?tab=${tab}`}
          />
        </div>
      </div>
    </>
  );
}
