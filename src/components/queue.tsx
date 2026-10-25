import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getCatalog, getPeopleIndex, getRequests, nameOf } from "@/lib/queries";
import type { PermissionKey, RequestStatus } from "@/lib/database.types";
import { Empty, PageHeader, StatusPill, formatDate } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

/** Shared page for the three work queues: review, approve, hand over. */
export async function QueuePage({
  permission,
  statuses,
  title,
  lead,
  emptyTitle,
}: {
  permission: PermissionKey;
  statuses: RequestStatus[];
  title: string;
  lead: string;
  emptyTitle: string;
}) {
  const me = await requirePermission(permission);
  const supabase = await createClient();
  const [requests, people, { locations }, linesRes] = await Promise.all([
    getRequests({ status: statuses }),
    getPeopleIndex(),
    getCatalog(),
    supabase.from("request_lines").select("request_id"),
  ]);
  const lineCount = new Map<number, number>();
  for (const l of linesRes.data ?? []) lineCount.set(l.request_id, (lineCount.get(l.request_id) ?? 0) + 1);
  const actionable = requests.filter((r) => r.requester_id !== me.id || permission === "requests.fulfill");
  const own = requests.length - actionable.length;

  return (
    <>
      <PageHeader title={title} lead={lead} />
      {actionable.length === 0 ? (
        <Empty title={emptyTitle}>{own > 0 && `${own} of your own request${own > 1 ? "s are" : " is"} here, but someone else has to act on ${own > 1 ? "them" : "it"}.`}</Empty>
      ) : (
        <table className="register text-sm">
          <thead>
            <tr><th>#</th><th>Purpose</th><th>Raised by</th><th>For</th><th className="r">Items</th><th>Status</th><th className="r">Waiting since</th></tr>
          </thead>
          <tbody>
            {actionable.map((r) => (
              <tr key={r.id}>
                <td className="num"><Link href={`/requests/${r.id}`} className="font-medium hover:underline">{r.id}</Link></td>
                <td className="max-w-[36ch] truncate"><Link href={`/requests/${r.id}`} className="hover:underline">{r.purpose}</Link></td>
                <td className="text-ink-2">{nameOf(people, r.requester_id) || "—"}</td>
                <td className="text-ink-2">{nameOf(locations, r.location_id)}</td>
                <td className="num r">{lineCount.get(r.id) ?? 0}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="r text-ink-3">{formatDate(r.updated_at, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
