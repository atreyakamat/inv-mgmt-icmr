"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui";

/** Any unexpected failure inside the app shell lands here instead of a blank page. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-xl border-t-2 border-ink pt-6">
      <h1 className="text-3xl font-semibold">This page could not load</h1>
      <p className="mt-3 text-ink-2">
        Nothing you did was lost: every change is saved the moment you confirm it. Try again, or go back to the overview.
      </p>
      {error.digest && <p className="mt-3 text-xs text-ink-3">Reference for support: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/">Back to overview</LinkButton>
      </div>
    </div>
  );
}
