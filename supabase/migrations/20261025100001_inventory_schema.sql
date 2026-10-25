-- Inventory management: schema, tables and constraints.
-- Everything lives in its own `inventory` schema so it never collides with
-- other apps sharing this Supabase project, and can be moved out with a
-- single `pg_dump -n inventory`.

create schema if not exists inventory;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type inventory.request_status as enum (
  'submitted',        -- raised by requester, waiting for review
  'recommended',      -- reviewer recommends, waiting for approval
  'not_recommended',  -- reviewer does not recommend; approver still decides
  'approved',         -- approved (possibly with changed quantities), sent to store
  'fulfilled',        -- store handed items over; stock issued
  'rejected',         -- rejected by approver or store
  'cancelled'         -- withdrawn by requester before approval
);

create type inventory.movement_kind as enum (
  'receive',       -- stock added (purchase, donation, return)          +
  'issue',         -- stock handed over against an approved request     -
  'adjust',        -- correction after a count / damage / loss          +/-
  'transfer_out',  -- moved to another location                         -
  'transfer_in'    -- received from another location                    +
);

-- ---------------------------------------------------------------------------
-- RBAC: roles are rows, permissions are fixed capability keys
-- ---------------------------------------------------------------------------
create table inventory.permissions (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null,
  sort_order  int not null default 100
);

insert into inventory.permissions (key, description, sort_order) values
  ('catalog.write',      'Create and edit categories, locations and items',      10),
  ('stock.write',        'Receive, adjust and transfer stock',                   20),
  ('stock.read_history', 'See the stock movement ledger',                        21),
  ('requests.submit',    'Raise item requests',                                  30),
  ('requests.read_all',  'See every request, not only their own',                31),
  ('requests.review',    'Review requests: recommend or not recommend',          32),
  ('requests.approve',   'Approve, modify or reject reviewed requests',          33),
  ('requests.fulfill',   'Hand items over against approved requests',            34),
  ('users.manage',       'Create accounts, assign roles, deactivate members',    40),
  ('roles.manage',       'Create roles and change what they can do',             41),
  ('audit.read',         'Read the full audit log',                              50);

