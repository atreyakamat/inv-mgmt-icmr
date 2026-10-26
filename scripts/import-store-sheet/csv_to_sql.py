"""Turn the NIMR FU Goa store sheet into one SQL script for the inventory schema.

Design:
- Every distinct "Location of the Item" becomes a location (cleaned names).
- Category comes from the sheet's own grouping (O-1 Stationery, O-2 Electronic...);
  sections without a grouping get "Lab supplies" or "General store".
- Same item name (+ description) in several places = one catalog item with
  stock in each place.
- For each row: receive "Stock Quantity", then record "No. of Item Issued" as an
  adjustment, so the system's balance equals the sheet's "Balance Item" and the
  history says where the numbers came from.
"""
import csv, re, sys
from collections import OrderedDict

SRC, OUT = sys.argv[1], sys.argv[2]

rows = list(csv.reader(open(SRC, encoding="utf-8-sig")))[1:]

LOCATION_NAMES = {
    "Office; O-1 : Stationery Items": ("Office · O-1", "Stationery cupboard"),
    "Office; O-2 : Electronic Items": ("Office · O-2", "Electronic items cupboard"),
    "Office; O-3 : Entomology Items": ("Office · O-3", "Entomology items cupboard"),
    "Office; O-5 : Cleaning Items": ("Office · O-5", "Cleaning items cupboard"),
    "Office; O-9 : General Lab Items": ("Office · O-9", "General lab items cupboard"),
    "Office; O-10 : Insectary Items": ("Office · O-10", "Insectary items cupboard"),
    "Office; O-11 : BSL Items": ("Office · O-11", "BSL items cupboard"),
    "Entomology; AL-7 : General Store Items": ("Entomology · AL-7", "General store items"),
    "Enteryway Corridoor; Conference Almirah": ("Entryway corridor · Conference almirah", None),
    "Enteryway Corridoor; AL-3": ("Entryway corridor · AL-3", None),
    "Microbiology Lab; M-02 : Store/Stock": ("Microbiology Lab · M-02", "Store / stock"),
    "Microbiology Lab; M-04 : Store/Stock": ("Microbiology Lab · M-04", "Store / stock"),
    "Microbiology Lab; M-05 : Store/Stock": ("Microbiology Lab · M-05", "Store / stock"),
    "Microbiology Lab; M-06 : Store/Stock": ("Microbiology Lab · M-06", "Store / stock"),
    "Minum Lab; C2 : Glass Door Almirah": ("Minum Lab · C2", "Glass door almirah"),
    "Minum Lab; C3": ("Minum Lab · C3", None),
    "Minum Lab; Room No.-2": ("Minum Lab · Room 2", None),
    "Minum Lab; Room No.-3": ("Minum Lab · Room 3", None),
    "AL-6": ("AL-6", None),
    "AL-8": ("AL-8", None),
    "Administration Room": ("Administration room", None),
}

def category_for(loc: str) -> str:
    m = re.search(r":\s*(.+? Items)$", loc)
    if m:
        return {
            "Stationery Items": "Stationery",
            "Electronic Items": "Electronics & electrical",
            "Entomology Items": "Entomology equipment",
            "Cleaning Items": "Cleaning & hygiene",
            "General Lab Items": "Files & general lab items",
            "Insectary Items": "Insectary",
            "BSL Items": "BSL (biosafety lab)",
            "General Store Items": "General store",
        }[m.group(1)]
    if loc.startswith("Microbiology Lab") or loc in ("Enteryway Corridoor; AL-3", "AL-6", "AL-8"):
        return "Lab supplies"
    return "General store"

CATEGORY_NOTES = {
    "Lab supplies": "Lab consumables and reagents (Microbiology Lab, AL-3, AL-6, AL-8)",
    "General store": "Mixed general stock (Entomology AL-7, Conference almirah, Minum Lab, Admin room)",
}

UNIT_HINTS = [
    (r"\(packet[s]?\)|packet", "packet"), (r"\(pieces\)|\(pcs\)|pieces\)", "pcs"),
    (r"\(roll\)|roll\b", "roll"), (r"\(box\)|box\b", "box"), (r"\bream\b", "ream"),
    (r"\(pair\)", "pair"), (r"\(racks?\)", "rack"), (r"\(bag\)", "bag"), (r"\bkit\b", "kit"),
    (r"\bbottle\b", "bottle"), (r"\bcan\b", "can"),
]

