/**
 * Where the browser and the server reach Supabase, and what the session cookie
 * is called. Safe to import from client and server code.
 *
 * NEXT_PUBLIC_SUPABASE_URL   address the browser uses
 * SUPABASE_INTERNAL_URL      optional, address the Next.js server uses when it
 *                            differs (e.g. a Docker service name offline)
 *
 * The cookie name is always derived from the public URL so browser and server
 * agree even when they talk to Supabase through different addresses. It matches
 * Supabase's default (`sb-<first label of host>-auth-token`).
 */
export const supabasePublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export function supabaseServerUrl() {
  return process.env.SUPABASE_INTERNAL_URL || supabasePublicUrl;
}

export const authCookieName = `sb-${new URL(supabasePublicUrl).hostname.split(".")[0]}-auth-token`;