create table inventory.roles (
  id          bigint generated always as identity primary key,
  key         text not null unique check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text not null check (length(trim(name)) between 1 and 60),
  description text,
  -- system roles ship with the app and cannot be deleted
  is_system   boolean not null default false,
  -- locked roles have a fixed permission set (admin, super_user)
  is_locked   boolean not null default false,
  -- hidden roles (and the members holding them) are invisible to anyone
  -- without users.manage
  hidden      boolean not null default false,
  -- at most this many active members may hold the role (null = unlimited)
  max_members int check (max_members is null or max_members > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table inventory.role_permissions (
  role_id        bigint not null references inventory.roles (id) on delete cascade,
  permission_key text not null references inventory.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

insert into inventory.roles (key, name, description, is_system, is_locked, hidden, max_members) values
  ('admin',         'Admin',         'Hidden oversight: manages accounts, roles and the audit log. Never touches stock or requests.', true, true,  true,  null),
  ('super_user',    'Super User',    'Approves, modifies or rejects reviewed requests. Can also manage accounts.',                   true, true,  false, 1),
  ('validator',     'Validator',     'Reviews each request and recommends or does not recommend it.',                               true, false, false, null),
  ('store_manager', 'Store Manager', 'Owns the catalog and stock; hands items over.',                                                true, false, false, null),
  ('user',          'User',          'Views stock and raises requests.',                                                             true, false, false, null);

insert into inventory.role_permissions (role_id, permission_key)
select r.id, p.key from inventory.roles r join inventory.permissions p on
  (r.key = 'admin'         and p.key in ('users.manage', 'roles.manage', 'audit.read', 'requests.read_all', 'stock.read_history')) or
  (r.key = 'super_user'    and p.key in ('requests.approve', 'requests.read_all', 'stock.read_history', 'users.manage')) or
  (r.key = 'validator'     and p.key in ('requests.review', 'requests.read_all', 'requests.submit', 'stock.read_history')) or
  (r.key = 'store_manager' and p.key in ('catalog.write', 'stock.write', 'stock.read_history', 'requests.fulfill', 'requests.read_all', 'requests.submit')) or
  (r.key = 'user'          and p.key in ('requests.submit'));

-- ---------------------------------------------------------------------------
-- People. Rows are created server-side when an account is provisioned;
-- there is no self sign-up path into the inventory system.
-- ---------------------------------------------------------------------------
create table inventory.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  role_id     bigint not null references inventory.roles (id) on delete restrict,
  active      boolean not null default true,
  created_by  uuid references inventory.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_role_idx on inventory.profiles (role_id) where active;

-- ---------------------------------------------------------------------------
-- Catalog (no hard deletes: rows are deactivated so history stays intact)
-- ---------------------------------------------------------------------------
create table inventory.categories (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 80),
  description text,
  active      boolean not null default true,
  created_by  uuid default auth.uid() references inventory.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index categories_name_key on inventory.categories (lower(name));

create table inventory.locations (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 80),
  description text,
  active      boolean not null default true,
  created_by  uuid default auth.uid() references inventory.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index locations_name_key on inventory.locations (lower(name));

create table inventory.items (
  id            bigint generated always as identity primary key,
  sku           text check (sku is null or length(trim(sku)) between 1 and 40),
  name          text not null check (length(trim(name)) between 1 and 120),
  description   text,
  category_id   bigint not null references inventory.categories (id) on delete restrict,
  unit          text not null default 'pcs' check (length(trim(unit)) between 1 and 20),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  active        boolean not null default true,
  created_by    uuid default auth.uid() references inventory.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index items_sku_key on inventory.items (lower(sku)) where sku is not null;
create index items_category_idx on inventory.items (category_id);

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------
create table inventory.requests (
  id               bigint generated always as identity primary key,
  requester_id     uuid not null references inventory.profiles (id) on delete restrict,
  location_id      bigint not null references inventory.locations (id) on delete restrict,
  purpose          text not null check (length(trim(purpose)) between 1 and 1000),
  needed_by        date,
  status           inventory.request_status not null default 'submitted',
  reviewer_id      uuid references inventory.profiles (id) on delete set null,
  reviewer_note    text,
  reviewed_at      timestamptz,
  approver_id      uuid references inventory.profiles (id) on delete set null,
  approver_note    text,
  approved_at      timestamptz,
  fulfiller_id     uuid references inventory.profiles (id) on delete set null,
  fulfiller_note   text,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index requests_status_idx on inventory.requests (status, created_at desc);
create index requests_requester_idx on inventory.requests (requester_id, created_at desc);

create table inventory.request_lines (
  id            bigint generated always as identity primary key,
  request_id    bigint not null references inventory.requests (id) on delete cascade,
  item_id       bigint not null references inventory.items (id) on delete restrict,
  requested_qty integer not null check (requested_qty > 0),
  approved_qty  integer check (approved_qty >= 0),
  unique (request_id, item_id)
);

-- Request timeline shown to the requester. Written only by workflow functions.
create table inventory.request_events (
  id          bigint generated always as identity primary key,
  request_id  bigint not null references inventory.requests (id) on delete cascade,
  actor_id    uuid references inventory.profiles (id) on delete set null,
  from_status inventory.request_status,
  to_status   inventory.request_status not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index request_events_request_idx on inventory.request_events (request_id, created_at);

-- ---------------------------------------------------------------------------
-- Stock: append-only ledger + derived balances
-- ---------------------------------------------------------------------------
create table inventory.stock_movements (
  id             bigint generated always as identity primary key,
  item_id        bigint not null references inventory.items (id) on delete restrict,
  location_id    bigint not null references inventory.locations (id) on delete restrict,
  kind           inventory.movement_kind not null,
  quantity       integer not null check (quantity <> 0),
  request_id     bigint references inventory.requests (id) on delete restrict,
  transfer_group uuid,
  note           text,
  created_by     uuid references inventory.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint movement_sign check (
    (kind in ('receive', 'transfer_in') and quantity > 0) or
    (kind in ('issue', 'transfer_out') and quantity < 0) or
    (kind = 'adjust')
  ),
  constraint issue_has_request check (kind <> 'issue' or request_id is not null)
);
create index stock_movements_item_loc_idx on inventory.stock_movements (item_id, location_id, created_at desc);
create index stock_movements_created_idx on inventory.stock_movements (created_at desc);

create table inventory.stock_levels (
  item_id     bigint not null references inventory.items (id) on delete restrict,
  location_id bigint not null references inventory.locations (id) on delete restrict,
  quantity    integer not null default 0 check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  primary key (item_id, location_id)
);

-- ---------------------------------------------------------------------------
-- Audit log: every change to every table, plus account/role actions.
-- Append-only. Readable only with audit.read.
-- ---------------------------------------------------------------------------
create table inventory.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,                 -- null for server-side (service role) actions
  actor_kind text not null default 'member' check (actor_kind in ('member', 'server', 'system')),
  action     text not null,        -- insert | update | delete | <function name>
  table_name text,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb,
  note       text,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on inventory.audit_log (created_at desc);
create index audit_log_actor_idx on inventory.audit_log (actor_id, created_at desc);
create index audit_log_row_idx on inventory.audit_log (table_name, row_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function inventory.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch   before update on inventory.profiles   for each row execute function inventory.touch_updated_at();
create trigger roles_touch      before update on inventory.roles      for each row execute function inventory.touch_updated_at();
create trigger categories_touch before update on inventory.categories for each row execute function inventory.touch_updated_at();
create trigger locations_touch  before update on inventory.locations  for each row execute function inventory.touch_updated_at();
create trigger items_touch      before update on inventory.items      for each row execute function inventory.touch_updated_at();
create trigger requests_touch   before update on inventory.requests   for each row execute function inventory.touch_updated_at();

-- Generic audit trigger: records who changed what.
create function inventory.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row_id text;
  v_actor uuid := auth.uid();
begin
  v_row_id := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'id') else (to_jsonb(new)->>'id') end,
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'role_id') || ':' || (to_jsonb(old)->>'permission_key')
         else (to_jsonb(new)->>'role_id') || ':' || (to_jsonb(new)->>'permission_key') end);
  insert into inventory.audit_log (actor_id, actor_kind, action, table_name, row_id, old_data, new_data)
  values (v_actor,
          case when v_actor is null then 'server' else 'member' end,
          lower(tg_op), tg_table_name, v_row_id,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger roles_audit            after insert or update or delete on inventory.roles            for each row execute function inventory.audit_row();
create trigger role_permissions_audit after insert or update or delete on inventory.role_permissions for each row execute function inventory.audit_row();
create trigger profiles_audit         after insert or update or delete on inventory.profiles         for each row execute function inventory.audit_row();
create trigger categories_audit       after insert or update or delete on inventory.categories       for each row execute function inventory.audit_row();
create trigger locations_audit        after insert or update or delete on inventory.locations        for each row execute function inventory.audit_row();
create trigger items_audit            after insert or update or delete on inventory.items            for each row execute function inventory.audit_row();
create trigger requests_audit         after insert or update or delete on inventory.requests         for each row execute function inventory.audit_row();
create trigger request_lines_audit    after insert or update or delete on inventory.request_lines    for each row execute function inventory.audit_row();
create trigger stock_movements_audit  after insert on inventory.stock_movements                      for each row execute function inventory.audit_row();

-- Apply each ledger row to the balance. The row lock serialises concurrent
-- movements; the CHECK (quantity >= 0) rejects overdrawing.
create function inventory.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update inventory.stock_levels
     set quantity = quantity + new.quantity, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  if not found then
    insert into inventory.stock_levels (item_id, location_id, quantity)
    values (new.item_id, new.location_id, new.quantity)
    on conflict (item_id, location_id)
    do update set quantity = inventory.stock_levels.quantity + excluded.quantity, updated_at = now();
  end if;
  return new;
exception when check_violation then
  raise exception 'Not enough stock: % at %',
    (select name from inventory.items where id = new.item_id),
    (select name from inventory.locations where id = new.location_id)
    using errcode = 'P0001', hint = 'insufficient_stock';
end $$;

create trigger stock_movements_apply
  after insert on inventory.stock_movements
  for each row execute function inventory.apply_stock_movement();

-- Append-only tables: corrections are new rows.
create function inventory.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger stock_movements_immutable before update or delete on inventory.stock_movements for each row execute function inventory.forbid_change();
create trigger request_events_immutable  before update or delete on inventory.request_events  for each row execute function inventory.forbid_change();
create trigger audit_log_immutable       before update or delete on inventory.audit_log       for each row execute function inventory.forbid_change();

-- Locked roles keep their permission set; system roles cannot be removed or
-- have their flags changed; a hidden role can never be given workflow powers.
create function inventory.guard_roles() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'roles' then
    if tg_op = 'DELETE' then
      if old.is_system then raise exception 'System roles cannot be deleted'; end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and old.is_system and (
         new.key <> old.key or new.is_system <> old.is_system or new.is_locked <> old.is_locked
         or new.hidden <> old.hidden or new.max_members is distinct from old.max_members) then
      raise exception 'System role flags cannot be changed';
    end if;
    if tg_op = 'INSERT' and (new.is_system or new.is_locked or new.hidden) then
      raise exception 'New roles cannot be system, locked or hidden';
    end if;
    return new;
  end if;

  -- role_permissions
  if exists (select 1 from inventory.roles r where r.id = coalesce(new.role_id, old.role_id) and r.is_locked) then
    raise exception 'This role has a fixed set of permissions';
  end if;
  return coalesce(new, old);
end $$;

create trigger roles_guard before insert or update or delete on inventory.roles for each row execute function inventory.guard_roles();
create trigger role_permissions_guard before insert or update or delete on inventory.role_permissions for each row execute function inventory.guard_roles();

-- Enforce max_members (e.g. exactly one super user) under concurrency.
create function inventory.guard_role_capacity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int; v_count int;
begin
  if not new.active then return new; end if;
  if tg_op = 'UPDATE' and old.active and old.role_id = new.role_id then return new; end if;
  select max_members into v_max from inventory.roles where id = new.role_id for update;
  if v_max is null then return new; end if;
  select count(*) into v_count from inventory.profiles
   where role_id = new.role_id and active and id <> new.id;
  if v_count >= v_max then
    raise exception 'That role is limited to % member(s)', v_max;
  end if;
  return new;
end $$;

create trigger profiles_capacity before insert or update of role_id, active on inventory.profiles
  for each row execute function inventory.guard_role_capacity();

-- Keep profiles.email in step with auth.users.
create function inventory.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update inventory.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end $$;

create trigger inventory_sync_profile_email after update of email on auth.users
  for each row execute function inventory.sync_profile_email();

-- ---------------------------------------------------------------------------
-- Read helpers
-- ---------------------------------------------------------------------------
create view inventory.low_stock with (security_invoker = true) as
select sl.item_id, sl.location_id, sl.quantity, i.reorder_level,
       i.name as item_name, i.sku, i.unit, l.name as location_name
from inventory.stock_levels sl
join inventory.items i on i.id = sl.item_id and i.active
join inventory.locations l on l.id = sl.location_id and l.active
where i.reorder_level > 0 and sl.quantity <= i.reorder_level;