def unit_for(name: str) -> str:
    low = name.lower()
    for pat, unit in UNIT_HINTS:
        if re.search(pat, low):
            return unit
    return "pcs"

def q(s):
    return "null" if s is None or s == "" else "'" + s.replace("'", "''") + "'"

def num(s):
    s = (s or "").strip()
    return int(s) if s.isdigit() else None

items = OrderedDict()   # key -> item dict
stock_rows = []         # per-row receive/issue
block = "NIMR"
prev_serial = 0
for idx, r in enumerate(rows, start=2):
    r = (r + [""] * 12)[:12]
    serial, name, desc, loc, stock, issued, balance, last_date, reorder, _flag, _rdate, remark = [c.strip() for c in r]
    if not name or not loc:
        continue
    # The sheet restarts numbering for the Minum Lab section.
    s_num = int(re.match(r"\d+", serial).group()) if re.match(r"\d+", serial) else None
    if s_num is not None and s_num < prev_serial - 50:
        block = "MINUM"
    if s_num is not None:
        prev_serial = s_num

    lines = [l.strip() for l in name.splitlines() if l.strip()]
    title = re.sub(r"\s+", " ", lines[0]).strip().rstrip(")").strip() if lines[0].count("(") < lines[0].count(")") else re.sub(r"\s+", " ", lines[0]).strip()
    extra = "; ".join(lines[1:])
    description = "; ".join(x for x in [desc, extra] if x) or None
    key = (title.lower(), (desc or "").lower())

    cat = category_for(loc)
    if key not in items:
        sku = f"{block}-{serial.zfill(3) if serial.isdigit() else serial}" if serial else None
        items[key] = {
            "name": title[:120], "description": description, "category": cat,
            "unit": unit_for(title), "reorder": num(reorder) or 0, "sku": sku,
        }
    else:
        items[key]["reorder"] = max(items[key]["reorder"], num(reorder) or 0)

    s, i = num(stock), num(issued)
    note_bits = [f"sheet row {idx}"]
    if remark:
        note_bits.append(re.sub(r"\s+", " ", remark))
    if s is None:
        items[key]["description"] = "; ".join(x for x in [items[key]["description"], "Quantity not tracked in the store sheet"] if x)
    stock_rows.append({
        "key": key, "loc": LOCATION_NAMES[loc][0], "stock": s or 0, "issued": i or 0,
        "last": last_date, "note": "; ".join(note_bits),
    })

categories = OrderedDict()
for it in items.values():
    categories.setdefault(it["category"], CATEGORY_NOTES.get(it["category"]))

used_locs = OrderedDict()
for raw, (nm, d) in LOCATION_NAMES.items():
    if any(sr["loc"] == nm for sr in stock_rows):
        used_locs[nm] = d

# Dedupe SKUs defensively.
seen = set()
for it in items.values():
    if it["sku"] in seen:
        it["sku"] = None
    elif it["sku"]:
        seen.add(it["sku"])

out = []
w = out.append
w("-- =====================================================================")
w("-- NIMR FU Goa store: load the store sheet into the inventory system")
w(f"-- {len(items)} items, {len(categories)} categories, {len(used_locs)} locations, {len(stock_rows)} sheet rows")
w("-- Paste the whole file into Supabase -> SQL Editor -> Run. Runs as one")
w("-- transaction: either everything loads or nothing does.")
w("-- Safe to run only on an empty catalog (it stops if items already exist).")
w("-- =====================================================================")
w("")
w("begin;")
w("")
w("-- 0. Low-stock alerts judge the total across locations (migration 5).")
w("drop view if exists inventory.low_stock;")
w("""create view inventory.low_stock with (security_invoker = true) as
select i.id as item_id, i.name as item_name, i.sku, i.unit, i.reorder_level,
       coalesce(sum(sl.quantity) filter (where l.active), 0)::int as quantity,
       coalesce(string_agg(l.name || ' ' || sl.quantity, ', ' order by l.name)
                filter (where l.active and sl.quantity > 0), '') as held_at
from inventory.items i
left join inventory.stock_levels sl on sl.item_id = i.id
left join inventory.locations l on l.id = sl.location_id
where i.active and i.reorder_level > 0
group by i.id
having coalesce(sum(sl.quantity) filter (where l.active), 0) <= i.reorder_level;
grant select on inventory.low_stock to authenticated;""")
w("")
w("-- 1. Refuse to run twice.")
w("do $$ begin")
w("  if exists (select 1 from inventory.items) then")
w("    raise exception 'The catalog already has items. This import is for an empty catalog.';")
w("  end if;")
w("end $$;")
w("")
w("-- 2. Categories")
w("insert into inventory.categories (name, description) values")
w(",\n".join(f"  ({q(n)}, {q(d)})" for n, d in categories.items()) + ";")
w("")
w("-- 3. Locations")
w("insert into inventory.locations (name, description) values")
w(",\n".join(f"  ({q(n)}, {q(d)})" for n, d in used_locs.items()) + ";")
w("")
w("-- 4. Items")
w("insert into inventory.items (sku, name, description, category_id, unit, reorder_level)")
w("select v.sku, v.name, v.description, c.id, v.unit, v.reorder_level")
w("from (values")
w(",\n".join(
    f"  ({q(it['sku'])}, {q(it['name'])}, {q(it['description'])}, {q(it['category'])}, {q(it['unit'])}, {it['reorder']})"
    for it in items.values()) )
