"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Notice } from "@/components/ui";
import { CodeInput } from "@/components/code-input";
import { SignOutButton } from "@/components/sign-out-button";

type Enrolment = { factorId: string; qr: string; secret: string };

export function EnrolFlow({ email }: { email: string }) {
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      // Remove any half-finished enrolment so a fresh QR is shown.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Store register (${email})`,
        issuer: "Store register",
      });
      if (error || !data) {
        setError(error?.message ?? "Could not start setup. Reload to try again.");
        return;
      }
      setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [email]);

  async function verify(code: string) {
    if (!enrolment) return;
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolment.factorId, code });
    if (error) {
      setPending(false);
      setAttempt((a) => a + 1);
      setError("That code did not match. Wait for the next code and try again.");
      return;
    }
    // Full navigation so the server sees the upgraded (aal2) session cookie.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-5 text-sm text-ink-2">
        <li className="flex gap-3">
          <span className="num w-5 shrink-0 font-semibold text-ink">1</span>
          <span>Install Google Authenticator, Microsoft Authenticator or Authy on your phone.</span>
        </li>
        <li className="flex gap-3">
          <span className="num w-5 shrink-0 font-semibold text-ink">2</span>
          <div className="flex-1">
            <span>Scan this code in the app.</span>
            <div className="mt-3 inline-block rounded-sm border border-rule bg-sheet p-3">
              {enrolment ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={enrolment.qr} alt="QR code for your authenticator app" width={176} height={176} />
              ) : (
                <div className="size-44 animate-pulse bg-sheet-tint" />
              )}
            </div>
            {enrolment && (
              <div className="mt-2 text-xs">
                <button type="button" className="underline underline-offset-2" onClick={() => setShowSecret((s) => !s)}>
                  {showSecret ? "Hide" : "Can't scan? Show the key"}
                </button>
                {showSecret && (
                  <code className="mt-1 block select-all break-all rounded-sm bg-sheet-tint p-2 font-mono text-ink">
                    {enrolment.secret}
                  </code>
                )}
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="num w-5 shrink-0 font-semibold text-ink">3</span>
          <div className="flex-1">
            <span className="mb-3 block">Type the 6-digit code the app shows.</span>
            <CodeInput key={attempt} onComplete={verify} disabled={pending || !enrolment} autoFocus={false} />
          </div>
        </li>
      </ol>
      {error && <Notice tone="bad">{error}</Notice>}
      <Button type="button" disabled={pending || !enrolment} className="w-full justify-center" onClick={() => {
        const el = document.querySelector<HTMLInputElement>("input[name=code]");
        if (el && el.value.length === 6) verify(el.value);
      }}>
        {pending ? "Checking…" : "Finish setup"}
      </Button>
      <p className="text-center text-sm text-ink-3">
        Not you? <SignOutButton className="underline underline-offset-2" />
      </p>
    </div>
  );
}
