"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { adjustStock, receiveStock, transferStock } from "./actions";

type Opt = { id: number; name: string; unit?: string };
type Mode = "receive" | "adjust" | "transfer";

export function StockForms({ items, locations }: { items: Opt[]; locations: Opt[] }) {
  const [mode, setMode] = useState<Mode>("receive");
  const disabled = items.length === 0 || locations.length === 0;

  return (
    <div className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Record a movement</h2>
      <div className="mt-3 flex gap-1 text-sm">
        {(["receive", "adjust", "transfer"] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cx("rounded-sm px-3 py-1.5 capitalize", mode === m ? "bg-ink text-paper" : "text-ink-2 hover:bg-sheet-tint")}>
            {m}
          </button>
        ))}
      </div>

      {disabled ? (
        <p className="mt-4 text-sm text-ink-3">Add at least one item and one location in the catalog first.</p>
      ) : mode === "receive" ? (
        <ActionForm key="receive" action={receiveStock} submitLabel="Receive stock" className="mt-4 space-y-4">
          <ItemAndLocation items={items} locations={locations} />
          <Field label="Quantity"><Input name="quantity" type="number" min={1} max={1000000} required className="num" /></Field>
          <Field label="Note" hint="Optional: supplier, PO number, who dropped it off"><Textarea name="note" rows={2} maxLength={500} /></Field>
        </ActionForm>
      ) : mode === "adjust" ? (
        <ActionForm key="adjust" action={adjustStock} submitLabel="Record adjustment" variant="secondary" className="mt-4 space-y-4">
          <p className="text-sm text-ink-2">For counts, damage or loss. Use a minus sign to reduce.</p>
          <ItemAndLocation items={items} locations={locations} />
          <Field label="Change" hint="e.g. -2 for two damaged, +1 found in a count"><Input name="delta" type="number" min={-1000000} max={1000000} required className="num" placeholder="-2" /></Field>
          <Field label="Reason"><Textarea name="note" rows={2} maxLength={500} required /></Field>
        </ActionForm>
      ) : (
        <ActionForm key="transfer" action={transferStock} submitLabel="Move stock" variant="secondary" className="mt-4 space-y-4">
          <Field label="Item"><ItemSelect items={items} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Select name="from_location" required defaultValue=""><option value="" disabled>Choose</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <Field label="To"><Select name="to_location" required defaultValue=""><option value="" disabled>Choose</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          </div>
          <Field label="Quantity"><Input name="quantity" type="number" min={1} max={1000000} required className="num" /></Field>
          <Field label="Note" hint="Optional"><Textarea name="note" rows={2} maxLength={500} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

function ItemSelect({ items }: { items: Opt[] }) {
  return (
    <Select name="item_id" required defaultValue="">
      <option value="" disabled>Choose an item</option>
      {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit ? ` (${i.unit})` : ""}</option>)}
    </Select>
  );
}

function ItemAndLocation({ items, locations }: { items: Opt[]; locations: Opt[] }) {
  return (
    <>
      <Field label="Item"><ItemSelect items={items} /></Field>
      <Field label="Location">
        <Select name="location_id" required defaultValue="">
          <option value="" disabled>Choose a location</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
    </>
  );
}
