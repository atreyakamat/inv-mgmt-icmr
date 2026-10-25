import type { Metadata } from "next";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NameForm, PasswordForm } from "./forms";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const me = await requireMember();
  const supabase = await createClient();
  const { data: perms } = await supabase.from("permissions").select("key, description").in("key", me.permissions);

  return (
    <>
      <PageHeader title="Your account" lead={me.email} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-10">
          <NameForm name={me.full_name} />
          <PasswordForm />
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">What you can do</h2>
          <p className="mb-3 text-sm text-ink-2">Your role is <strong className="text-ink">{me.role.name}</strong>. Two-factor is on; your admin can reset it if you lose your phone.</p>
          <ul className="divide-y divide-rule-soft border-y border-rule text-sm">
            {(perms ?? []).map((p) => <li key={p.key} className="py-2">{p.description}</li>)}
            {me.permissions.length === 0 && <li className="py-2 text-ink-3">View only.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
