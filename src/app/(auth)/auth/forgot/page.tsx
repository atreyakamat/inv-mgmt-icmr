import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-ink-2">We will email you a link that works once, for an hour.</p>
      <div className="mt-8">
        <ForgotForm />
      </div>
    </>
  );
}
