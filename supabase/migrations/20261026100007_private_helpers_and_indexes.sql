-- Hardening and performance, from the Supabase advisors.
--
-- 1. The five access-check helpers move to `inventory_private`, a schema the
--    Data API does not expose. Policies still use them (signed-in users keep
--    EXECUTE), but nobody can call them over the API any more. That matters
--    because the auth users are shared with the other app in this project, so
--    any signed-in account could previously probe them (for example ask
--    whether a hidden role exists).
-- 2. Policies are rebuilt so per-user checks run once per query, not once per
--    row: calls are wrapped in (select ...) and become init plans.
-- 3. Indexes for every foreign key that had none.
--
-- Run after 20261026100006, as one script. Re-running it is harmless.

-- ---------------------------------------------------------------------------
-- 1. Private schema for helpers
-- ---------------------------------------------------------------------------
create schema if not exists inventory_private;
revoke all on schema inventory_private from public, anon;
grant usage on schema inventory_private to authenticated, service_role;
alter default privileges in schema inventory_private revoke execute on functions from public;

do $$
declare f text;
begin
  foreach f in array array['current_member()', 'is_member()', 'has_permission(text)',
                           'role_is_hidden(bigint)', 'my_permissions()'] loop
    if to_regprocedure('inventory.' || f) is not null then
      execute format('alter function inventory.%s set schema inventory_private', f);
    end if;
  end loop;
end $$;

-- Function bodies are stored as text, so every function that calls a moved
-- helper is re-created with the new schema name. CREATE OR REPLACE keeps the
-- owner, grants and identity of each function.
do $$
declare
  r record;
  pattern constant text := 'inventory\.(current_member|is_member|has_permission|role_is_hidden|my_permissions)\(';
begin
  for r in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('inventory', 'inventory_private') and p.prosrc ~ pattern
  loop
    execute regexp_replace(pg_get_functiondef(r.oid), pattern, 'inventory_private.\1(', 'g');
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('inventory', 'inventory_private') and p.prosrc ~ pattern
  ) then
    raise exception 'A function still calls a helper by its old name';
  end if;
end $$;

-- Only these may be executed by signed-in users; nothing else in the private schema.
revoke execute on all functions in schema inventory_private from public, anon, authenticated;
grant execute on function
  inventory_private.current_member(), inventory_private.is_member(),
  inventory_private.has_permission(text), inventory_private.role_is_hidden(bigint),
  inventory_private.my_permissions()
to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies, rebuilt
-- ---------------------------------------------------------------------------
drop policy if exists permissions_select      on inventory.permissions;
drop policy if exists roles_select            on inventory.roles;
drop policy if exists role_permissions_select on inventory.role_permissions;
drop policy if exists profiles_select         on inventory.profiles;
drop policy if exists categories_select       on inventory.categories;
drop policy if exists categories_insert       on inventory.categories;
drop policy if exists categories_update       on inventory.categories;
drop policy if exists locations_select        on inventory.locations;
drop policy if exists locations_insert        on inventory.locations;
drop policy if exists locations_update        on inventory.locations;
drop policy if exists items_select            on inventory.items;
drop policy if exists items_insert            on inventory.items;
drop policy if exists items_update            on inventory.items;
drop policy if exists stock_levels_select     on inventory.stock_levels;
drop policy if exists stock_movements_select  on inventory.stock_movements;
drop policy if exists requests_select         on inventory.requests;
drop policy if exists request_lines_select    on inventory.request_lines;
drop policy if exists request_events_select   on inventory.request_events;
drop policy if exists audit_log_select        on inventory.audit_log;

create policy permissions_select on inventory.permissions for select to authenticated
using ((select inventory_private.is_member()));

create policy roles_select on inventory.roles for select to authenticated
using (
  (select inventory_private.is_member())
  and (
    not hidden
    or (select inventory_private.has_permission('users.manage'))
    or id = (select (inventory_private.current_member()).role_id)
  )
);

create policy role_permissions_select on inventory.role_permissions for select to authenticated
using (exists (select 1 from inventory.roles r where r.id = role_id));

create policy profiles_select on inventory.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (
    (select inventory_private.is_member())
    and (
      (select inventory_private.has_permission('users.manage'))
      or not inventory_private.role_is_hidden(role_id)
    )
  )
);

create policy categories_select on inventory.categories for select to authenticated
using ((select inventory_private.is_member()));
create policy categories_insert on inventory.categories for insert to authenticated
with check ((select inventory_private.has_permission('catalog.write')));
create policy categories_update on inventory.categories for update to authenticated
using ((select inventory_private.has_permission('catalog.write')))
with check ((select inventory_private.has_permission('catalog.write')));

create policy locations_select on inventory.locations for select to authenticated
using ((select inventory_private.is_member()));
create policy locations_insert on inventory.locations for insert to authenticated
with check ((select inventory_private.has_permission('catalog.write')));
create policy locations_update on inventory.locations for update to authenticated
using ((select inventory_private.has_permission('catalog.write')))
with check ((select inventory_private.has_permission('catalog.write')));

create policy items_select on inventory.items for select to authenticated
using ((select inventory_private.is_member()));
create policy items_insert on inventory.items for insert to authenticated
with check ((select inventory_private.has_permission('catalog.write')));
create policy items_update on inventory.items for update to authenticated
using ((select inventory_private.has_permission('catalog.write')))
with check ((select inventory_private.has_permission('catalog.write')));

create policy stock_levels_select on inventory.stock_levels for select to authenticated
using ((select inventory_private.is_member()));
create policy stock_movements_select on inventory.stock_movements for select to authenticated
using ((select inventory_private.has_permission('stock.read_history')));

create policy requests_select on inventory.requests for select to authenticated
using (
  (select inventory_private.is_member())
  and (
    requester_id = (select auth.uid())
    or (select inventory_private.has_permission('requests.read_all'))
  )
);

create policy request_lines_select on inventory.request_lines for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));

create policy request_events_select on inventory.request_events for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));

create policy audit_log_select on inventory.audit_log for select to authenticated
using ((select inventory_private.has_permission('audit.read')));

-- ---------------------------------------------------------------------------
-- 3. Foreign-key indexes
-- ---------------------------------------------------------------------------
create index if not exists categories_created_by_idx       on inventory.categories (created_by);
create index if not exists items_created_by_idx            on inventory.items (created_by);
create index if not exists locations_created_by_idx        on inventory.locations (created_by);
create index if not exists profiles_created_by_idx         on inventory.profiles (created_by);
create index if not exists request_events_actor_idx        on inventory.request_events (actor_id);
create index if not exists request_lines_item_idx          on inventory.request_lines (item_id);
create index if not exists requests_approver_idx           on inventory.requests (approver_id);
create index if not exists requests_fulfiller_idx          on inventory.requests (fulfiller_id);
create index if not exists requests_location_idx           on inventory.requests (location_id);
create index if not exists requests_reviewer_idx           on inventory.requests (reviewer_id);
create index if not exists role_permissions_permission_idx on inventory.role_permissions (permission_key);
create index if not exists stock_levels_location_idx       on inventory.stock_levels (location_id);
create index if not exists stock_movements_created_by_idx  on inventory.stock_movements (created_by);
create index if not exists stock_movements_location_idx    on inventory.stock_movements (location_id);
create index if not exists stock_movements_request_idx     on inventory.stock_movements (request_id);
