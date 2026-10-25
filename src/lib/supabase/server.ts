import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DB_SCHEMA, env } from "@/lib/env";
import { authCookieName, supabaseServerUrl } from "./config";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client bound to the current request's cookies, running as the
 * signed-in user. Every query goes through RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database, typeof DB_SCHEMA>(
    supabaseServerUrl(),
    env.supabasePublishableKey,
    {
      db: { schema: DB_SCHEMA },
      cookieOptions: { name: authCookieName },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: the proxy refreshes sessions, so
            // this can be ignored safely.
          }
        },
      },
    },
  );
}
