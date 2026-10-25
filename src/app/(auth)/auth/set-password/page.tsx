import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) redirect("/login?error=link");
  return (
    <>
      <h1 className="text-3xl font-semibold">Choose a password</h1>
      <p className="mt-2 text-ink-2">
        For <strong className="text-ink">{String(data.claims.email ?? "")}</strong>. Use at least 12 characters;
        a short sentence works well.
      </p>
      <div className="mt-8">
        <SetPasswordForm />
      </div>
    </>
  );
}
