"use client";

import { createClient } from "@/lib/supabase/client";
import { recordAuthEvent } from "@/lib/auth-events";

export function SignOutButton({ className, children = "Sign out" }: { className?: string; children?: React.ReactNode }) {
  async function signOut() {
    await recordAuthEvent("sign_out");
    await createClient().auth.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  return (
    <button type="button" onClick={signOut} className={className}>
      {children}
    </button>
  );
}
