"use client";

import { startTour } from "@/components/tour-events";

export function ReplayTourButton() {
  return (
    <button
      type="button"
      onClick={startTour}
      className="inline-flex items-center rounded-sm border border-ink bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:bg-ink-2"
    >
      Replay the tour
    </button>
  );
}
