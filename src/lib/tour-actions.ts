"use server";

import { createClient } from "@/lib/supabase/server";
import { TOUR_VERSION } from "@/lib/guide";

/** Remembers that the caller finished or dismissed the current tour (on every device). */
export async function markTourSeen(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_tour_version", { p_version: TOUR_VERSION });
    if (error) console.error("[markTourSeen]", error.message);
  } catch (e) {
    console.error("[markTourSeen]", e instanceof Error ? e.message : e);
  }
}
