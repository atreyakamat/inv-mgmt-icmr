import { cx } from "./ui";

/** One pulsing block. Base unit for every loading state below. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-sm bg-sheet-tint", className)} />;
}

/** Matches PageHeader: a title-sized bar, a line of lead text, optional action buttons. */
export function SkeletonHeader({ actions = 0 }: { actions?: number }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-5">
      <div>
        <SkeletonBlock className="h-9 w-56" />
        <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
      </div>
      {actions > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <SkeletonBlock key={i} className="h-9 w-32" />
          ))}
        </div>
      )}
    </header>
  );
}

/** Matches the .register table: a header rule, then rows of hairline-separated cells. */
export function SkeletonTable({ rows = 8, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <table className="register text-sm" aria-hidden>
      <thead>
        <tr>
          {Array.from({ length: cols }).map((_, c) => (
            <th key={c}><SkeletonBlock className="h-3 w-16" /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}><SkeletonBlock className={cx("h-4", c === 0 ? "w-36" : "w-20")} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A page that is one table with a search/filter bar above it. */
export function SkeletonListPage({ actions = 0, filters = 2, rows = 8, cols = 4 }: { actions?: number; filters?: number; rows?: number; cols?: number }) {
  return (
    <>
      <SkeletonHeader actions={actions} />
      {filters > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          {Array.from({ length: filters }).map((_, i) => (
            <SkeletonBlock key={i} className="h-9 w-48" />
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <SkeletonTable rows={rows} cols={cols} />
      </div>
    </>
  );
}

/** Figure + Section layout, as on Overview. */
export function SkeletonOverview() {
  return (
    <>
      <SkeletonHeader actions={1} />
      <div className="grid gap-x-12 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <SkeletonBlock className="h-9 w-14" />
              <SkeletonBlock className="mt-2 h-4 w-40" />
            </div>
          ))}
        </div>
        <div className="space-y-10">
          <div>
            <SkeletonBlock className="mb-3 h-5 w-28" />
            <SkeletonTable rows={4} cols={4} />
          </div>
          <div>
            <SkeletonBlock className="mb-3 h-5 w-36" />
            <SkeletonTable rows={5} cols={5} />
          </div>
        </div>
      </div>
    </>
  );
}

/** A two-column page: a table or list on the left, a form on the right. */
export function SkeletonWithSidebar({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      <SkeletonHeader />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 overflow-x-auto">
          <SkeletonTable rows={rows} cols={cols} />
        </div>
        <div className="space-y-4">
          <SkeletonBlock className="h-5 w-32" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-10 w-28" />
        </div>
      </div>
    </>
  );
}
