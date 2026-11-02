import type { ReactNode } from "react";
import { requireMember } from "@/lib/auth";
import { TOUR_VERSION, allowed, tourSteps } from "@/lib/guide";
import { Rail } from "@/components/rail";
import { Tour } from "@/components/tour";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMember();
  const steps = tourSteps.filter((s) => allowed(s, me.permissions));
  return (
    <div className="min-h-screen md:flex">
      <Rail me={me} />
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10 lg:px-14">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
      <Tour steps={steps} autoStart={typeof me.tour_version === "number" && me.tour_version < TOUR_VERSION} roleName={me.role.name} />
    </div>
  );
}
