import type { ReactNode } from "react";
import { requireMember } from "@/lib/auth";
import { Rail } from "@/components/rail";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMember();
  return (
    <div className="min-h-screen md:flex">
      <Rail me={me} />
      <main className="min-w-0 flex-1 px-5 py-8 md:px-10 md:py-10 lg:px-14">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
