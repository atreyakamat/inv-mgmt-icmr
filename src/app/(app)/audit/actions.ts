"use server";

import { createClient } from "@/lib/supabase/server";
import { can, getAuthState } from "@/lib/auth";
import type { SealCheck } from "@/lib/database.types";

export type SealResult = { ok: true; check: SealCheck } | { ok: false; error: string } | null;

/** Re-reads every audit entry and checks the seal. */
export async function checkSeal(): Promise<SealResult> {
  const state = await getAuthState();
  if (state.kind !== "member" || !can(state.me, "audit.read")) return { ok: false, error: "You do not have permission to do this." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_audit_log");
  if (error || !data) {
    console.error("[checkSeal]", error?.message);
    return { ok: false, error: "The check could not run. Try again in a moment." };
  }
  return { ok: true, check: data };
}
