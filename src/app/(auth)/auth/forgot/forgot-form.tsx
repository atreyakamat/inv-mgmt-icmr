"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, Notice } from "@/components/ui";

export function ForgotForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email")).trim().toLowerCase();
    await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/set-password`,
    });
    // Same response whether or not the address exists.
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Notice tone="ok">If that address has an account, the reset link is on its way.</Notice>
        <Link href="/login" className="text-sm underline underline-offset-2">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Button type="submit" disabled={pending} className="w-full justify-center">
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        <Link href="/login" className="underline-offset-2 hover:underline">Back to sign in</Link>
      </p>
    </form>
  );
}
