"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, Input, Notice } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim().toLowerCase(),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      setError(
        error.message.toLowerCase().includes("invalid")
          ? "Email or password is incorrect."
          : error.message,
      );
      return;
    }
    // Full navigation so the server sees the new cookies and routes to MFA.
    window.location.assign(next);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Work email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <Button type="submit" disabled={pending} className="w-full justify-center">
        {pending ? "Signing in…" : "Continue"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        <Link href="/auth/forgot" className="underline-offset-2 hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}
