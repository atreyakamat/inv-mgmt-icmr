import { SkeletonListPage } from "@/components/skeleton";

export default function Loading() {
  return <SkeletonListPage filters={2} cols={4} rows={10} />;
}
