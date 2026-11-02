import { SkeletonOverview } from "@/components/skeleton";

/** Fallback for Overview ("/"), the most common landing page, and anything
 * else under (app) without its own loading.tsx. */
export default function Loading() {
  return <SkeletonOverview />;
}
