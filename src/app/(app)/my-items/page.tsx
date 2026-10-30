import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getMyItems } from "@/lib/my-items";
import { Empty, LinkButton, PageHeader, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "My items" };

export default async function MyItemsPage() {
  const me = await requirePermission("requests.submit");
  const s = await getMyItems(me.id);

  return (
    <>
      <PageHeader
        title="My items"
        help="my-items"
        lead="Everything the store has handed over to you, by category. Counts come from your completed requests."
        actions={<LinkButton href="/requests/new" variant="primary">New request</LinkButton>}
      />

      {s.handedOver === 0 ? (
        <Empty title="Nothing handed over to you yet">
          Items appear here once the store hands over one of your approved requests.
          {s.inProgress > 0 && <> You have <Link href="/requests" className="underline">{s.inProgress} in progress</Link>.</>}
        </Empty>
      ) : (
        <>
          {/* Sentence-style summary: the numbers people asked for, in one line. */}
          <p className="mb-10 max-w-3xl text-2xl leading-snug md:text-3xl">
            <span className="num font-semibold">{s.units}</span> units of{" "}
            <span className="num font-semibold">{s.distinctItems}</span> {s.distinctItems === 1 ? "item" : "different items"} across{" "}
            <span className="num font-semibold">{s.categories.length}</span> {s.categories.length === 1 ? "category" : "categories"}, from{" "}
            <span className="num font-semibold">{s.handedOver}</span> {s.handedOver === 1 ? "request" : "requests"}
            {s.firstReceived && <span className="text-ink-3"> since {formatDate(s.firstReceived)}</span>}.
            {s.inProgress > 0 && (
              <span className="block text-base text-ink-2">
                <Link href="/requests" className="underline underline-offset-2">{s.inProgress} more in progress</Link>
              </span>
            )}
          </p>

          <div className="space-y-10">
            {s.categories.map((g) => (
              <section key={g.category.id}>
                <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-ink pb-2">
                  <h2 className="text-lg font-semibold">{g.category.name}</h2>
                  <span className="num text-sm text-ink-3">
                    {g.items.length} {g.items.length === 1 ? "item" : "items"} · {g.units} units
                  </span>
                </div>
                <table className="register text-sm">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="r">Received</th>
                      <th className="r">Times</th>
                      <th className="r">Last received</th>
                      <th>Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r) => (
                      <tr key={r.item.id}>
                        <td>
                          <div className="font-medium">{r.item.name}</div>
                          {r.item.sku && <div className="text-xs text-ink-3">{r.item.sku}</div>}
                        </td>
                        <td className="num r font-semibold">{r.quantity} <span className="font-normal text-ink-3">{r.item.unit}</span></td>
                        <td className="num r text-ink-2">{r.times}</td>
                        <td className="r text-ink-3">{formatDate(r.lastReceived)}</td>
                        <td className="text-ink-2">
                          {r.requestIds.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ", "}
                              <Link href={`/requests/${id}`} className="hover:underline">#{id}</Link>
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
