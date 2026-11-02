import { SkeletonHeader, SkeletonTable } from "@/components/skeleton";

export default function Loading() {
  return (
    <>
      <SkeletonHeader actions={1} />
      <SkeletonTable rows={10} cols={5} />
    </>
  );
}
