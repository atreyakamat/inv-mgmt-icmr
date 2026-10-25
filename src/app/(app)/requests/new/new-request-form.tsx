"use client";

import { useActionState, useMemo, useState } from "react";
import { submitRequest } from "../actions";
import type { ActionState } from "@/lib/actions";
import { Button, Field, Input, Notice, Select, Textarea, cx } from "@/components/ui";

type ItemOpt = { id: number; name: string; sku: string | null; unit: string; category_id: number; in_stock: number };

export function NewRequestForm({
  items,
  categories,
  locations,
}: {
  items: ItemOpt[];
  categories: { id: number; name: string }[];
  locations: { id: number; name: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitRequest, null);
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<number, number>>({});

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => !s || i.name.toLowerCase().includes(s) || (i.sku ?? "").toLowerCase().includes(s));
  }, [items, q]);

  const chosen = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  function setItem(id: number, n: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(100_000, Math.floor(n || 0))) }));
  }

  return (
    <form action={action} className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* Picker */}
      <div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items"
          aria-label="Search items"
          className="field mb-3"
        />
        <div className="max-h-[32rem] overflow-y-auto border-y border-ink">
          <table className="register text-sm">
            <thead className="sticky top-0 bg-paper">
              <tr><th>Item</th><th>Category</th><th className="r">In stock</th><th className="r w-28">Quantity</th></tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.id} className={cx((qty[i.id] ?? 0) > 0 && "bg-stamp-soft/50")}>
                  <td>
                    <div className="font-medium">{i.name}</div>
                    {i.sku && <div className="text-xs text-ink-3">{i.sku}</div>}
                  </td>
                  <td className="text-ink-2">{catName.get(i.category_id)}</td>
                  <td className={cx("num r", i.in_stock === 0 ? "text-bad" : "text-ink-2")}>{i.in_stock} {i.unit}</td>
                  <td className="r">
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      inputMode="numeric"
                      aria-label={`Quantity of ${i.name}`}
                      value={qty[i.id] || ""}
                      onChange={(e) => setItem(i.id, Number(e.target.value))}
                      className="field num w-24 py-1.5 text-right"
                    />
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-ink-3">No items match “{q}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary + details */}
      <div className="space-y-5 lg:sticky lg:top-8 lg:self-start">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Your request</h2>
          {chosen.length === 0 ? (
            <p className="text-sm text-ink-3">Add quantities on the left.</p>
          ) : (
            <ul className="divide-y divide-rule-soft border-y border-rule text-sm">
              {chosen.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{i.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="num font-semibold">{qty[i.id]} {i.unit}</span>
                    <button type="button" onClick={() => setItem(i.id, 0)} className="text-ink-3 hover:text-bad" aria-label={`Remove ${i.name}`}>×</button>
                  </span>
                  <input type="hidden" name={`qty[${i.id}]`} value={qty[i.id]} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="Collect from">
          <Select name="location_id" required defaultValue="">
            <option value="" disabled>Choose a location</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="What is it for?" hint="Reviewers read this first. One or two clear sentences.">
          <Textarea name="purpose" required maxLength={1000} placeholder="e.g. Gloves and pipette tips for the Tuesday sample run" />
        </Field>
        <Field label="Needed by" hint="Optional">
          <Input name="needed_by" type="date" min={new Date().toISOString().slice(0, 10)} />
        </Field>

        {state && !state.ok && <Notice tone="bad">{state.error}</Notice>}
        <Button type="submit" disabled={pending || chosen.length === 0} className="w-full justify-center">
          {pending ? "Submitting…" : `Submit request${chosen.length ? ` (${chosen.length} item${chosen.length > 1 ? "s" : ""})` : ""}`}
        </Button>
      </div>
    </form>
  );
}
