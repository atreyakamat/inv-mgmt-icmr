import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Me, PermissionKey } from "@/lib/database.types";

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "misconfigured"; reason: string }
  | { kind: "no_profile"; email: string }
  | { kind: "mfa_enrol"; me: Me }
  | { kind: "mfa_verify"; me: Me }
  | { kind: "inactive"; me: Me }
  | { kind: "member"; me: Me };

/**
 * One authoritative read of who is calling and what step of sign-in they are
 * at. Cached per request.
 */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return { kind: "anonymous" };

  const { data: me, error } = await supabase.rpc("me");
  if (error) {
    // A missing profile returns null, not an error. An error here means the
    // app cannot reach the inventory schema at all: fail loudly, never as "no access".
    return {
      kind: "misconfigured",
      reason:
        error.code === "PGRST106"
          ? "The inventory schema is not exposed. In Supabase, open Project Settings → Data API → Exposed schemas, add inventory and save."
          : `The database returned an error: ${error.message}`,
    };
  }
  if (!me) return { kind: "no_profile", email: String(claims.claims.email ?? "") };
  if (!me.active) return { kind: "inactive", me };

  if (!me.mfa_verified) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    // nextLevel aal1 = no factor enrolled yet; aal2 = factor exists, needs a code
    return aal?.nextLevel === "aal2" ? { kind: "mfa_verify", me } : { kind: "mfa_enrol", me };
  }
  return { kind: "member", me };
});

/** Where a user in a given state belongs. */
export function homeFor(state: AuthState): string {
  switch (state.kind) {
    case "anonymous":
      return "/login";
    case "no_profile":
    case "misconfigured":
      return "/no-access";
    case "inactive":
      return "/no-access";
    case "mfa_enrol":
      return "/mfa/setup";
    case "mfa_verify":
      return "/mfa";
    case "member":
      return "/";
  }
}

/** For pages inside the app: returns the member or redirects to the right step. */
export async function requireMember(): Promise<Me> {
  const state = await getAuthState();
  if (state.kind !== "member") redirect(homeFor(state));
  return state.me;
}

export async function requirePermission(...keys: PermissionKey[]): Promise<Me> {
  const me = await requireMember();
  if (!keys.some((k) => me.permissions.includes(k))) redirect("/");
  return me;
}

export function can(me: Me, ...keys: PermissionKey[]) {
  return keys.some((k) => me.permissions.includes(k));
}
