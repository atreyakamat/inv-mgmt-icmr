import type { Metadata } from "next";
import { QueuePage } from "@/components/queue";

export const metadata: Metadata = { title: "Hand over" };

export default function HandOverPage() {
  return (
    <QueuePage
      permission="requests.fulfill"
      statuses={["approved"]}
      title="Hand over"
      lead="Approved requests. Mark each one handed over once the items leave the store; stock updates then."
      emptyTitle="Nothing approved to hand over"
    />
  );
}
