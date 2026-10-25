"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import type { Category, Item, Location } from "@/lib/database.types";
import type { ActionState } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { saveEntry, setActive } from "./actions";

type Kind = "items" | "categories" | "locations";
type Entry = Item | Category | Location;

export function EntryForm({
  kind,
  entry,
  categories,
  cancelHref,
}: {
  kind: Kind;
  entry: Entry | null;
  categories: { id: number; name: string }[];
  cancelHref: string;
}) {
  const router = useRouter();
  const singular = { items: "item", categories: "category", locations: "location" }[kind];
  const item = kind === "items" ? (entry as Item | null) : null;

  return (
    <div className="border-t-2 border-ink pt-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{entry ? `Edit ${singular}` : `New ${singular}`}</h2>
        {entry && <Link href={cancelHref} className="text-sm text-ink-3 hover:text-ink">Cancel</Link>}
      </div>
      <ActionForm
        action={saveEntry}
        hidden={{ kind, ...(entry ? { id: entry.id } : {}) }}
        submitLabel={entry ? "Save changes" : `Add ${singular}`}
        onDone={(s) => s?.ok && entry && router.replace(cancelHref)}
        className="mt-3 space-y-4"
      >
        <Field label="Name"><Input name="name" required maxLength={kind === "items" ? 120 : 80} defaultValue={entry?.name ?? ""} autoFocus /></Field>
        {kind === "items" && (
          <>
            <Field label="Code / SKU" hint="Optional, must be unique"><Input name="sku" maxLength={40} defaultValue={item?.sku ?? ""} /></Field>
            <Field label="Category">
              <Select name="category_id" required defaultValue={item?.category_id ?? ""}>
                <option value="" disabled>Choose</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit" hint="pcs, box, pack, L…"><Input name="unit" required maxLength={20} defaultValue={item?.unit ?? "pcs"} /></Field>
              <Field label="Reorder at" hint="0 = no alert"><Input name="reorder_level" type="number" min={0} max={1000000} defaultValue={item?.reorder_level ?? 0} className="num" /></Field>
            </div>
          </>
        )}
        <Field label="Description" hint="Optional"><Textarea name="description" rows={2} maxLength={500} defaultValue={entry?.description ?? ""} /></Field>
      </ActionForm>
    </div>
  );
}

export function ToggleActive({ kind, id, active }: { kind: Kind; id: number; active: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setActive, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <button type="submit" disabled={pending} className="text-ink-2 hover:underline disabled:opacity-50" title={state && !state.ok ? state.error : undefined}>
        {active ? "Retire" : "Reactivate"}
      </button>
    </form>
  );
}
