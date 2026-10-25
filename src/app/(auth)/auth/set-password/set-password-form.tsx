"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, Notice } from "@/components/ui";

export function SetPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("The two passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setPending(false);
      setError(error.message);
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="New password">
        <Input name="password" type="password" autoComplete="new-password" required minLength={12} autoFocus />
      </Field>
      <Field label="Type it again">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <Button type="submit" disabled={pending} className="w-full justify-center">
        {pending ? "Saving…" : "Save password and continue"}
      </Button>
    </form>
  );
}
