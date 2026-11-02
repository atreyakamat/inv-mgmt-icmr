import { SkeletonHeader, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader actions={2} />
      <div className="mb-5 flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} aria-hidden className="h-7 w-20 animate-pulse rounded-sm bg-sheet-tint" />
        ))}
      </div>
      <SkeletonTable rows={10} cols={5} />
    </>
  );
}
