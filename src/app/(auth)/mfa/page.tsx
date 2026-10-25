import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState, homeFor } from "@/lib/auth";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function MfaPage() {
  const state = await getAuthState();
  if (state.kind !== "mfa_verify") redirect(homeFor(state));
  return (
    <>
      <h1 className="text-3xl font-semibold">Enter your code</h1>
      <p className="mt-2 text-ink-2">
        Open your authenticator app and type the 6-digit code for Store register.
      </p>
      <div className="mt-8">
        <VerifyForm />
      </div>
    </>
  );
}
