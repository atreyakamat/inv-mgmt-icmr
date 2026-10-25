-- Inventory management: schema, tables and constraints.
-- Everything lives in its own `inventory` schema so it never collides with
-- other apps sharing this Supabase project (and can be moved out later).

create schema if not exists inventory;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type inventory.app_role as enum (
  'admin',          -- hidden, read-only oversight; invisible to everyone except super_user
  'super_user',     -- exactly one; modifies and approves requests
  'validator',      -- reviews requests and recommends / does not recommend
  'store_manager',  -- owns the catalog and stock; hands items over
  'user'            -- views stock and raises requests
);

create type inventory.request_status as enum (
  'submitted',        -- raised by requester, waiting for validator
  'recommended',      -- validator recommends, waiting for super user
  'not_recommended',  -- validator does not recommend, super user still decides
  'approved',         -- super user approved (possibly modified), sent to store
  'fulfilled',        -- store manager handed items over; stock issued
  'rejected',         -- rejected by super user or store manager
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
-- People
-- ---------------------------------------------------------------------------
create table inventory.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  role        inventory.app_role not null default 'user',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Only one super user may exist.
create unique index profiles_single_super_user
  on inventory.profiles (role) where role = 'super_user';

-- People allowed to join. A signed-in auth user claims their invite to get a profile,
-- so sharing auth with other apps never grants inventory access by itself.
create table inventory.invites (
  email       text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  full_name   text not null check (length(trim(full_name)) between 1 and 120),
  role        inventory.app_role not null default 'user'
                check (role in ('validator', 'store_manager', 'user')),
  invited_by  uuid references inventory.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table inventory.categories (
  id          bigint generated always as identity primary key,
  name        text not null check (length(trim(name)) between 1 and 80),
  description text,
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
  validator_id     uuid references inventory.profiles (id) on delete set null,
  validator_note   text,
  validated_at     timestamptz,
  approver_id      uuid references inventory.profiles (id) on delete set null,
  approver_note    text,
  approved_at      timestamptz,
  store_manager_id uuid references inventory.profiles (id) on delete set null,
  store_note       text,
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

-- Who did what to a request, and when. Written only by the workflow functions.
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

-- Current quantity per item per location. Maintained by trigger; can never go negative.
create table inventory.stock_levels (
  item_id     bigint not null references inventory.items (id) on delete restrict,
  location_id bigint not null references inventory.locations (id) on delete restrict,
  quantity    integer not null default 0 check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  primary key (item_id, location_id)
);

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
create trigger categories_touch before update on inventory.categories for each row execute function inventory.touch_updated_at();
create trigger locations_touch  before update on inventory.locations  for each row execute function inventory.touch_updated_at();
create trigger items_touch      before update on inventory.items      for each row execute function inventory.touch_updated_at();
create trigger requests_touch   before update on inventory.requests   for each row execute function inventory.touch_updated_at();

-- Apply each ledger row to the balance. The row lock on stock_levels serialises
-- concurrent movements, and the CHECK (quantity >= 0) rejects overdrawing.
create function inventory.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Update first: an INSERT .. ON CONFLICT would evaluate the CHECK on the
  -- proposed (negative) row before resolving the conflict.
  update inventory.stock_levels
     set quantity = quantity + new.quantity, updated_at = now()
   where item_id = new.item_id and location_id = new.location_id;
  if not found then
    insert into inventory.stock_levels (item_id, location_id, quantity)
    values (new.item_id, new.location_id, new.quantity)
    on conflict (item_id, location_id)  -- concurrent first movement: apply as update
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

-- The ledger is append-only: corrections are new 'adjust' rows.
create function inventory.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;

create trigger stock_movements_immutable
  before update or delete on inventory.stock_movements
  for each row execute function inventory.forbid_change();
create trigger request_events_immutable
  before update or delete on inventory.request_events
  for each row execute function inventory.forbid_change();

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
