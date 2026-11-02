import { SkeletonBlock, SkeletonHeader } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <SkeletonBlock className="h-10 w-full max-w-xl" />
      <SkeletonBlock className="mt-4 h-24 w-full" />
      <SkeletonBlock className="mt-4 h-24 w-full" />
    </>
  );
}
