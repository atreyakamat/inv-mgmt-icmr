"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordAuthEvent } from "@/lib/auth-events";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Input, Notice } from "@/components/ui";
import { updateName } from "./actions";

export function NameForm({ name }: { name: string }) {
  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Name</h2>
      <ActionForm action={updateName} submitLabel="Save name" variant="secondary" className="mt-3">
        <Field label="Shown on requests and in the audit log"><Input name="full_name" required maxLength={120} defaultValue={name} /></Field>
      </ActionForm>
    </div>
  );
}

export function PasswordForm() {
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    if (password !== String(fd.get("confirm"))) return setState({ ok: false, message: "The two passwords do not match." });
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (!error) await recordAuthEvent("password_set");
    setPending(false);
    setState(error ? { ok: false, message: error.message } : { ok: true, message: "Password changed." });
    if (!error) e.currentTarget.reset();
  }

  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Password</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-4">
        <Field label="New password" hint="At least 12 characters"><Input name="password" type="password" autoComplete="new-password" required minLength={12} /></Field>
        <Field label="Type it again"><Input name="confirm" type="password" autoComplete="new-password" required minLength={12} /></Field>
        {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
      </form>
    </div>
  );
}
