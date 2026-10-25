import type { Metadata } from "next";
import { QueuePage } from "@/components/queue";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <QueuePage
      permission="requests.review"
      statuses={["submitted"]}
      title="Review"
      lead="New requests. Recommend them or not; the approver decides."
      emptyTitle="Nothing to review"
    />
  );
}
