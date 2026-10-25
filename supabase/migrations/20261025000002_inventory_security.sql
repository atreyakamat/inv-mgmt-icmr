-- Inventory management: privileges and row level security.
--
-- Access model
--   admin         read-only, sees everything, hidden from everyone but super_user
--   super_user    reads everything, acts on requests via workflow functions, manages invites
--   validator     reads stock + all requests, reviews via workflow functions
--   store_manager writes catalog (categories, locations, items); stock changes via functions
--   user          reads stock, raises and follows own requests
-- Writes to requests, stock and profiles happen ONLY through the security definer
-- functions in the workflow migration, which check role and status.

-- Current member's role, or null when not an active member.
create function inventory.my_role() returns inventory.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from inventory.profiles p where p.id = auth.uid() and p.active
$$;

create function inventory.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select inventory.my_role() is not null
$$;

create function inventory.has_role(variadic roles inventory.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(inventory.my_role() = any (roles), false)
$$;

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; authenticated gets table access gated by RLS
-- ---------------------------------------------------------------------------
revoke all on schema inventory from public, anon;
grant usage on schema inventory to authenticated, service_role;

revoke all on all tables in schema inventory from public, anon, authenticated;
revoke all on all functions in schema inventory from public, anon, authenticated;

grant select on all tables in schema inventory to authenticated;
grant insert, update, delete on inventory.categories, inventory.locations, inventory.items to authenticated;
grant usage on all sequences in schema inventory to authenticated;

grant all on all tables in schema inventory to service_role;
grant all on all sequences in schema inventory to service_role;

grant execute on function inventory.my_role(), inventory.is_member(),
  inventory.has_role(variadic inventory.app_role[]) to authenticated;

alter default privileges in schema inventory revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table inventory.profiles        enable row level security;
alter table inventory.invites         enable row level security;
alter table inventory.categories      enable row level security;
alter table inventory.locations       enable row level security;
alter table inventory.items           enable row level security;
alter table inventory.requests        enable row level security;
alter table inventory.request_lines   enable row level security;
alter table inventory.request_events  enable row level security;
alter table inventory.stock_movements enable row level security;
alter table inventory.stock_levels    enable row level security;

-- Profiles: members see each other, but the admin row is visible only to
-- admin and super_user. No direct writes.
create policy profiles_select on inventory.profiles for select to authenticated
using (
  inventory.is_member() and (
    role <> 'admin'
    or id = auth.uid()
    or inventory.has_role('admin', 'super_user')
  )
);

-- Invites: super user manages them; admin can see them.
create policy invites_select on inventory.invites for select to authenticated
using (inventory.has_role('admin', 'super_user'));

-- Catalog: every member reads; store manager writes.
create policy categories_select on inventory.categories for select to authenticated using (inventory.is_member());
create policy categories_insert on inventory.categories for insert to authenticated with check (inventory.has_role('store_manager'));
create policy categories_update on inventory.categories for update to authenticated using (inventory.has_role('store_manager')) with check (inventory.has_role('store_manager'));
create policy categories_delete on inventory.categories for delete to authenticated using (inventory.has_role('store_manager'));

create policy locations_select on inventory.locations for select to authenticated using (inventory.is_member());
create policy locations_insert on inventory.locations for insert to authenticated with check (inventory.has_role('store_manager'));
create policy locations_update on inventory.locations for update to authenticated using (inventory.has_role('store_manager')) with check (inventory.has_role('store_manager'));
create policy locations_delete on inventory.locations for delete to authenticated using (inventory.has_role('store_manager'));

create policy items_select on inventory.items for select to authenticated using (inventory.is_member());
create policy items_insert on inventory.items for insert to authenticated with check (inventory.has_role('store_manager'));
create policy items_update on inventory.items for update to authenticated using (inventory.has_role('store_manager')) with check (inventory.has_role('store_manager'));
create policy items_delete on inventory.items for delete to authenticated using (inventory.has_role('store_manager'));

-- Stock: every member reads balances; the movement history is for staff roles.
create policy stock_levels_select on inventory.stock_levels for select to authenticated using (inventory.is_member());
create policy stock_movements_select on inventory.stock_movements for select to authenticated
using (inventory.has_role('admin', 'super_user', 'validator', 'store_manager'));

-- Requests: requesters see their own; staff roles see all.
create policy requests_select on inventory.requests for select to authenticated
using (
  inventory.is_member() and (
    requester_id = auth.uid()
    or inventory.has_role('admin', 'super_user', 'validator', 'store_manager')
  )
);

create policy request_lines_select on inventory.request_lines for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));

create policy request_events_select on inventory.request_events for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));
