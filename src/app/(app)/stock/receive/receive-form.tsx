"use client";

import { useActionState, useId, useMemo, useState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/actions";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";
import { receiveDelivery } from "../actions";

type ItemOpt = { id: number; name: string; sku: string | null; unit: string };
type Opt = { id: number; name: string };
type Received = { location: string; reference: string; lines: { label: string; quantity: number; unit: string; isNew: boolean }[] };
type Line = { key: number; text: string; quantity: string; categoryId: string; unit: string; reorder: string };

const blankLine = (key: number): Line => ({ key, text: "", quantity: "", categoryId: "", unit: "pcs", reorder: "0" });

export function ReceiveForm({
  items,
  categories,
  locations,
  canAddItems,
}: {
  items: ItemOpt[];
  categories: Opt[];
  locations: Opt[];
  canAddItems: boolean;
}) {
  const listId = useId();
  const [received, setReceived] = useState<Received | null>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await receiveDelivery(prev, fd);
    if (result?.ok) {
      try {
        setReceived(JSON.parse(String(fd.get("summary"))) as Received);
      } catch {
        setReceived({ location: "", reference: "", lines: [] });
      }
    }
    return result;
  }, null);
  const [locationId, setLocationId] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const [nextKey, setNextKey] = useState(2);

  // A unique, readable label per item for the picker (names can repeat).
  const { labels, byLabel } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.name.toLowerCase(), (counts.get(i.name.toLowerCase()) ?? 0) + 1);
    const byLabel = new Map<string, ItemOpt>();
    const labels: { label: string; item: ItemOpt }[] = [];
    for (const i of items) {
      const label = (counts.get(i.name.toLowerCase()) ?? 0) > 1 ? `${i.name} [${i.sku ?? `#${i.id}`}]` : i.name;
      byLabel.set(label.toLowerCase(), i);
      labels.push({ label, item: i });
    }
    return { labels, byLabel };
  }, [items]);
  const resolve = (text: string) => byLabel.get(text.trim().toLowerCase()) ?? null;

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => {
    setLines((ls) => [...ls, blankLine(nextKey)]);
    setNextKey((k) => k + 1);
  };
  const removeLine = (key: number) => {
    setLines((ls) => (ls.length === 1 ? [blankLine(nextKey)] : ls.filter((l) => l.key !== key)));
    setNextKey((k) => k + 1);
  };
  const startOver = () => {
    setReceived(null);
    setLines([blankLine(nextKey)]);
    setNextKey((k) => k + 1);
    setReference("");
  };

  // ---- derive payload, problems and summary from the current form
  const filled = lines.filter((l) => l.text.trim() || l.quantity.trim());
  const problems: string[] = [];
  const payloadLines = filled.map((l, idx) => {
    const n = idx + 1;
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1) problems.push(`Line ${n}: enter a quantity of at least 1.`);
    const item = resolve(l.text);
    if (item) return { item_id: item.id, quantity: qty };
    if (!l.text.trim()) problems.push(`Line ${n}: choose an item.`);
    else if (!canAddItems) problems.push(`Line ${n}: “${l.text.trim()}” is not in the catalog.`);
    else if (!l.categoryId) problems.push(`Line ${n}: choose a category for the new item “${l.text.trim()}”.`);
    return {
      new_item: { name: l.text.trim(), category_id: Number(l.categoryId), unit: l.unit.trim() || "pcs", sku: "", reorder_level: Number(l.reorder) || 0 },
      quantity: qty,
    };
  });
  const units = payloadLines.reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
  const newCount = filled.filter((l) => l.text.trim() && !resolve(l.text)).length;
  const ready = Boolean(locationId) && filled.length > 0 && problems.length === 0;
  const summary: Received = {
    location: locations.find((l) => String(l.id) === locationId)?.name ?? "",
    reference,
    lines: filled.map((l) => {
      const item = resolve(l.text);
      return { label: item ? item.name : l.text.trim(), quantity: Number(l.quantity), unit: item ? item.unit : l.unit || "pcs", isNew: !item };
    }),
  };

  if (received) {
    return (
      <div className="max-w-2xl">
        <span className="stamp stamp-lg stamp-animate text-ok">Received</span>
        <h2 className="mt-6 text-2xl font-semibold">Delivery recorded{received.location && ` into ${received.location}`}</h2>
        {received.reference && <p className="mt-1 text-ink-2">{received.reference}</p>}
        <ul className="mt-5 divide-y divide-rule-soft border-y border-rule text-sm">
          {received.lines.map((l, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 py-2">
              <span>{l.label}{l.isNew && <span className="ml-2 text-xs text-stamp">added to catalog</span>}</span>
              <span className="num font-semibold text-ok">+{l.quantity} <span className="font-normal text-ink-3">{l.unit}</span></span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={startOver}>Receive another delivery</Button>
          <Link href="/stock" className="inline-flex items-center rounded-sm border border-rule bg-sheet px-3.5 py-2 text-sm font-medium hover:border-ink-3">
            View stock movements
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="max-w-4xl space-y-10">
      <input type="hidden" name="payload" value={JSON.stringify({ location_id: Number(locationId), reference, lines: payloadLines })} />
      <input type="hidden" name="summary" value={JSON.stringify(summary)} />

      <section>
        <h2 className="mb-1 text-lg font-semibold">Where is it going?</h2>
        <p className="mb-4 text-sm text-ink-2">Every line of this delivery goes to one location. Record a second delivery for a different place.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
              <option value="" disabled>Choose a location</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Reference" hint="Supplier, invoice or PO number. Optional, but it helps later.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} placeholder="e.g. Invoice 4411, Goa Scientific" />
          </Field>
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">What arrived?</h2>
        <p className="mb-4 text-sm text-ink-2">
          Start typing an item name and pick it from the list.
          {canAddItems && " If it is not listed, keep the name you typed and choose its category to add it to the catalog."}
        </p>

        <datalist id={listId}>
          {labels.map(({ label, item }) => <option key={item.id} value={label}>{item.unit}</option>)}
        </datalist>

        <ol className="space-y-3">
          {lines.map((l, idx) => {
            const item = resolve(l.text);
            const isNew = Boolean(l.text.trim()) && !item;
            return (
              <li key={l.key} className={cx("rounded-sm border bg-sheet p-3", isNew ? "border-stamp/40" : "border-rule")}>
                <div className="flex flex-wrap items-end gap-3">
                  <span className="num w-6 pb-2.5 text-sm text-ink-3">{idx + 1}</span>
                  <label className="min-w-0 flex-1 basis-64">
                    <span className="mb-1 block text-xs text-ink-3">Item</span>
                    <input
                      list={listId}
                      value={l.text}
                      onChange={(e) => update(l.key, { text: e.target.value })}
                      placeholder="Search the catalog"
                      aria-label={`Item for line ${idx + 1}`}
                      className="field"
                      autoComplete="off"
                    />
                  </label>
                  <label className="w-32">
                    <span className="mb-1 block text-xs text-ink-3">Quantity{item && ` (${item.unit})`}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1000000}
                      value={l.quantity}
                      onChange={(e) => update(l.key, { quantity: e.target.value })}
                      aria-label={`Quantity for line ${idx + 1}`}
                      className="field num text-right"
                    />
                  </label>
                  <button type="button" onClick={() => removeLine(l.key)} className="pb-2.5 text-sm text-ink-3 hover:text-bad" aria-label={`Remove line ${idx + 1}`}>
                    Remove
                  </button>
                </div>

                {isNew && canAddItems && (
                  <div className="mt-3 grid gap-3 border-t border-dashed border-rule pt-3 sm:grid-cols-[1fr_8rem_8rem] sm:pl-9">
                    <p className="text-sm text-stamp sm:col-span-3">New item: “{l.text.trim()}” will be added to the catalog.</p>
                    <label>
                      <span className="mb-1 block text-xs text-ink-3">Category</span>
                      <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} className="field" aria-label={`Category for new item on line ${idx + 1}`}>
                        <option value="" disabled>Choose</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span className="mb-1 block text-xs text-ink-3">Unit</span>
                      <input value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} maxLength={20} className="field" aria-label={`Unit for new item on line ${idx + 1}`} />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs text-ink-3">Reorder at</span>
                      <input type="number" min={0} value={l.reorder} onChange={(e) => update(l.key, { reorder: e.target.value })} className="field num" aria-label={`Reorder level for new item on line ${idx + 1}`} />
                    </label>
                  </div>
                )}
                {isNew && !canAddItems && <p className="mt-2 text-sm text-bad sm:pl-9">Not in the catalog. Ask the store manager to add it first.</p>}
              </li>
            );
          })}
        </ol>
        <button type="button" onClick={addLine} className="mt-3 rounded-sm border border-dashed border-rule px-3.5 py-2 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
          Add another item
        </button>
      </section>

      <section className="border-t-2 border-ink pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-ink-2">
            <span className="num font-semibold text-ink">{filled.length}</span> {filled.length === 1 ? "line" : "lines"} ·{" "}
            <span className="num font-semibold text-ink">{units}</span> units
            {newCount > 0 && <> · <span className="text-stamp">{newCount} new {newCount === 1 ? "item" : "items"}</span></>}
          </p>
          <Button type="submit" variant="stamp" disabled={pending || !ready}>
            {pending ? "Recording…" : "Receive delivery"}
          </Button>
        </div>
        {!locationId && filled.length > 0 && <p className="mt-2 text-sm text-ink-3">Choose a location to continue.</p>}
        {problems.length > 0 && <ul className="mt-3 space-y-1 text-sm text-bad">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {state && !state.ok && <div className="mt-3"><Notice tone="bad">{state.error}</Notice></div>}
      </section>
    </form>
  );
}
