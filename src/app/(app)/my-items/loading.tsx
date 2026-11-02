import { SkeletonBlock, SkeletonHeader } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader actions={1} />
      <SkeletonBlock className="mb-10 h-10 w-96 max-w-full" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-24 w-full" />
        ))}
      </div>
    </>
  );
}
