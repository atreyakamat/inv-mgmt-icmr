"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "@/components/ui";

/**
 * Lands every email link. Supabase sends three shapes:
 *  - ?code=…                      PKCE (password reset started in this browser)
 *  - #access_token=…&refresh_token=…  implicit (invites and resets sent by an admin)
 *  - ?token_hash=…&type=…         custom email templates
 * The hash is never sent to the server, so this has to run in the browser.
 */
export function CallbackHandler() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const next = params.get("next");
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/auth/set-password";

      const hash = new URLSearchParams(window.location.hash.slice(1));
      const hashError = hash.get("error_description") ?? params.get("error_description");
      if (hashError) {
        setError(hashError.replace(/\+/g, " "));
        return;
      }

      let failed: string | undefined;
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        failed = error?.message;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        failed = error?.message;
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        failed = error?.message;
      } else {
        failed = "This link is missing its sign-in details.";
      }

      if (failed) {
        setError(failed);
        return;
      }
      // Drop the tokens from the address bar before moving on.
      window.history.replaceState(null, "", "/auth/callback");
      window.location.assign(target);
    })();
  }, [params]);

  if (!error) return <p className="text-ink-2">Checking your link…</p>;
  return (
    <>
      <h1 className="text-3xl font-semibold">This link did not work</h1>
      <div className="mt-4"><Notice tone="bad">{error}</Notice></div>
      <p className="mt-4 text-sm text-ink-2">
        Links work once and expire after an hour. Ask the Super User to resend it, or{" "}
        <Link href="/auth/forgot" className="underline underline-offset-2">request a new reset link</Link>.
      </p>
    </>
  );
}
