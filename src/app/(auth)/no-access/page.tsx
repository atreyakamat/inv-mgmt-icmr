import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState, homeFor } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const state = await getAuthState();
  if (state.kind === "misconfigured") {
    return (
      <>
        <h1 className="text-3xl font-semibold">Setup incomplete</h1>
        <p className="mt-3 text-ink-2">Your sign-in worked, but the app cannot reach its database yet. This is a configuration step for whoever runs the system, not a problem with your account.</p>
        <p className="mt-4 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">{state.reason}</p>
        <div className="mt-8">
          <SignOutButton className="rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">Sign out</SignOutButton>
        </div>
      </>
    );
  }
  if (state.kind !== "no_profile" && state.kind !== "inactive") redirect(homeFor(state));

  const email = state.kind === "no_profile" ? state.email : state.me.email;
  return (
    <>
      <h1 className="text-3xl font-semibold">
        {state.kind === "inactive" ? "This account is deactivated" : "No access yet"}
      </h1>
      <p className="mt-3 text-ink-2">
        {state.kind === "inactive"
          ? "Your account exists but has been switched off. If that is a mistake, ask your admin to reactivate it."
          : <>You are signed in as <strong className="text-ink">{email}</strong>, but this account has not been added to the store register. Ask your admin to add you.</>}
      </p>
      <div className="mt-8">
        <SignOutButton className="rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">
          Sign out
        </SignOutButton>
      </div>
    </>
  );
}
