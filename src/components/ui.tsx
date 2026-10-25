import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { RequestStatus } from "@/lib/database.types";

/* ------------------------------------------------------------- helpers */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/* ------------------------------------------------------------- buttons */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "stamp";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-2 border-ink",
  secondary: "bg-sheet text-ink border-rule hover:border-ink-3",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-sheet-tint",
  danger: "bg-sheet text-bad border-bad/40 hover:bg-bad-soft",
  stamp: "bg-stamp text-white border-stamp hover:brightness-110",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center gap-2 rounded-sm border px-3.5 py-2 text-sm font-medium transition",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        buttonStyles[variant],
        className,
      )}
    />
  );
}

export function LinkButton({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return (
    <Link
      {...props}
      className={cx(
        "inline-flex items-center gap-2 rounded-sm border px-3.5 py-2 text-sm font-medium transition",
        buttonStyles[variant],
        className,
      )}
    />
  );
}

/* --------------------------------------------------------------- fields */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx("field", props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx("field min-h-24", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx("field", props.className)} />;
}

/* -------------------------------------------------------------- notices */
export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "ok" | "warn" | "bad";
  children: ReactNode;
}) {
  const tones = {
    info: "bg-sheet-tint text-ink-2 border-rule",
    ok: "bg-ok-soft text-ok border-ok/30",
    warn: "bg-warn-soft text-warn border-warn/30",
    bad: "bg-bad-soft text-bad border-bad/30",
  };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-sm border px-3 py-2 text-sm", tones[tone])}>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- stamps */
export const statusMeta: Record<RequestStatus, { label: string; tone: string; soft: string }> = {
  submitted: { label: "Submitted", tone: "text-ink-2", soft: "bg-sheet-tint" },
  recommended: { label: "Recommended", tone: "text-stamp", soft: "bg-stamp-soft" },
  not_recommended: { label: "Not recommended", tone: "text-warn", soft: "bg-warn-soft" },
  approved: { label: "Approved", tone: "text-stamp", soft: "bg-stamp-soft" },
  fulfilled: { label: "Handed over", tone: "text-ok", soft: "bg-ok-soft" },
  rejected: { label: "Rejected", tone: "text-bad", soft: "bg-bad-soft" },
  cancelled: { label: "Cancelled", tone: "text-ink-3", soft: "bg-sheet-tint" },
};

export function Stamp({
  status,
  size = "sm",
  animate = false,
}: {
  status: RequestStatus;
  size?: "sm" | "lg";
  animate?: boolean;
}) {
  const m = statusMeta[status];
  return (
    <span className={cx("stamp", size === "lg" && "stamp-lg", animate && "stamp-animate", m.tone)}>
      {m.label}
    </span>
  );
}

/** Quiet pill for lists where a stamp would be too loud. */
export function StatusPill({ status }: { status: RequestStatus }) {
  const m = statusMeta[status];
  return (
    <span className={cx("inline-block rounded-sm px-2 py-0.5 text-xs font-medium", m.tone, m.soft)}>
      {m.label}
    </span>
  );
}

export function StockLevelMark({ qty, reorder }: { qty: number; reorder: number }) {
  const tone = qty === 0 ? "text-bad" : reorder > 0 && qty <= reorder ? "text-warn" : "text-ok";
  const label = qty === 0 ? "Out" : reorder > 0 && qty <= reorder ? "Low" : "In stock";
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", tone)}>
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- layout */
export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-5">
      <div>
        <h1 className="text-3xl font-semibold md:text-4xl">{title}</h1>
        {lead && <p className="mt-2 max-w-prose text-ink-2">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mb-10">
      {(title || aside) && (
        <div className="mb-3 flex items-baseline justify-between gap-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-rule px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-3">{children}</div>}
    </div>
  );
}

/** Big figure for the dashboard. One per row; not a KPI card grid. */
export function Figure({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-rule-soft py-3">
      <span className={cx("num display text-5xl font-semibold md:text-6xl", tone)}>{value}</span>
      <span className="text-ink-2">{label}</span>
    </div>
  );
}
