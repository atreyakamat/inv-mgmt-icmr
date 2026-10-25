"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Notice } from "@/components/ui";
import { CodeInput } from "@/components/code-input";
import { SignOutButton } from "@/components/sign-out-button";

export function VerifyForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function verify(code: string) {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp.find((f) => f.status === "verified") ?? factors?.totp[0];
    if (fErr || !totp) {
      setPending(false);
      setError("No authenticator is set up for this account. Ask your admin to reset it.");
      return;
    }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if (error) {
      setPending(false);
      setAttempt((a) => a + 1);
      setError("That code did not work. Codes change every 30 seconds; try the current one.");
      return;
    }
    // Full navigation so the server sees the upgraded (aal2) session cookie.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <div className="space-y-5">
      <CodeInput key={attempt} onComplete={verify} disabled={pending} />
      {error && <Notice tone="bad">{error}</Notice>}
      <Button type="button" disabled={pending} className="w-full justify-center" onClick={() => {
        const el = document.querySelector<HTMLInputElement>("input[name=code]");
        if (el && el.value.length === 6) verify(el.value);
      }}>
        {pending ? "Checking…" : "Verify"}
      </Button>
      <div className="text-center text-sm text-ink-3">
        Lost your phone? Your admin can reset the authenticator. <SignOutButton className="underline underline-offset-2" />
      </div>
    </div>
  );
}
