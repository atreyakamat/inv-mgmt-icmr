-- Inventory management: privileges and row level security.
--
-- Access model
--   * A member is an active profile whose session has passed MFA (aal2).
--     Without MFA the only thing a signed-in user can read is their own profile
--     row, so the app can show "set up your authenticator".
--   * Every capability is a permission key held through the member's role.
--   * Direct table writes are allowed only for the catalog (catalog.write).
--     Requests, stock, accounts and roles change only through the security
--     definer functions in the workflow migration.
--   * Hidden roles and their members are invisible without users.manage.

-- The caller's profile, if they are an active member with an MFA-verified session.
create function inventory.current_member() returns inventory.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from inventory.profiles p
  where p.id = auth.uid() and p.active
    and (auth.jwt()->>'aal') = 'aal2'
$$;

create function inventory.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select (inventory.current_member()).id is not null
$$;

create function inventory.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from inventory.profiles p
    join inventory.role_permissions rp on rp.role_id = p.role_id
    where p.id = auth.uid() and p.active
      and (auth.jwt()->>'aal') = 'aal2'
      and rp.permission_key = p_key
  )
$$;

-- RLS-independent lookup (policies that reference roles would otherwise be
-- filtered by the roles policy itself).
create function inventory.role_is_hidden(p_role_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select hidden from inventory.roles where id = p_role_id), false)
$$;

-- All permissions of the caller, for the UI.
create function inventory.my_permissions() returns setof text
language sql stable security definer set search_path = '' as $$
  select rp.permission_key from inventory.profiles p
  join inventory.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid() and p.active and (auth.jwt()->>'aal') = 'aal2'
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on schema inventory from public, anon;
grant usage on schema inventory to authenticated, service_role;

revoke all on all tables in schema inventory from public, anon, authenticated;
revoke all on all functions in schema inventory from public, anon, authenticated;

grant select on all tables in schema inventory to authenticated;
grant insert, update on inventory.categories, inventory.locations, inventory.items to authenticated;
grant usage on all sequences in schema inventory to authenticated;

grant all on all tables in schema inventory to service_role;
grant all on all sequences in schema inventory to service_role;

grant execute on function inventory.current_member(), inventory.is_member(),
  inventory.has_permission(text), inventory.my_permissions(), inventory.role_is_hidden(bigint) to authenticated;

alter default privileges in schema inventory revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table inventory.permissions      enable row level security;
alter table inventory.roles            enable row level security;
alter table inventory.role_permissions enable row level security;
alter table inventory.profiles         enable row level security;
alter table inventory.categories       enable row level security;
alter table inventory.locations        enable row level security;
alter table inventory.items            enable row level security;
alter table inventory.requests         enable row level security;
alter table inventory.request_lines    enable row level security;
alter table inventory.request_events   enable row level security;
alter table inventory.stock_movements  enable row level security;
alter table inventory.stock_levels     enable row level security;
alter table inventory.audit_log        enable row level security;

-- RBAC tables: members read; hidden roles only with users.manage.
create policy permissions_select on inventory.permissions for select to authenticated
using (inventory.is_member());

create policy roles_select on inventory.roles for select to authenticated
using (inventory.is_member() and (not hidden or inventory.has_permission('users.manage')
       or id = (inventory.current_member()).role_id));

create policy role_permissions_select on inventory.role_permissions for select to authenticated
using (exists (select 1 from inventory.roles r where r.id = role_id));

-- Profiles: own row is always readable (even before MFA, so the app can
-- onboard); other members readable once a member, except hidden-role holders.
create policy profiles_select on inventory.profiles for select to authenticated
using (
  id = auth.uid()
  or (
    inventory.is_member() and (
      inventory.has_permission('users.manage')
      or not inventory.role_is_hidden(role_id)
    )
  )
);

-- Catalog: members read; catalog.write inserts and updates. No deletes.
create policy categories_select on inventory.categories for select to authenticated using (inventory.is_member());
create policy categories_insert on inventory.categories for insert to authenticated with check (inventory.has_permission('catalog.write'));
create policy categories_update on inventory.categories for update to authenticated using (inventory.has_permission('catalog.write')) with check (inventory.has_permission('catalog.write'));

create policy locations_select on inventory.locations for select to authenticated using (inventory.is_member());
create policy locations_insert on inventory.locations for insert to authenticated with check (inventory.has_permission('catalog.write'));
create policy locations_update on inventory.locations for update to authenticated using (inventory.has_permission('catalog.write')) with check (inventory.has_permission('catalog.write'));

create policy items_select on inventory.items for select to authenticated using (inventory.is_member());
create policy items_insert on inventory.items for insert to authenticated with check (inventory.has_permission('catalog.write'));
create policy items_update on inventory.items for update to authenticated using (inventory.has_permission('catalog.write')) with check (inventory.has_permission('catalog.write'));

-- Stock
create policy stock_levels_select on inventory.stock_levels for select to authenticated using (inventory.is_member());
create policy stock_movements_select on inventory.stock_movements for select to authenticated
using (inventory.has_permission('stock.read_history'));

-- Requests: own, or all with requests.read_all.
create policy requests_select on inventory.requests for select to authenticated
using (inventory.is_member() and (requester_id = auth.uid() or inventory.has_permission('requests.read_all')));

create policy request_lines_select on inventory.request_lines for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));

create policy request_events_select on inventory.request_events for select to authenticated
using (exists (select 1 from inventory.requests r where r.id = request_id));

-- Audit
create policy audit_log_select on inventory.audit_log for select to authenticated
using (inventory.has_permission('audit.read'));
