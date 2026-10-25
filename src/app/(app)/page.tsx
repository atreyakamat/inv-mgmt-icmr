import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, getRequests, nameOf } from "@/lib/queries";
import type { LowStock } from "@/lib/database.types";
import { Empty, Figure, LinkButton, PageHeader, Section, StatusPill, formatDate } from "@/components/ui";

export default async function OverviewPage() {
  const me = await requireMember();
  const supabase = await createClient();

  const [{ items, locations }, low, requests, people] = await Promise.all([
    getCatalog(),
    supabase.from("low_stock").select("*").order("quantity"),
    getRequests(),
    getPeopleIndex(),
  ]);
  const lowStock = (low.data ?? []) as LowStock[];

  const waitingOnMe = requests.filter((r) =>
    (r.status === "submitted" && can(me, "requests.review")) ||
    ((r.status === "recommended" || r.status === "not_recommended") && can(me, "requests.approve")) ||
    (r.status === "approved" && can(me, "requests.fulfill")),
  );
  const mine = requests.filter((r) => r.requester_id === me.id && !["fulfilled", "rejected", "cancelled"].includes(r.status));
  const queueHref = can(me, "requests.review") ? "/review" : can(me, "requests.approve") ? "/approve" : "/hand-over";

  const hour = Number(new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me.full_name.split(" ")[0]}`}
        lead={`${items.filter((i) => i.active).length} items across ${locations.filter((l) => l.active).length} locations.`}
        actions={can(me, "requests.submit") && <LinkButton href="/requests/new" variant="primary">New request</LinkButton>}
      />

      <div className="grid gap-x-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          {waitingOnMe.length > 0 && (
            <Link href={queueHref} className="block hover:bg-sheet-tint">
              <Figure value={waitingOnMe.length} label={waitingOnMe.length === 1 ? "request waiting on you" : "requests waiting on you"} tone="text-stamp" />
            </Link>
          )}
          <Link href="/inventory?filter=low" className="block hover:bg-sheet-tint">
            <Figure value={lowStock.length} label="below reorder level" tone={lowStock.length ? "text-warn" : undefined} />
          </Link>
          <Link href="/requests" className="block hover:bg-sheet-tint">
            <Figure value={mine.length} label="of your requests in progress" />
          </Link>
        </div>

        <div>
          <Section title="Low stock" aside={<Link href="/inventory?filter=low" className="text-sm text-ink-3 hover:text-ink">All</Link>}>
            {lowStock.length === 0 ? (
              <Empty title="Nothing below its reorder level" />
            ) : (
              <table className="register text-sm">
                <thead><tr><th>Item</th><th className="r">Left in total</th><th className="r">Reorder at</th><th>Where</th></tr></thead>
                <tbody>
                  {lowStock.slice(0, 8).map((r) => (
                    <tr key={r.item_id}>
                      <td>{r.item_name}{r.sku && <span className="ml-2 text-ink-3">{r.sku}</span>}</td>
                      <td className={`num r font-semibold ${r.quantity === 0 ? "text-bad" : "text-warn"}`}>{r.quantity} {r.unit}</td>
                      <td className="num r text-ink-3">{r.reorder_level}</td>
                      <td className="max-w-[24ch] truncate text-ink-3">{r.held_at || "None left"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Recent requests" aside={<Link href="/requests" className="text-sm text-ink-3 hover:text-ink">All</Link>}>
            {requests.length === 0 ? (
              <Empty title="No requests yet">{can(me, "requests.submit") && <Link href="/requests/new" className="underline">Raise the first one</Link>}</Empty>
            ) : (
              <table className="register text-sm">
                <thead><tr><th>#</th><th>Purpose</th><th>By</th><th>Status</th><th className="r">Raised</th></tr></thead>
                <tbody>
                  {requests.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td className="num"><Link href={`/requests/${r.id}`} className="font-medium hover:underline">{r.id}</Link></td>
                      <td className="max-w-[28ch] truncate">{r.purpose}</td>
                      <td className="text-ink-2">{nameOf(people, r.requester_id) || "—"}</td>
                      <td><StatusPill status={r.status} /></td>
                      <td className="r text-ink-3">{formatDate(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
