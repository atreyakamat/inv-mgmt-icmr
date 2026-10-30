"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourStep } from "@/lib/guide";
import { markTourSeen } from "@/lib/tour-actions";
import { TOUR_START, setRailOpen } from "./tour-events";
import { cx } from "./ui";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 6;
const CARD_W = 340;
const MOBILE = 768;

function measure(target?: string): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= window.innerWidth) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Step-by-step tour that points at the real menu items. Starts by itself on a
 * member's first visit (and when the tour is updated), or from the Guide page.
 */
export function Tour({ steps, autoStart, roleName }: { steps: TourStep[]; autoStart: boolean; roleName: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mobile, setMobile] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const open = index !== null;
  const step = open ? steps[index] : null;
  const last = open && index === steps.length - 1;

  const start = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setIndex(0);
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    setRect(null);
    setRailOpen(false);
    void markTourSeen();
    returnFocus.current?.focus?.();
  }, []);

  // First visit: start once the page has settled.
  useEffect(() => {
    if (!autoStart || steps.length === 0) return;
    const t = window.setTimeout(start, 500);
    return () => window.clearTimeout(t);
  }, [autoStart, steps.length, start]);

  // "Replay the tour" from the Guide page.
  useEffect(() => {
    window.addEventListener(TOUR_START, start);
    return () => window.removeEventListener(TOUR_START, start);
  }, [start]);

  // On phones the menu is a drawer: open it while the tour points at it.
  useEffect(() => {
    if (!open) return;
    if (window.innerWidth < MOBILE) setRailOpen(Boolean(step?.target));
  }, [open, step?.target]);

  // Follow the target, including while the drawer slides in or the window changes.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      setMobile(window.innerWidth < MOBILE);
      setRect(measure(step?.target));
    };
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`) : null;
    el?.scrollIntoView({ block: "nearest" });
    update();
    const timers = [120, 320].map((ms) => window.setTimeout(update, ms));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, step?.target]);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open, index]);

  const next = () => (last ? close() : setIndex((i) => (i === null ? null : i + 1)));
  const back = () => setIndex((i) => (i ? i - 1 : i));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    else if (e.key === "Tab" && cardRef.current) {
      // Keep focus inside the card.
      const f = [...cardRef.current.querySelectorAll<HTMLElement>("button")];
      if (f.length === 0) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      const to = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[to].focus();
    }
  }

  if (!open || !step || typeof document === "undefined") return null;

  // Card placement: beside the target on wide screens, at the bottom on phones,
  // centred when there is nothing to point at.
  let cardStyle: React.CSSProperties;
  if (mobile) {
    cardStyle = { left: 12, right: 12, bottom: 12 };
  } else if (rect) {
    const roomRight = window.innerWidth - (rect.left + rect.width) - 24;
    const top = Math.min(Math.max(16, rect.top - 12), window.innerHeight - 260);
    cardStyle = roomRight >= CARD_W
      ? { top, left: rect.left + rect.width + 20, width: CARD_W }
      : { top: Math.min(rect.top + rect.height + 16, window.innerHeight - 260), left: Math.max(16, rect.left), width: CARD_W };
  } else {
    cardStyle = { top: "50%", left: "50%", width: CARD_W + 40, transform: "translate(-50%, -50%)" };
  }

  const body = step.body.replace("{role}", roleName);

  return createPortal(
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* Dim everything; the spotlight is a hole made by a huge shadow. */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-md ring-2 ring-stamp transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgb(22 35 58 / 0.55)",
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-ink/55" />
      )}
      {/* Clicks outside the card do nothing (the tour is one short path). */}
      <div className="fixed inset-0" onClick={() => primaryRef.current?.focus()} />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour"
        className={cx(
          "fixed rounded-md border border-ink bg-paper p-5 shadow-[6px_6px_0_0_rgb(22_35_58)]",
          "transition-[top,left] duration-300 ease-out motion-reduce:transition-none",
        )}
        style={cardStyle}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-ink-3">
          <span className="font-medium uppercase tracking-wide text-stamp">Guide</span>
          <span className="num">{index + 1} of {steps.length}</span>
        </div>
        <h2 id="tour-title" className="text-lg font-semibold">{step.title}</h2>
        <p id="tour-body" className="mt-1.5 text-sm text-ink-2">{body}</p>

        <div className="mt-3 flex gap-1" aria-hidden>
          {steps.map((s, i) => (
            <span key={s.id} className={cx("h-1 flex-1 rounded-full", i <= index ? "bg-stamp" : "bg-rule")} />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={close} className="rounded-sm px-2 py-1.5 text-sm text-ink-3 hover:text-ink">
            {last ? "Close" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={back} className="rounded-sm border border-rule bg-sheet px-3 py-1.5 text-sm font-medium hover:border-ink-3">
                Back
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={next}
              className="rounded-sm border border-ink bg-ink px-3.5 py-1.5 text-sm font-medium text-paper hover:bg-ink-2"
            >
              {index === 0 ? "Start" : last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
