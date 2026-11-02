"use client";

import { useActionState } from "react";
import { checkSeal, type SealResult } from "./actions";
import { cx, formatDate } from "@/components/ui";

export function SealCheck() {
  const [result, run, pending] = useActionState<SealResult>(checkSeal, null);
  const check = result?.ok ? result.check : null;

  return (
    <div
      data-tour="audit-seal"
      className={cx(
        "mb-6 flex flex-wrap items-center justify-between gap-4 rounded-sm border px-4 py-3 text-sm",
        check?.ok === true && "border-ok/40 bg-ok-soft",
        check?.ok === false && "border-bad/40 bg-bad-soft",
        !check && "border-rule bg-sheet",
      )}
      aria-live="polite"
    >
      <div className="min-w-0">
        {!result && (
          <>
            <div className="font-medium">Sealed log</div>
            <div className="text-ink-2">Each entry is locked to the one before it. Check that nothing was edited or removed.</div>
          </>
        )}
        {result && !result.ok && <div className="text-bad">{result.error}</div>}
        {check?.ok === true && (
          <>
            <div className="font-medium text-ok">Intact: all {check.checked.toLocaleString("en-IN")} entries match their seal</div>
            <div className="text-ink-2">
              Checked {formatDate(check.checked_at, true)}. Latest seal{" "}
              <code className="break-all font-mono text-xs" title="Compare with the seal printed by the nightly backup">
                #{check.checked} · {check.hash.slice(0, 16)}…
              </code>
            </div>
          </>
        )}
        {check?.ok === false && (
          <>
            <div className="font-medium text-bad">Broken at entry #{check.at}</div>
            <div className="text-ink-2">{check.problem}. Entries before it ({check.checked.toLocaleString("en-IN")}) are intact. Compare with the latest backup.</div>
          </>
        )}
      </div>
      <form action={run}>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm border border-rule bg-paper px-3.5 py-2 font-medium hover:border-ink-3 disabled:opacity-60"
        >
          {pending ? "Checking…" : result ? "Check again" : "Check the seal"}
        </button>
      </form>
    </div>
  );
}
