"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const eventSchema = z.enum(["sign_in", "sign_out", "code_failed", "password_set"]);

/** "Chrome on Windows", "Safari on iPhone"… Enough to recognise a device, nothing more. */
function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  const os =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Writes a sign-in, sign-out, failed code or password change to the sealed
 * audit log for the signed-in caller. The database decides what counts (for
 * example, a sign-in only once the authenticator code is accepted). Never
 * throws: recording must not get in the way of signing in.
 */
export async function recordAuthEvent(event: z.infer<typeof eventSchema>): Promise<void> {
  try {
    const parsed = eventSchema.safeParse(event);
    if (!parsed.success) return;
    const h = await headers();
    const ip =
      h.get("x-nf-client-connection-ip") ??
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const supabase = await createClient();
    await supabase.rpc("record_auth_event", {
      p_event: parsed.data,
      p_device: describeDevice(h.get("user-agent")),
      p_ip: ip,
    });
  } catch (e) {
    console.error("[recordAuthEvent]", e instanceof Error ? e.message : e);
  }
}
