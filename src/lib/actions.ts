import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";

/** Result shape every server action returns to useActionState. */
export type ActionState = { ok: true; message?: string; id?: number } | { ok: false; error: string } | null;

export const idle: ActionState = null;

/** Turns a Postgres / Supabase error into something a person can act on. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; hint?: string; code?: string };
  if (!e?.message) return "Something went wrong. Try again.";
  if (e.code === "23505") return "That name or code is already in use.";
  if (e.code === "42501" || e.message.includes("row-level security")) {
    return e.message.startsWith("new row") || e.message.includes("policy")
      ? "You do not have permission to do this."
      : e.message;
  }
  if (e.code === "PGRST202") return "That action is not available yet (database function missing).";
  // Messages raised by our own workflow functions are already plain English.
  return e.message.replace(/^(ERROR:\s*)/, "");
}

export function parse<T extends z.ZodTypeAny>(schema: T, formData: FormData): z.infer<T> {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("$")) continue;
    raw[k] = v;
  }
  return schema.parse(raw);
}

export const str = (max = 1000) => z.string().trim().min(1, "Required").max(max);
export const optStr = (max = 1000) => z.string().trim().max(max).transform((s) => s || null);
export const intId = z.coerce.number().int().positive();
export const qty = z.coerce.number().int().min(1).max(1_000_000);

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Wraps a server action so nothing escapes as an unhandled exception: Next's
 * own control flow (redirect, notFound) is re-thrown, bad input becomes a
 * plain message, and anything unexpected is logged and reported without
 * leaking internals.
 */
export function guarded(name: string, fn: Action): Action {
  return async (prev, formData) => {
    try {
      return await fn(prev, formData);
    } catch (err) {
      unstable_rethrow(err);
      if (err instanceof ZodError) {
        return { ok: false, error: "Some details are missing or not valid. Check the form and try again." };
      }
      console.error(`[action:${name}]`, err);
      return { ok: false, error: "Something went wrong on our side. Try again; if it keeps happening, tell your admin." };
    }
  };
}
