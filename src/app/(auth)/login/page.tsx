import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { DemoAccounts } from "./demo-accounts";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" && sp.next.startsWith("/") ? sp.next : "/";
  return (
    <>
      <h1 className="text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-ink-2">Accounts are created by your admin. There is no sign-up.</p>
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
      {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && <DemoAccounts />}
    </>
  );
}
