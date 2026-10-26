import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeopleIndex, getStockLevels, nameOf } from "@/lib/queries";
import type { RequestEvent, RequestLine, RequestRow } from "@/lib/database.types";
import { PageHeader, Stamp, cx, formatDate, statusMeta } from "@/components/ui";
import { ActionPanel } from "./action-panel";

export const metadata: Metadata = { title: "Request" };

export default async function RequestPage({ params, searchParams }: PageProps<"/requests/[id]">) {
  const me = await requireMember();
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const supabase = await createClient();
  const [reqRes, linesRes, eventsRes, { items, locations }, people, levels] = await Promise.all([
    supabase.from("requests").select("*").eq("id", id).maybeSingle(),
    supabase.from("request_lines").select("*").eq("request_id", id).order("id"),
    supabase.from("request_events").select("*").eq("request_id", id).order("created_at"),
    getCatalog(),
    getPeopleIndex(),
    getStockLevels(),
  ]);
  const req = reqRes.data as RequestRow | null;
  if (!req) notFound();
  const lines = (linesRes.data ?? []) as RequestLine[];
  const events = (eventsRes.data ?? []) as RequestEvent[];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const stockAt = new Map(levels.filter((l) => l.location_id === req.location_id).map((l) => [l.item_id, l.quantity]));

  const isMine = req.requester_id === me.id;
  const stage: "review" | "approve" | "fulfill" | "cancel" | null =
    req.status === "submitted" && can(me, "requests.review") && !isMine ? "review"
    : (req.status === "recommended" || req.status === "not_recommended") && can(me, "requests.approve") && !isMine ? "approve"
    : req.status === "approved" && can(me, "requests.fulfill") ? "fulfill"
    : isMine && ["submitted", "recommended", "not_recommended"].includes(req.status) ? "cancel"
    : null;

  const justChanged = Boolean(sp.submitted || sp.done);
  const closed = ["fulfilled", "rejected", "cancelled"].includes(req.status);

  return (
    <>
      <div className="mb-2 text-sm text-ink-3"><Link href="/requests" className="hover:text-ink">Requests</Link> / {id}</div>
      <PageHeader
        title={req.purpose}
        lead={<>Raised by <strong className="text-ink">{nameOf(people, req.requester_id) || "a member"}</strong> on {formatDate(req.created_at, true)}, to collect from <strong className="text-ink">{nameOf(locations, req.location_id)}</strong>{req.needed_by && <>, needed by {formatDate(req.needed_by)}</>}.</>}
        actions={<Stamp status={req.status} size="lg" animate={justChanged} />}
      />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 overflow-x-auto">
          <h2 className="mb-2 text-lg font-semibold">Items</h2>
          <table className="register text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th className="r">Requested</th>
                {req.status !== "submitted" && req.status !== "cancelled" && <th className="r">Approved</th>}
                <th className="r">In stock there</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const item = itemMap.get(l.item_id);
                const have = stockAt.get(l.item_id) ?? 0;
                const need = l.approved_qty ?? l.requested_qty;
                return (
                  <tr key={l.id}>
                    <td><div className="font-medium">{item?.name ?? `Item ${l.item_id}`}</div>{item?.sku && <div className="text-xs text-ink-3">{item.sku}</div>}</td>
                    <td className="num r">{l.requested_qty} {item?.unit}</td>
                    {req.status !== "submitted" && req.status !== "cancelled" && (
                      <td className={cx("num r font-semibold", l.approved_qty === 0 && "text-ink-3 line-through")}>{l.approved_qty ?? "—"}</td>
                    )}
                    <td className={cx("num r", !closed && have < need ? "text-bad" : "text-ink-2")}>{have}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h2 className="mb-2 mt-10 text-lg font-semibold">History</h2>
          <ol className="border-l border-rule pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative pb-5 last:pb-0">
                <span aria-hidden className={cx("absolute -left-[26px] top-1.5 size-2.5 rounded-full border-2 border-paper", statusMeta[e.to_status].dot)} />
                <div className="text-sm">
                  <span className="font-medium">{statusMeta[e.to_status].label}</span>
                  <span className="text-ink-3"> · {nameOf(people, e.actor_id) || "—"} · {formatDate(e.created_at, true)}</span>
                </div>
                {e.note && <p className="mt-1 text-sm text-ink-2">“{e.note}”</p>}
              </li>
            ))}
          </ol>
        </div>

        <aside className="xl:sticky xl:top-8 xl:self-start">
          {stage ? (
            <ActionPanel
              stage={stage}
              requestId={req.id}
              status={req.status}
              lines={lines.map((l) => ({ id: l.id, name: itemMap.get(l.item_id)?.name ?? "", unit: itemMap.get(l.item_id)?.unit ?? "", requested: l.requested_qty, approved: l.approved_qty, inStock: stockAt.get(l.item_id) ?? 0 }))}
            />
          ) : (
            <div className="border-t border-ink pt-4 text-sm text-ink-2">
              {closed
                ? `This request is ${statusMeta[req.status].label.toLowerCase()}.`
                : req.status === "submitted" ? "Waiting for a reviewer."
                : req.status === "approved" ? "Approved. Waiting for the store to hand it over."
                : "Reviewed. Waiting for approval."}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