w(") as v(sku, name, description, category, unit, reorder_level)")
w("join inventory.categories c on c.name = v.category;")
w("")
w("-- 5. Stock: what the sheet says came in, then what it says went out.")
w("create temporary table sheet_rows (item_name text, item_desc text, location text, stock int, issued int, last_issue text, note text) on commit drop;")
w("insert into sheet_rows values")
def item_desc(k):
    return items[k]["description"]
w(",\n".join(
    f"  ({q(items[sr['key']]['name'])}, {q(item_desc(sr['key']))}, {q(sr['loc'])}, {sr['stock']}, {sr['issued']}, {q(sr['last'])}, {q(sr['note'])})"
    for sr in stock_rows) + ";")
w("")
w("insert into inventory.stock_movements (item_id, location_id, kind, quantity, note)")
w("select i.id, l.id, 'receive', s.stock, 'Opening stock from the store sheet (' || s.note || ')'")
w("from sheet_rows s")
w("join inventory.items i on i.name = s.item_name and i.description is not distinct from s.item_desc")
w("join inventory.locations l on l.name = s.location")
w("where s.stock > 0;")
w("")
w("insert into inventory.stock_movements (item_id, location_id, kind, quantity, note)")
w("select i.id, l.id, 'adjust', -s.issued,")
w("       'Issued before the system went live, per the store sheet'")
w("       || coalesce(' (last issue ' || nullif(s.last_issue, '') || ')', '') || '; ' || s.note")
w("from sheet_rows s")
w("join inventory.items i on i.name = s.item_name and i.description is not distinct from s.item_desc")
w("join inventory.locations l on l.name = s.location")
w("where s.issued > 0;")
w("")
w("-- 6. Check: every sheet row's balance matches the system, or nothing is saved.")
w("do $$")
w("declare v_bad int; v_rows int;")
w("begin")
w("  select count(*) into v_rows from sheet_rows;")
w("  select count(*) into v_bad from (")
w("    select s.location, s.item_name, s.item_desc, sum(s.stock - s.issued) as expected")
w("    from sheet_rows s group by 1, 2, 3")
w("  ) e")
w("  join inventory.items i on i.name = e.item_name and i.description is not distinct from e.item_desc")
w("  join inventory.locations l on l.name = e.location")
w("  left join inventory.stock_levels sl on sl.item_id = i.id and sl.location_id = l.id")
w("  where coalesce(sl.quantity, 0) <> e.expected;")
w("  if v_bad > 0 then")
w("    raise exception 'Balance check failed for % rows; nothing was saved', v_bad;")
w("  end if;")
w(f"  raise notice 'Imported % sheet rows; every balance matches the sheet', v_rows;")
w("end $$;")
w("")
w("commit;")
w("")
w("-- Summary")
w("select (select count(*) from inventory.categories) as categories,")
w("       (select count(*) from inventory.locations) as locations,")
w("       (select count(*) from inventory.items) as items,")
w("       (select sum(quantity) from inventory.stock_levels) as units_in_stock,")
w("       (select count(*) from inventory.low_stock) as low_stock_alerts;")

open(OUT, "w").write("\n".join(out) + "\n")
print(f"items={len(items)} categories={len(categories)} locations={len(used_locs)} rows={len(stock_rows)}")
for c in categories:
    print("  category:", c, sum(1 for it in items.values() if it["category"] == c))
print("long names:", [it["name"] for it in items.values() if len(it["name"]) > 80])
print("units:", {u: sum(1 for it in items.values() if it["unit"] == u) for u in sorted(set(it["unit"] for it in items.values()))})
