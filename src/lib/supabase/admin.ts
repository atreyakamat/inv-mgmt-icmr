import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";
import { supabaseServerUrl } from "./config";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. Bypasses RLS, so it is used in exactly one module
 * (accounts) and every call there is audit-logged.
 */
export function createAdminClient() {
  return createClient<Database, typeof DB_SCHEMA>(supabaseServerUrl(), env.serviceRoleKey, {
    db: { schema: DB_SCHEMA },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
