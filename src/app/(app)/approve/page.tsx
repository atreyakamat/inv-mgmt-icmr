import type { Metadata } from "next";
import { QueuePage } from "@/components/queue";

export const metadata: Metadata = { title: "Approve" };

export default function ApprovePage() {
  return (
    <QueuePage
      permission="requests.approve"
      statuses={["recommended", "not_recommended"]}
      title="Approve"
      lead="Reviewed requests waiting for your decision. You can change quantities before approving."
      emptyTitle="Nothing waiting for approval"
    />
  );
}
