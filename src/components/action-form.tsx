"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions";
import { Button, Notice } from "./ui";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Form wrapper around useActionState: renders the error / success notice and a
 * pending-aware submit button. Children are the fields.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  className,
  hidden,
  onDone,
  confirm,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "stamp" | "ghost";
  className?: string;
  hidden?: Record<string, string | number>;
  onDone?: (state: ActionState) => void;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    onDone?.(result);
    return result;
  }, null);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state && !state.ok && <div className="mt-3"><Notice tone="bad">{state.error}</Notice></div>}
      {state?.ok && state.message && <div className="mt-3"><Notice tone="ok">{state.message}</Notice></div>}
      <div className="mt-4">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? pendingLabel ?? "Working…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
