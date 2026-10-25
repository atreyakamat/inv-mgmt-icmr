"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, intId, optStr, str, type ActionState } from "@/lib/actions";

function bump(id?: number) {
  revalidatePath("/");
  revalidatePath("/requests");
  revalidatePath("/review");
  revalidatePath("/approve");
  revalidatePath("/hand-over");
  revalidatePath("/inventory");
  if (id) revalidatePath(`/requests/${id}`);
}

const lineSchema = z.object({ item_id: intId, quantity: z.coerce.number().int().min(1).max(100_000) });

export async function submitRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const lines: z.infer<typeof lineSchema>[] = [];
  for (const [k, v] of formData.entries()) {
    const m = /^qty\[(\d+)\]$/.exec(k);
    if (m && Number(v) > 0) lines.push(lineSchema.parse({ item_id: m[1], quantity: v }));
  }
  const parsed = z
    .object({ location_id: intId, purpose: str(1000), needed_by: optStr(10) })
    .safeParse({
      location_id: formData.get("location_id"),
      purpose: formData.get("purpose"),
      needed_by: formData.get("needed_by") ?? "",
    });
  if (!parsed.success) return { ok: false, error: "Fill in the location and what the items are for." };
  if (lines.length === 0) return { ok: false, error: "Add a quantity for at least one item." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_request", {
    p_location_id: parsed.data.location_id,
    p_purpose: parsed.data.purpose,
    p_lines: lines,
    p_needed_by: parsed.data.needed_by,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  redirect(`/requests/${data}?submitted=1`);
}

export async function cancelRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_request", { p_id: id, p_note: optStr().parse(formData.get("note") ?? "") });
  if (error) return { ok: false, error: friendlyError(error) };
  bump(id);
  return { ok: true, message: "Request cancelled." };
}

export async function reviewRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("id"));
  const recommend = formData.get("decision") === "recommend";
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_request", {
    p_id: id,
    p_recommend: recommend,
    p_note: optStr().parse(formData.get("note") ?? ""),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump(id);
  return { ok: true, message: recommend ? "Recommended." : "Marked not recommended." };
}

export async function approveRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("id"));
  const lines: { line_id: number; approved_qty: number }[] = [];
  for (const [k, v] of formData.entries()) {
    const m = /^approved\[(\d+)\]$/.exec(k);
    if (m) lines.push({ line_id: Number(m[1]), approved_qty: Math.max(0, Math.floor(Number(v) || 0)) });
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_request", {
    p_id: id,
    p_lines: lines.length ? lines : null,
    p_note: optStr().parse(formData.get("note") ?? ""),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump(id);
  return { ok: true, message: "Approved and sent to the store." };
}

export async function rejectRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { ok: false, error: "Add a note explaining the rejection." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_request", { p_id: id, p_note: note });
  if (error) return { ok: false, error: friendlyError(error) };
  bump(id);
  return { ok: true, message: "Rejected." };
}

export async function fulfillRequest(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = intId.parse(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("fulfill_request", { p_id: id, p_note: optStr().parse(formData.get("note") ?? "") });
  if (error) return { ok: false, error: friendlyError(error) };
  bump(id);
  return { ok: true, message: "Handed over. Stock updated." };
}
