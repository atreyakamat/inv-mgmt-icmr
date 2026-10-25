import type { Metadata } from "next";
import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { getCatalog, getPeopleIndex, getRequests, nameOf } from "@/lib/queries";
import type { RequestStatus } from "@/lib/database.types";
import { Empty, LinkButton, PageHeader, StatusPill, cx, formatDate } from "@/components/ui";

export const metadata: Metadata = { title: "Requests" };

const tabs: { key: string; label: string; statuses?: RequestStatus[] }[] = [
  { key: "open", label: "In progress", statuses: ["submitted", "recommended", "not_recommended", "approved"] },
  { key: "done", label: "Closed", statuses: ["fulfilled", "rejected", "cancelled"] },
  { key: "all", label: "All" },
];

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const me = await requireMember();
  const sp = await searchParams;
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const seesAll = can(me, "requests.read_all");

  const [requests, people, { locations }] = await Promise.all([
    getRequests({ status: tab.statuses }),
    getPeopleIndex(),
    getCatalog(),
  ]);

  return (
    <>
      <PageHeader
        title="Requests"
        lead={seesAll ? "Every request raised in the store." : "Requests you have raised."}
        actions={can(me, "requests.submit") && <LinkButton href="/requests/new" variant="primary">New request</LinkButton>}
      />

      <div className="mb-5 flex gap-1 text-sm">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={{ pathname: "/requests", query: t.key === "open" ? {} : { tab: t.key } }}
            className={cx("rounded-sm px-3 py-1.5", tab.key === t.key ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <Empty title={tab.key === "open" ? "Nothing in progress" : "No requests here"}>
          {can(me, "requests.submit") && <Link href="/requests/new" className="underline">Raise a request</Link>}
        </Empty>
      ) : (
        <table className="register text-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Purpose</th>
              {seesAll && <th>Raised by</th>}
              <th>For</th>
              <th>Status</th>
              <th className="r">Raised</th>
              <th className="r">Needed by</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="num"><Link href={`/requests/${r.id}`} className="font-medium hover:underline">{r.id}</Link></td>
                <td className="max-w-[36ch] truncate"><Link href={`/requests/${r.id}`} className="hover:underline">{r.purpose}</Link></td>
                {seesAll && <td className="text-ink-2">{nameOf(people, r.requester_id) || "—"}</td>}
                <td className="text-ink-2">{nameOf(locations, r.location_id)}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="r text-ink-3">{formatDate(r.created_at)}</td>
                <td className="r text-ink-3">{r.needed_by ? formatDate(r.needed_by) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
