import type { Metadata } from "next";
import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { allowed, guideSections } from "@/lib/guide";
import { PageHeader } from "@/components/ui";
import { ReplayTourButton } from "./replay-button";

export const metadata: Metadata = { title: "Guide" };

export default async function GuidePage() {
  const me = await requireMember();
  const sections = guideSections.filter((s) => allowed(s, me.permissions));

  return (
    <>
      <PageHeader
        title="Guide"
        lead={<>How to do everything you can do here as <strong className="text-ink">{me.role.name}</strong>. Pick a topic, or replay the short tour of the menu.</>}
        actions={<ReplayTourButton />}
      />

      <div className="grid gap-10 xl:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Topics" className="xl:sticky xl:top-8 xl:self-start">
          <ol className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm xl:block xl:space-y-1.5">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-ink-2 hover:text-ink hover:underline">
                  <span className="num mr-2 text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 max-w-3xl space-y-12">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-ink pt-5">
              <div className="num text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</div>
              <h2 className="mt-1 text-2xl font-semibold">{s.title}</h2>
              <p className="mt-2 text-ink-2">{s.intro}</p>

              {s.steps && (
                <ol className="mt-5 space-y-3">
                  {s.steps.map((step, n) => (
                    <li key={n} className="flex gap-3">
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-ink text-xs font-semibold">{n + 1}</span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              )}

              {s.notes && (
                <ul className="mt-5 space-y-2 border-l-2 border-stamp/50 pl-4 text-sm text-ink-2">
                  {s.notes.map((n, k) => <li key={k}>{n}</li>)}
                </ul>
              )}

              {s.link && (
                <Link href={s.link.href} className="mt-5 inline-block text-sm font-medium text-stamp underline-offset-2 hover:underline">
                  {s.link.label} →
                </Link>
              )}
            </section>
          ))}

          {!can(me, "users.manage") && (
            <p className="border-t border-rule pt-5 text-sm text-ink-3">
              Something not covered here, or something not working? Ask the Super User.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
