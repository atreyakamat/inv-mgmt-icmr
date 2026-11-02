import { SkeletonBlock, SkeletonHeader } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <div className="grid gap-10 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-64 w-full" />
        ))}
      </div>
    </>
  );
}
