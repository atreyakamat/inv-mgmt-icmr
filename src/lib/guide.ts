import type { PermissionKey } from "@/lib/database.types";

/**
 * Everything the in-app help says, in one place: the first-sign-in tour and
 * the Guide page. Each piece names the permissions it needs (any one is
 * enough), so every member sees only what their role can do, and custom roles
 * get the right guide automatically.
 *
 * Raise TOUR_VERSION when the tour changes enough that everyone should see it
 * again.
 */
export const TOUR_VERSION = 1;

type Needs = { needs?: PermissionKey[]; hideIf?: PermissionKey[] };

export type TourStep = Needs & {
  id: string;
  /** value of a data-tour attribute; none = centred card */
  target?: string;
  title: string;
  body: string;
};

export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to the Store register",
    body: "A one-minute look at what you can do as {role}. Use the buttons or the arrow keys; you can leave at any time and replay it from Guide.",
  },
  {
    id: "overview",
    target: "nav:/",
    title: "Overview",
    body: "Your starting point: anything waiting on you, items running low, and the latest requests.",
  },
  {
    id: "inventory",
    target: "nav:/inventory",
    title: "Inventory",
    body: "Everything the store holds and where. Search by name or code, or show only items that are low or out of stock.",
  },
  {
    id: "requests-submit",
    target: "nav:/requests",
    needs: ["requests.submit"],
    title: "Requests",
    body: "Need something from the store? Raise a request: pick items and quantities, where you will collect them, and what they are for. You can follow every step here.",
  },
  {
    id: "requests-read",
    target: "nav:/requests",
    needs: ["requests.read_all"],
    hideIf: ["requests.submit"],
    title: "Requests",
    body: "Every request and the stage it is at, with its full history.",
  },
  {
    id: "my-items",
    target: "nav:/my-items",
    needs: ["requests.submit"],
    title: "My items",
    body: "Everything the store has handed to you, item by item and by category.",
  },
  {
    id: "review",
    target: "nav:/review",
    needs: ["requests.review"],
    title: "Review",
    body: "New requests wait here for you. Recommend them or not, with a note; the approver sees your view either way. You never review your own requests.",
  },
  {
    id: "approve",
    target: "nav:/approve",
    needs: ["requests.approve"],
    title: "Approve",
    body: "Reviewed requests come to you. Change quantities if needed, then approve and send to the store, or reject with a reason the requester will see.",
  },
  {
    id: "hand-over",
    target: "nav:/hand-over",
    needs: ["requests.fulfill"],
    title: "Hand over",
    body: "Approved requests to give out. Hand the items over, then press Mark handed over: the stock comes off by itself and the requester sees it.",
  },
  {
    id: "receive",
    target: "nav:/stock/receive",
    needs: ["stock.write"],
    title: "Receive stock",
    body: "When a delivery arrives, record it here: choose where it is going, then add every line. Items that are not in the catalog yet can be added on the spot.",
  },
  {
    id: "adjust",
    target: "nav:/stock/adjust",
    needs: ["stock.write"],
    title: "Correct or move",
    body: "Counted a different number, or something broke or expired? Correct it here with a reason. Moving stock between locations is here too.",
  },
  {
    id: "ledger",
    target: "nav:/stock",
    needs: ["stock.write", "stock.read_history"],
    title: "Stock movements",
    body: "The ledger: every unit that came in, went out or moved, with who did it. Lines are never edited; a correction is a new line.",
  },
  {
    id: "catalog",
    target: "nav:/catalog",
    needs: ["catalog.write"],
    title: "Catalog",
    body: "Items, categories and locations. Retire what you no longer stock; its history stays.",
  },
  {
    id: "people",
    target: "nav:/people",
    needs: ["users.manage"],
    title: "People",
    body: "Create accounts and give each person a role. They get an email to set a password and their authenticator. Reset a lost authenticator or switch an account off here.",
  },
  {
    id: "roles",
    target: "nav:/roles",
    needs: ["roles.manage"],
    title: "Roles",
    body: "What each role is allowed to do. Fixed roles are locked; you can add your own.",
  },
  {
    id: "audit",
    target: "nav:/audit",
    needs: ["audit.read"],
    title: "Audit log",
    body: "Every change and every sign-in: who, when and what changed. Check the seal to confirm nothing was edited or removed, and download it as CSV.",
  },
  {
    id: "guide",
    target: "nav:/guide",
    title: "Help is always here",
    body: "Guide explains every task above step by step, and replays this tour whenever you want.",
  },
];

