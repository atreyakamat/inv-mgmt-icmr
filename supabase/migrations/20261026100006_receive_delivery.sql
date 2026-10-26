-- Receive a whole delivery in one go, optionally adding new catalog items.
--
-- p_lines: [{"item_id": 12, "quantity": 5},
--           {"new_item": {"name": "Parafilm roll", "category_id": 3, "unit": "roll",
--                         "sku": null, "reorder_level": 2, "description": null},
--            "quantity": 4}]
-- All lines share one batch_id so the ledger can show them as one delivery.
-- Everything succeeds or nothing is saved.

alter table inventory.stock_movements add column if not exists batch_id uuid;
create index if not exists stock_movements_batch_idx on inventory.stock_movements (batch_id) where batch_id is not null;

create or replace function inventory.receive_delivery(p_location_id bigint, p_reference text, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('stock.write');
  v_batch uuid := gen_random_uuid();
  v_line jsonb;
  v_new jsonb;
  v_item bigint;
  v_qty int;
  v_name text;
  v_n int := 0;
begin
  if not exists (select 1 from inventory.locations where id = p_location_id and active) then
    raise exception 'Choose where the delivery is being stored';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item to the delivery';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'At most 100 lines per delivery';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_qty := nullif(v_line->>'quantity', '')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then
      raise exception 'Line %: quantity must be between 1 and 1000000', v_n;
    end if;

    if v_line ? 'new_item' then
      if not inventory.has_permission('catalog.write') then
        raise exception 'Line %: you can receive stock but not add new items to the catalog', v_n
          using errcode = '42501';
      end if;
      v_new := v_line->'new_item';
      v_name := inventory._clean(v_new->>'name');
      if v_name is null then
        raise exception 'Line %: the new item needs a name', v_n;
      end if;
      if exists (select 1 from inventory.items where lower(name) = lower(v_name) and active) then
        raise exception 'Line %: "%" is already in the catalog, pick it from the list instead', v_n, v_name;
      end if;
      if not exists (select 1 from inventory.categories where id = (v_new->>'category_id')::bigint and active) then
        raise exception 'Line %: choose a category for "%"', v_n, v_name;
      end if;
      insert into inventory.items (sku, name, description, category_id, unit, reorder_level, created_by)
      values (inventory._clean(v_new->>'sku'), v_name, inventory._clean(v_new->>'description'),
              (v_new->>'category_id')::bigint,
              coalesce(inventory._clean(v_new->>'unit'), 'pcs'),
              greatest(coalesce(nullif(v_new->>'reorder_level', '')::int, 0), 0),
              me.id)
      returning id into v_item;
    else
      v_item := nullif(v_line->>'item_id', '')::bigint;
      if v_item is null or not exists (select 1 from inventory.items where id = v_item and active) then
        raise exception 'Line %: item not found or retired', v_n;
      end if;
    end if;

    insert into inventory.stock_movements (item_id, location_id, kind, quantity, batch_id, note, created_by)
    values (v_item, p_location_id, 'receive', v_qty, v_batch, inventory._clean(p_reference), me.id);
  end loop;

  perform inventory._audit('receive_delivery', 'stock_movements', v_batch::text, p_reference,
                           jsonb_build_object('lines', v_n, 'location_id', p_location_id));
  return v_batch;
end $$;

revoke all on function inventory.receive_delivery(bigint, text, jsonb) from public, anon;
grant execute on function inventory.receive_delivery(bigint, text, jsonb) to authenticated;
