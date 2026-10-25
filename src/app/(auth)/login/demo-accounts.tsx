"use client";

/**
 * Shown only in the offline Docker build (NEXT_PUBLIC_DEMO_MODE=true).
 * Lists the seeded accounts and the shared demo authenticator key.
 */
const accounts = [
  { email: "admin@inventory.local", role: "Admin", note: "accounts, roles, audit" },
  { email: "super@inventory.local", role: "Super User", note: "approves requests" },
  { email: "validator@inventory.local", role: "Validator", note: "reviews requests" },
  { email: "store@inventory.local", role: "Store Manager", note: "stock and hand-over" },
  { email: "anil@inventory.local", role: "User", note: "raises requests" },
];

export const DEMO_PASSWORD = "Inventory-Demo-2026";
const DEMO_KEY = "STOREREGISTERDEMOAUTHENTICATOR22";

export function DemoAccounts() {
  function fill(email: string) {
    const form = document.querySelector<HTMLFormElement>("form");
    const e = form?.querySelector<HTMLInputElement>("input[name=email]");
    const p = form?.querySelector<HTMLInputElement>("input[name=password]");
    if (e && p) {
      e.value = email;
      p.value = DEMO_PASSWORD;
      p.focus();
    }
  }

  return (
    <aside className="mt-10 border-t border-dashed border-rule pt-6 text-sm">
      <h2 className="font-semibold">Demo accounts</h2>
      <p className="mt-1 text-ink-3">Local test data. Click one to fill the form, then Continue.</p>
      <ul className="mt-3 divide-y divide-rule-soft border-y border-rule-soft">
        {accounts.map((a) => (
          <li key={a.email}>
            <button type="button" onClick={() => fill(a.email)} className="flex w-full items-baseline justify-between gap-3 px-1 py-2 text-left hover:bg-sheet-tint">
              <span className="font-medium">{a.role}</span>
              <span className="truncate text-xs text-ink-3">{a.note}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo-authenticator.png" alt="QR code for the demo authenticator" width={96} height={96} className="rounded-sm border border-rule bg-white" />
        <p className="text-ink-2">
          Every demo account uses one authenticator entry. Scan this once in Google Authenticator, or type the key:
          <code className="mt-1.5 block select-all rounded-sm bg-sheet-tint px-2 py-1 font-mono text-xs text-ink">{DEMO_KEY}</code>
        </p>
      </div>
    </aside>
  );
}
