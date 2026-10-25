"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, str, type ActionState } from "@/lib/actions";

export async function updateName(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = str(120).safeParse(formData.get("full_name"));
  if (!parsed.success) return { ok: false, error: "Enter your name." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_name", { p_full_name: parsed.data });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}
