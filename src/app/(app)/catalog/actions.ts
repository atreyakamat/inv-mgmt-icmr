"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, intId, optStr, str, type ActionState } from "@/lib/actions";

type Kind = "categories" | "locations" | "items";

function bump() {
  for (const p of ["/catalog", "/inventory", "/stock", "/requests/new", "/"]) revalidatePath(p);
}

const simple = z.object({ name: str(80), description: optStr(500) });
const itemSchema = z.object({
  name: str(120),
  sku: optStr(40),
  description: optStr(500),
  category_id: intId,
  unit: str(20),
  reorder_level: z.coerce.number().int().min(0).max(1_000_000),
});

export async function saveEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kind = formData.get("kind") as Kind;
  const id = formData.get("id") ? intId.parse(formData.get("id")) : null;
  if (!["categories", "locations", "items"].includes(kind)) return { ok: false, error: "Unknown entry type." };

  const raw = Object.fromEntries(formData.entries());
  const parsed = kind === "items" ? itemSchema.safeParse(raw) : simple.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the fields." };

  const supabase = await createClient();
  const table = supabase.from(kind);
  const { error } = id
    ? await table.update(parsed.data).eq("id", id)
    : await table.insert(parsed.data);
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: id ? "Saved." : "Added." };
}

export async function setActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kind = formData.get("kind") as Kind;
  const id = intId.parse(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!["categories", "locations", "items"].includes(kind)) return { ok: false, error: "Unknown entry type." };
  const supabase = await createClient();
  const { error } = await supabase.from(kind).update({ active }).eq("id", id);
  if (error) return { ok: false, error: friendlyError(error) };
  bump();
  return { ok: true, message: active ? "Reactivated." : "Retired. History is kept." };
}
