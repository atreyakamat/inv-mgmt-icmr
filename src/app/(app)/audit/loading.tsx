import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader actions={1} />
      <SkeletonBlock className="mb-6 h-16 w-full" />
      <div className="mb-4 flex gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} aria-hidden className="h-7 w-20 animate-pulse rounded-sm bg-sheet-tint" />
        ))}
      </div>
      <SkeletonTable rows={10} cols={4} />
    </>
  );
}