export type GuideSection = Needs & {
  id: string;
  title: string;
  intro: string;
  steps?: string[];
  notes?: string[];
  link?: { href: string; label: string };
};

export const guideSections: GuideSection[] = [
  {
    id: "signing-in",
    title: "Signing in",
    intro: "Every account uses a password and a 6-digit code from an authenticator app on your phone. Nobody can sign up on their own; the Super User creates accounts.",
    steps: [
      "Open the sign-in page and enter your work email and password.",
      "Open your authenticator app (Google Authenticator, Microsoft Authenticator or Authy) and type the 6-digit code for Store register.",
      "Codes change every 30 seconds. If one is rejected, wait for the next code and try again.",
    ],
    notes: [
      "First time? The invite email takes you to set a password, then the app shows a QR code to scan with your authenticator.",
      "Forgot your password? Use “Forgot your password?” on the sign-in page.",
      "New phone or lost it? Ask the Super User to reset your authenticator; you will set it up again at your next sign-in.",
      "Your name and password can be changed under your name at the bottom of the menu.",
    ],
    link: { href: "/account", label: "Open your account" },
  },
  {
    id: "inventory",
    title: "Finding stock",
    intro: "Inventory shows what is in each location right now. The totals come from the stock ledger, so they are always up to date.",
    steps: [
      "Open Inventory from the menu.",
      "Search by item name or code, or choose a category.",
      "Use the Low and Out tabs to show only items at or below their reorder level, or with none left.",
    ],
    link: { href: "/inventory", label: "Open Inventory" },
  },
  {
    id: "requests",
    title: "Raising a request",
    needs: ["requests.submit"],
    intro: "Ask the store for anything in the inventory. Your request is reviewed, approved, then handed over by the store.",
    steps: [
      "Press New request (on Overview or Requests).",
      "Search for each item and type the quantity you need. Your list builds up on the right.",
      "Choose the location you will collect from.",
      "Write what it is for in one or two clear sentences; reviewers read this first.",
      "Add a needed-by date if it is urgent, then press Submit request.",
    ],
    notes: [
      "You can cancel a request until it is approved: open it and press Cancel request.",
      "You can have up to 10 requests open at a time.",
      "Quantities may be reduced at approval; the request page shows what was approved.",
    ],
    link: { href: "/requests/new", label: "Raise a request" },
  },
  {
    id: "stages",
    title: "What each stage means",
    needs: ["requests.submit", "requests.review", "requests.approve", "requests.fulfill", "requests.read_all"],
    intro: "Every request carries a stamp showing where it is. The history on the request page shows who did what and when.",
    notes: [
      "Submitted: waiting for a reviewer.",
      "Recommended / Not recommended: reviewed; waiting for approval. Either way it goes to the approver.",
      "Approved: the store will hand it over. Quantities may have been changed.",
      "Handed over: done. It now appears under My items.",
      "Rejected: not going ahead; the reason is on the request.",
      "Cancelled: withdrawn by the person who raised it.",
    ],
  },
  {
    id: "my-items",
    title: "My items",
    needs: ["requests.submit"],
    intro: "Everything the store has handed to you: how many units, how many different items and from which categories, with links back to each request.",
    link: { href: "/my-items", label: "Open My items" },
  },
  {
    id: "review",
    title: "Reviewing requests",
    needs: ["requests.review"],
    intro: "You give the first opinion on each new request. You cannot review your own.",
    steps: [
      "Open Review. The oldest request is at the top.",
      "Open a request and check the purpose, items, quantities and what is in stock at that location.",
      "Choose Recommend or Don’t recommend. A note is optional when you recommend and required when you don’t.",
      "Press Send to approver. The approver sees your choice and your note.",
    ],
    link: { href: "/review", label: "Open Review" },
  },
  {
    id: "approve",
    title: "Approving requests",
    needs: ["requests.approve"],
    intro: "Reviewed requests wait for your decision. You cannot approve your own.",
    steps: [
      "Open Approve and pick a request. The reviewer’s choice and note are shown.",
      "Change any quantity if needed; set one to 0 to drop that item.",
      "Press Approve and send to store, or Reject with a reason the requester will see.",
    ],
    link: { href: "/approve", label: "Open Approve" },
  },
  {
    id: "hand-over",
    title: "Handing items over",
    needs: ["requests.fulfill"],
    intro: "Approved requests are ready to give out. Stock is only taken off when you mark a request as handed over.",
    steps: [
      "Open Hand over and pick a request. It shows the approved quantities and what is in stock at that location.",
      "Give the items to the person.",
      "Press Mark handed over (add a note if useful). The stock comes off automatically.",
      "If you cannot fulfil it (for example the stock is damaged), choose Can’t fulfil, give a reason and press Reject request.",
    ],
    notes: ["If a location does not have enough, the app stops you. Move stock there first under Correct or move."],
    link: { href: "/hand-over", label: "Open Hand over" },
  },
  {
    id: "receive",
    title: "Receiving a delivery",
    needs: ["stock.write"],
    intro: "Record everything that arrives in one go.",
    steps: [
      "Open Receive stock.",
      "Choose where the delivery is going and add a reference such as the invoice or supplier.",
      "For each line, start typing the item name and pick it, then enter the quantity. Add as many lines as you need.",
      "If an item is not in the catalog yet, type its full name: the line opens a small form for category, unit and reorder level, and the item is added as you save.",
      "Press Receive delivery. You will see a summary; the stock is available straight away.",
    ],
    notes: ["A delivery for two locations is recorded as two deliveries."],
    link: { href: "/stock/receive", label: "Receive stock" },
  },
  {
    id: "correct",
    title: "Correcting counts and moving stock",
    needs: ["stock.write"],
    intro: "Use these when what is on the shelf differs from the register, or when stock moves between locations.",
    steps: [
      "Open Correct or move.",
      "To correct, choose the item and location, enter the change (use a minus sign to reduce) and say why. The reason is kept forever.",
      "To move, choose the item, where it is now, where it is going and how many.",
    ],
    notes: ["Nothing is ever overwritten. Every correction and move is a new line in Stock movements."],
    link: { href: "/stock/adjust", label: "Open Correct or move" },
  },
  {
    id: "ledger",
    title: "Stock movements",
    needs: ["stock.write", "stock.read_history"],
    intro: "The full ledger of every unit in and out, newest first, with who did it and why. Search by item, filter by location or type.",
    link: { href: "/stock", label: "Open Stock movements" },
  },
  {
    id: "catalog",
    title: "Looking after the catalog",
    needs: ["catalog.write"],
    intro: "Items, categories and locations live here.",
    steps: [
      "Use the tabs to switch between Items, Categories and Locations.",
      "Use the form on the right to add an entry; press Edit on a row to change it.",
      "Set a reorder level on items you never want to run out of. Items at or below it show as low stock.",
      "Retire entries you no longer use. Nothing is deleted, so history stays complete.",
    ],
    link: { href: "/catalog", label: "Open Catalog" },
  },
  {
    id: "people",
    title: "Accounts",
    needs: ["users.manage"],
    intro: "Accounts are only created here; there is no sign-up.",
    steps: [
      "Open People and fill in Add a person: full name, work email and role.",
      "Press Create account and send invite. They receive an email to set a password, then set up their authenticator at first sign-in.",
      "Invite expired? Use Resend sign-in link on their row.",
      "Lost phone? Use Reset authenticator; they set up a new one at their next sign-in.",
      "Someone leaving? Deactivate signs them out everywhere at once. Their history stays.",
    ],
    notes: ["There is exactly one Super User. Nobody can change their own role."],
    link: { href: "/people", label: "Open People" },
  },
  {
    id: "roles",
    title: "Roles",
    needs: ["roles.manage"],
    intro: "A role is a set of permissions. Fixed roles cannot be changed. You can create roles of your own and choose exactly what they allow.",
    link: { href: "/roles", label: "Open Roles" },
  },
  {
    id: "audit",
    title: "The audit log",
    needs: ["audit.read"],
    intro: "Every change and every sign-in is recorded with who, when and what changed. Entries cannot be edited or removed.",
    steps: [
      "Use the tabs to see one kind of entry, such as Stock, Accounts & roles or Sign-ins.",
      "Filter by person, dates or item. Click a person’s name to see everything they did, or History of an item to follow it.",
      "Press Check the seal. It re-reads every entry and confirms none was changed or removed since it was written.",
      "Download CSV gives you exactly what is on screen, for audits or spreadsheets.",
    ],
    notes: [
      "Direct database edits (made outside the app) are highlighted and show the database login used.",
      "The nightly backup also records the latest seal. If the log were ever rewritten, the seals would no longer match.",
    ],
    link: { href: "/audit", label: "Open the audit log" },
  },
];

export function allowed(item: Needs, permissions: readonly string[]) {
  if (item.hideIf?.some((k) => permissions.includes(k))) return false;
  return !item.needs || item.needs.some((k) => permissions.includes(k));
}
