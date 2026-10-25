import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState, homeFor } from "@/lib/auth";
import { EnrolFlow } from "./enrol-flow";

export const metadata: Metadata = { title: "Set up two-factor" };

export default async function MfaSetupPage() {
  const state = await getAuthState();
  if (state.kind !== "mfa_enrol") redirect(homeFor(state));
  return (
    <>
      <h1 className="text-3xl font-semibold">Set up your authenticator</h1>
      <p className="mt-2 text-ink-2">
        Everyone here signs in with a password and a code from an authenticator app.
        It takes a minute, once.
      </p>
      <div className="mt-8">
        <EnrolFlow email={state.me.email} />
      </div>
    </>
  );
}
