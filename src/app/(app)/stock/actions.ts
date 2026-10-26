"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, intId, optStr, qty, str, type ActionState, guarded } from "@/lib/actions";

function bump() {
  for (const p of ["/stock", "/stock/receive", "/stock/adjust", "/inventory", "/", "/requests/new"]) revalidatePath(p);
}

async function receiveStockImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ item_id: intId, location_id: intId, quantity: qty, note: optStr(500) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Choose an item, a location and a quantity above 0." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_stock", {
    p_item_id: p.data.item_id, p_location_id: p.data.location_id, p_quantity: p.data.quantity, p_note: p.data.note,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: `Received ${p.data.quantity}.` };
}

async function adjustStockImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z
    .object({ item_id: intId, location_id: intId, delta: z.coerce.number().int().min(-1_000_000).max(1_000_000), note: str(500) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Choose an item and location, a non-zero change, and give a reason." };
  if (p.data.delta === 0) return { ok: false, error: "The change cannot be 0." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_stock", {
    p_item_id: p.data.item_id, p_location_id: p.data.location_id, p_delta: p.data.delta, p_note: p.data.note,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: `Adjusted by ${p.data.delta > 0 ? "+" : ""}${p.data.delta}.` };
}

async function transferStockImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const p = z
    .object({ item_id: intId, from_location: intId, to_location: intId, quantity: qty, note: optStr(500) })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { ok: false, error: "Choose an item, both locations and a quantity above 0." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_stock", {
    p_item_id: p.data.item_id, p_from_location: p.data.from_location, p_to_location: p.data.to_location,
    p_quantity: p.data.quantity, p_note: p.data.note,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: `Moved ${p.data.quantity}.` };
}

const deliverySchema = z.object({
  location_id: intId,
  reference: optStr(300),
  lines: z
    .array(
      z.union([
        z.object({ item_id: intId, quantity: qty }),
        z.object({
          new_item: z.object({
            name: z.string().trim().min(1).max(120),
            category_id: intId,
            unit: z.string().trim().min(1).max(20),
            sku: z.string().trim().max(40).transform((s) => s || null),
            reorder_level: z.coerce.number().int().min(0).max(1_000_000),
          }),
          quantity: qty,
        }),
      ]),
    )
    .min(1, "Add at least one item")
    .max(100, "At most 100 lines per delivery"),
});

async function receiveDeliveryImpl(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, error: "The form could not be read. Reload the page and try again." };
  }
  const p = deliverySchema.safeParse(payload);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the delivery lines." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_delivery", {
    p_location_id: p.data.location_id,
    p_reference: p.data.reference,
    p_lines: p.data.lines,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  revalidatePath("/catalog");
  const units = p.data.lines.reduce((n, l) => n + l.quantity, 0);
  return { ok: true, message: `Received ${p.data.lines.length} ${p.data.lines.length === 1 ? "line" : "lines"}, ${units} units.` };
}

export const receiveDelivery = guarded("receiveDelivery", receiveDeliveryImpl);
export const receiveStock = guarded("receiveStock", receiveStockImpl);
export const adjustStock = guarded("adjustStock", adjustStockImpl);
export const transferStock = guarded("transferStock", transferStockImpl);
