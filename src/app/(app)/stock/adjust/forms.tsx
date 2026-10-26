"use client";

import { useId } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { adjustStock, transferStock } from "../actions";

type ItemOpt = { id: number; name: string; unit: string; sku: string | null };
type Opt = { id: number; name: string };

function ItemSelect({ items, id }: { items: ItemOpt[]; id?: string }) {
  return (
    <Select name="item_id" id={id} required defaultValue="">
      <option value="" disabled>Choose an item</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}{i.sku ? ` [${i.sku}]` : ""} ({i.unit})
        </option>
      ))}
    </Select>
  );
}

function LocationSelect({ name, locations, placeholder = "Choose a location" }: { name: string; locations: Opt[]; placeholder?: string }) {
  return (
    <Select name={name} required defaultValue="">
      <option value="" disabled>{placeholder}</option>
      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </Select>
  );
}

export function AdjustForm({ items, locations }: { items: ItemOpt[]; locations: Opt[] }) {
  const id = useId();
  return (
    <section className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Correct a count</h2>
      <p className="mt-1 text-sm text-ink-2">Found more or fewer than recorded, or something broke or expired. Use a minus sign to reduce.</p>
      <ActionForm action={adjustStock} submitLabel="Record correction" className="mt-4 space-y-4">
        <Field label="Item"><ItemSelect items={items} id={`${id}-item`} /></Field>
        <Field label="Location"><LocationSelect name="location_id" locations={locations} /></Field>
        <Field label="Change" hint="e.g. -2 for two damaged, +1 for one found in a count">
          <Input name="delta" type="number" min={-1000000} max={1000000} required className="num" placeholder="-2" />
        </Field>
        <Field label="Reason"><Textarea name="note" rows={2} maxLength={500} required placeholder="e.g. Two bottles cracked in transit" /></Field>
      </ActionForm>
    </section>
  );
}

export function TransferForm({ items, locations }: { items: ItemOpt[]; locations: Opt[] }) {
  const id = useId();
  return (
    <section className="border-t-2 border-ink pt-4">
      <h2 className="text-lg font-semibold">Move between locations</h2>
      <p className="mt-1 text-sm text-ink-2">Stock leaves one location and arrives at the other in a single step.</p>
      <ActionForm action={transferStock} submitLabel="Move stock" className="mt-4 space-y-4">
        <Field label="Item"><ItemSelect items={items} id={`${id}-item`} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From"><LocationSelect name="from_location" locations={locations} placeholder="Choose" /></Field>
          <Field label="To"><LocationSelect name="to_location" locations={locations} placeholder="Choose" /></Field>
        </div>
        <Field label="Quantity"><Input name="quantity" type="number" min={1} max={1000000} required className="num" /></Field>
        <Field label="Note" hint="Optional"><Textarea name="note" rows={2} maxLength={500} /></Field>
      </ActionForm>
    </section>
  );
}
