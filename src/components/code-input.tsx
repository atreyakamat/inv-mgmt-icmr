"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Six-digit code entry. One real input (for autofill / paste / screen readers)
 * rendered as six boxes. Re-mount with a new `key` to clear it after a failed attempt.
 */
export function CodeInput({
  onComplete,
  disabled,
  autoFocus = true,
}: {
  onComplete: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value.length === 6) onComplete(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
        aria-label="6-digit code"
        className="absolute inset-0 z-10 w-full cursor-text opacity-0"
      />
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={[
              "num flex h-14 items-center justify-center rounded-sm border bg-sheet text-2xl font-semibold",
              i === value.length && !disabled ? "border-stamp shadow-[0_0_0_3px_var(--stamp-soft)]" : "border-rule",
            ].join(" ")}
          >
            {value[i] ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
