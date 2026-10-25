function required(name: string, value = process.env[name]): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    // Literal references so Next.js inlines the values at build time.
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  },
  /** Server-only. Throws if read on the client. */
  get serviceRoleKey() {
    if (typeof window !== "undefined") {
      throw new Error("Service role key must never be read in the browser");
    }
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
};

/** Database schema everything in this app lives in. */
export const DB_SCHEMA = "inventory" as const;
