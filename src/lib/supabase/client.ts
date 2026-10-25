"use client";

import { createBrowserClient } from "@supabase/ssr";
import { DB_SCHEMA } from "@/lib/env";
import type { Database } from "@/lib/database.types";

let client: ReturnType<typeof createBrowserClient<Database, typeof DB_SCHEMA>> | undefined;

/** Browser client. Used only for auth flows (sign-in, MFA); data goes through server actions. */
export function createClient() {
  client ??= createBrowserClient<Database, typeof DB_SCHEMA>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { db: { schema: DB_SCHEMA } },
  );
  return client;
}
