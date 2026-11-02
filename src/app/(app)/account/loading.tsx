import { SkeletonBlock, SkeletonHeader } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <div className="grid gap-10 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <SkeletonBlock className="h-5 w-24" />
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-10 w-32" />
          </div>
        ))}
      </div>
    </>
  );
}
