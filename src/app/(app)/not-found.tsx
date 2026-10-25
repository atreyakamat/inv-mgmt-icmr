import { LinkButton } from "@/components/ui";

export default function AppNotFound() {
  return (
    <div className="max-w-xl border-t-2 border-ink pt-6">
      <h1 className="text-3xl font-semibold">Not found</h1>
      <p className="mt-3 text-ink-2">
        That page or request does not exist, or your role cannot see it.
      </p>
      <div className="mt-6 flex gap-2">
        <LinkButton href="/requests" variant="primary">Go to requests</LinkButton>
        <LinkButton href="/">Back to overview</LinkButton>
      </div>
    </div>
  );
}
