-- Low stock is judged on the item's total across all active locations.
-- Per-location checks flagged every lab's small working stock as "low" even
-- when the store held plenty; reordering from a supplier is about the total.

drop view if exists inventory.low_stock;

create view inventory.low_stock with (security_invoker = true) as
select i.id as item_id,
       i.name as item_name,
       i.sku,
       i.unit,
       i.reorder_level,
       coalesce(sum(sl.quantity) filter (where l.active), 0)::int as quantity,
       -- where the remaining units are, e.g. "Main store 3, Lab 1 2"
       coalesce(string_agg(l.name || ' ' || sl.quantity, ', ' order by l.name)
                filter (where l.active and sl.quantity > 0), '') as held_at
from inventory.items i
left join inventory.stock_levels sl on sl.item_id = i.id
left join inventory.locations l on l.id = sl.location_id
where i.active and i.reorder_level > 0
group by i.id
having coalesce(sum(sl.quantity) filter (where l.active), 0) <= i.reorder_level;

grant select on inventory.low_stock to authenticated;
