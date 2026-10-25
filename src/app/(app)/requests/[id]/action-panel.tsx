"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RequestStatus } from "@/lib/database.types";
import { ActionForm } from "@/components/action-form";
import { Field, Textarea, cx } from "@/components/ui";
import { approveRequest, cancelRequest, fulfillRequest, rejectRequest, reviewRequest } from "../actions";

type Line = { id: number; name: string; unit: string; requested: number; approved: number | null; inStock: number };

export function ActionPanel({
  stage,
  requestId,
  status,
  lines,
}: {
  stage: "review" | "approve" | "fulfill" | "cancel";
  requestId: number;
  status: RequestStatus;
  lines: Line[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"act" | "reject">("act");
  const done = () => router.replace(`/requests/${requestId}?done=1`);

  const heading = { review: "Your review", approve: "Your decision", fulfill: "Hand over", cancel: "Cancel this request" }[stage];
  const short = lines.filter((l) => (l.approved ?? l.requested) > l.inStock);

  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">{heading}</h2>

      {stage === "review" && (
        <>
          <p className="mt-1 text-sm text-ink-2">Recommend it or not. The approver sees your note either way.</p>
          {short.length > 0 && <p className="mt-2 text-sm text-warn">{short.length} item{short.length > 1 ? "s are" : " is"} short at that location.</p>}
          <ReviewForms requestId={requestId} onDone={done} />
        </>
      )}

      {stage === "approve" && (
        <>
          {status === "not_recommended" && <p className="mt-1 text-sm text-warn">The reviewer did not recommend this one.</p>}
          <div className="mt-3 flex gap-1 text-sm">
            <Tab active={mode === "act"} onClick={() => setMode("act")}>Approve</Tab>
            <Tab active={mode === "reject"} onClick={() => setMode("reject")}>Reject</Tab>
          </div>
          {mode === "act" ? (
            <ActionForm action={approveRequest} hidden={{ id: requestId }} submitLabel="Approve and send to store" pendingLabel="Stamping…" variant="stamp" onDone={(s) => s?.ok && done()}>
              <p className="mb-3 mt-3 text-sm text-ink-2">Change quantities if needed. Set one to 0 to drop it.</p>
              <ul className="divide-y divide-rule-soft border-y border-rule text-sm">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <div>{l.name}</div>
                      <div className={cx("text-xs", l.requested > l.inStock ? "text-warn" : "text-ink-3")}>asked {l.requested} · {l.inStock} in stock</div>
                    </div>
                    <input type="number" name={`approved[${l.id}]`} defaultValue={l.requested} min={0} max={100000} className="field num w-24 py-1.5 text-right" aria-label={`Approved quantity for ${l.name}`} />
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Field label="Note (optional)"><Textarea name="note" rows={2} /></Field>
              </div>
            </ActionForm>
          ) : (
            <RejectForm requestId={requestId} onDone={done} />
          )}
        </>
      )}

      {stage === "fulfill" && (
        <>
          <div className="mt-3 flex gap-1 text-sm">
            <Tab active={mode === "act"} onClick={() => setMode("act")}>Hand over</Tab>
            <Tab active={mode === "reject"} onClick={() => setMode("reject")}>Can’t fulfil</Tab>
          </div>
          {mode === "act" ? (
            <ActionForm action={fulfillRequest} hidden={{ id: requestId }} submitLabel="Mark handed over" pendingLabel="Issuing stock…" variant="stamp" onDone={(s) => s?.ok && done()}>
              <p className="mb-3 mt-3 text-sm text-ink-2">Stock is deducted the moment you confirm. {short.length > 0 && <span className="text-bad">{short.length} item{short.length > 1 ? "s are" : " is"} short, so this will fail unless stock is received first.</span>}</p>
              <Field label="Note (optional)"><Textarea name="note" rows={2} placeholder="e.g. Collected by Priya at the counter" /></Field>
            </ActionForm>
          ) : (
            <RejectForm requestId={requestId} onDone={done} />
          )}
        </>
      )}

      {stage === "cancel" && (
        <ActionForm action={cancelRequest} hidden={{ id: requestId }} submitLabel="Cancel request" variant="danger" confirm="Cancel this request? This cannot be undone." onDone={(s) => s?.ok && done()}>
          <p className="mb-3 mt-1 text-sm text-ink-2">You can cancel until it is approved.</p>
          <Field label="Reason (optional)"><Textarea name="note" rows={2} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

function ReviewForms({ requestId, onDone }: { requestId: number; onDone: () => void }) {
  const [decision, setDecision] = useState<"recommend" | "not">("recommend");
  return (
    <>
      <div className="mt-3 flex gap-1 text-sm">
        <Tab active={decision === "recommend"} onClick={() => setDecision("recommend")}>Recommend</Tab>
        <Tab active={decision === "not"} onClick={() => setDecision("not")}>Don’t recommend</Tab>
      </div>
      <ActionForm
        key={decision}
        action={reviewRequest}
        hidden={{ id: requestId, decision }}
        submitLabel={decision === "recommend" ? "Send to approver as recommended" : "Send to approver as not recommended"}
        variant={decision === "recommend" ? "stamp" : "secondary"}
        onDone={(s) => s?.ok && onDone()}
      >
        <div className="mt-3">
          <Field label={decision === "recommend" ? "Note (optional)" : "Why not?"}>
            <Textarea name="note" rows={3} required={decision === "not"} />
          </Field>
        </div>
      </ActionForm>
    </>
  );
}

function RejectForm({ requestId, onDone }: { requestId: number; onDone: () => void }) {
  return (
    <ActionForm action={rejectRequest} hidden={{ id: requestId }} submitLabel="Reject request" variant="danger" onDone={(s) => s?.ok && onDone()}>
      <div className="mt-3">
        <Field label="Why?" hint="The requester will see this."><Textarea name="note" rows={3} required /></Field>
      </div>
    </ActionForm>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cx("rounded-sm px-3 py-1.5", active ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}>
      {children}
    </button>
  );
}
