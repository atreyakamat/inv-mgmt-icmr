import type { ReactNode } from "react";

/* Two-pane sign-in: the register itself on the left, the form on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="grid-paper relative hidden overflow-hidden border-r border-rule lg:block">
        <div className="absolute inset-x-10 top-10 flex items-center gap-3 text-ink-2">
          <span aria-hidden className="inline-block size-3 rotate-[-8deg] rounded-[2px] bg-stamp" />
          Store register
        </div>
        <div className="absolute inset-x-10 bottom-10">
          <p className="display max-w-[14ch] text-6xl font-semibold xl:text-7xl">
            Every item, every hand it passed through.
          </p>
          <p className="mt-6 max-w-md text-ink-2">
            Stock is a ledger here, not a number someone typed. Requests move
            through review, approval and hand-over, and each step is signed.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
