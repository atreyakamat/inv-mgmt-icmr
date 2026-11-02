import { SkeletonHeader, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader actions={1} />
      <div className="mb-5 flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} aria-hidden className="h-7 w-24 animate-pulse rounded-sm bg-sheet-tint" />
        ))}
      </div>
      <SkeletonTable rows={8} cols={5} />
    </>
  );
}
