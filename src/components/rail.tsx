"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Me, PermissionKey } from "@/lib/database.types";
import { SignOutButton } from "./sign-out-button";
import { RAIL_OPEN } from "./tour-events";
import { cx } from "./ui";

type NavItem = { href: string; label: string; needs?: PermissionKey[] };

const groups: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Overview" },
      { href: "/inventory", label: "Inventory" },
      { href: "/requests", label: "Requests" },
      { href: "/my-items", label: "My items", needs: ["requests.submit"] },
    ],
  },
  {
    title: "Work queue",
    items: [
      { href: "/review", label: "Review", needs: ["requests.review"] },
      { href: "/approve", label: "Approve", needs: ["requests.approve"] },
      { href: "/hand-over", label: "Hand over", needs: ["requests.fulfill"] },
    ],
  },
  {
    title: "Store",
    items: [
      { href: "/stock/receive", label: "Receive stock", needs: ["stock.write"] },
      { href: "/stock/adjust", label: "Correct or move", needs: ["stock.write"] },
      { href: "/stock", label: "Stock movements", needs: ["stock.write", "stock.read_history"] },
      { href: "/catalog", label: "Catalog", needs: ["catalog.write"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/people", label: "People", needs: ["users.manage"] },
      { href: "/roles", label: "Roles", needs: ["roles.manage"] },
      { href: "/audit", label: "Audit log", needs: ["audit.read"] },
    ],
  },
];

export function Rail({ me }: { me: Me }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // The tour opens the drawer on phones while it points at menu items.
  useEffect(() => {
    const onRail = (e: Event) => setOpen(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(RAIL_OPEN, onRail);
    return () => window.removeEventListener(RAIL_OPEN, onRail);
  }, []);

  const visible = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => !i.needs || i.needs.some((k) => me.permissions.includes(k))),
    }))
    .filter((g) => g.items.length > 0);

  // The most specific matching link is the active one (/stock/receive beats /stock).
  const activeHref = visible
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((h) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-6">
      {visible.map((g, gi) => (
        <div key={gi}>
          {g.title && <div className="compact mb-1.5 px-3 text-xs text-ink-3">{g.title}</div>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    data-tour={`nav:${item.href}`}
                    className={cx(
                      "flex items-center gap-2 rounded-sm px-3 py-1.5 text-[15px] transition",
                      active ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint hover:text-ink",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx("inline-block h-4 w-0.5 rounded-full", active ? "bg-stamp" : "bg-transparent")}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const account = (
    <div className="border-t border-rule pt-4">
      <Link
        href="/guide"
        onClick={() => setOpen(false)}
        data-tour="nav:/guide"
        aria-current={pathname === "/guide" ? "page" : undefined}
        className={cx(
          "mb-2 flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
          pathname === "/guide" ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint hover:text-ink",
        )}
      >
        <span aria-hidden className="grid size-4 place-items-center rounded-full border border-current text-[10px] font-semibold leading-none">?</span>
        Guide
      </Link>
      <Link href="/account" className="block rounded-sm px-3 py-1.5 hover:bg-sheet-tint">
        <div className="truncate text-sm font-medium">{me.full_name}</div>
        <div className="truncate text-xs text-ink-3">{me.role.name}</div>
      </Link>
      <SignOutButton className="mt-1 w-full rounded-sm px-3 py-1.5 text-left text-sm text-ink-3 hover:bg-sheet-tint hover:text-ink" />
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-paper px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="rail"
          className="rounded-sm border border-rule px-3 py-1.5 text-sm"
        >
          Menu
        </button>
      </div>
      <aside
        id="rail"
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col gap-6 border-r border-rule bg-paper p-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="hidden md:block">
          <Brand />
        </div>
        {nav}
        {account}
      </aside>
      {open && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-ink/30 md:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold">
      <span aria-hidden className="inline-block size-3 rotate-[-8deg] rounded-[2px] bg-stamp" />
      Store register
    </Link>
  );
}
