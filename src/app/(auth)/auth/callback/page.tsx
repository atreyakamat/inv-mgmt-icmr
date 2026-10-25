import type { Metadata } from "next";
import { Suspense } from "react";
import { CallbackHandler } from "./callback-handler";

export const metadata: Metadata = { title: "Signing you in" };

export default function CallbackPage() {
  return (
    <Suspense fallback={<p className="text-ink-2">Checking your link…</p>}>
      <CallbackHandler />
    </Suspense>
  );
}
