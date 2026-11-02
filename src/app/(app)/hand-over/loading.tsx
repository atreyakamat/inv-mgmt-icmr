import { SkeletonHeader, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader />
      <SkeletonTable rows={6} cols={4} />
    </>
  );
}
