import { NextResponse } from "next/server";
import { supabaseServerUrl } from "@/lib/supabase/config";

/**
 * Liveness + dependency check for Docker / uptime monitors.
 * 200 when the app can reach Supabase Auth and the Data API, 503 otherwise.
 * Reveals nothing beyond up/down.
 */
export async function GET() {
  const base = supabaseServerUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const probe = async (path: string) => {
    try {
      const res = await fetch(base + path, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(3000) });
      return res.status < 500;
    } catch {
      return false;
    }
  };
  const [auth, api] = await Promise.all([probe("/auth/v1/health"), probe("/rest/v1/")]);
  const ok = auth && api;
  return NextResponse.json({ ok, auth, api }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
