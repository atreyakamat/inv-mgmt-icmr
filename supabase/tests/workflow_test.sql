-- End-to-end test of roles, RLS and the request workflow.
-- Runs against a scratch database with a minimal auth stub (see tests/auth_stub.sql).
-- Every step runs as the `authenticated` role with a simulated JWT subject.
\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then
      raise notice 'ok  (blocked) %', left(p_sql, 70);
      return;
    end if;
    raise exception 'wrong error for [%]: %', p_sql, sqlerrm;
  end;
  raise exception 'expected error "%" but succeeded: %', p_like, p_sql;
end $$;

create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok  %', label;
end $$;

-- Seed people (as owner). Admin and super user are bootstrapped by the owner.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@co.test'),
  ('00000000-0000-0000-0000-00000000000b', 'super@co.test'),
  ('00000000-0000-0000-0000-00000000000c', 'validator@co.test'),
  ('00000000-0000-0000-0000-00000000000d', 'store@co.test'),
  ('00000000-0000-0000-0000-00000000000e', 'user@co.test'),
  ('00000000-0000-0000-0000-00000000000f', 'stranger@co.test');
insert into inventory.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@co.test', 'Hidden Admin', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'super@co.test', 'Super', 'super_user');

-- Only one super user
select pg_temp.expect_error($$insert into inventory.profiles (id, email, full_name, role)
  values ('00000000-0000-0000-0000-00000000000f', 'stranger@co.test', 'X', 'super_user')$$, 'duplicate key');

-- Super user invites staff
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select inventory.invite_member('Validator@co.test', 'Val', 'validator');
select inventory.invite_member('store@co.test', 'Store Manager', 'store_manager');
select inventory.invite_member('user@co.test', 'Normal User', 'user');
select pg_temp.expect_error($$select inventory.invite_member('x@co.test', 'X', 'admin')$$, 'can only be');
reset role;

-- Invited people claim; the stranger gets nothing
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); select pg_temp.check(inventory.claim_invite() = 'validator', 'validator claims invite'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); select pg_temp.check(inventory.claim_invite() = 'store_manager', 'store manager claims invite'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e'); select pg_temp.check(inventory.claim_invite() = 'user', 'user claims invite'); reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.check(inventory.claim_invite() is null, 'uninvited auth user gets no role');
select pg_temp.check((select count(*) from inventory.items) = 0 and (select count(*) from inventory.profiles) = 0, 'stranger sees nothing');
select pg_temp.expect_error($$select inventory.submit_request(1, 'x', '[{"item_id":1,"quantity":1}]')$$, 'Not an active member');
reset role;

-- Hidden admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.profiles where role = 'admin') = 0, 'user cannot see admin');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from inventory.profiles where role = 'admin') = 0, 'store manager cannot see admin');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from inventory.profiles where role = 'admin') = 1, 'super user can see admin');
reset role;

-- Catalog: only the store manager writes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$insert into inventory.categories (name) values ('Nope')$$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into inventory.categories (name) values ('Nope')$$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$insert into inventory.locations (name) values ('Nope')$$, 'row-level security');
select pg_temp.expect_error($$select inventory.receive_stock(1, 1, 5)$$, 'cannot do this');
reset role;
-- Blocked inserts still consume identity values; restart so the ids below are predictable.
alter table inventory.categories alter column id restart;
alter table inventory.locations alter column id restart;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into inventory.categories (name) values ('Lab consumables');
insert into inventory.locations (name) values ('Main store'), ('Lab 2');
insert into inventory.items (sku, name, category_id, unit, reorder_level)
  select 'GLV-M', 'Nitrile gloves (M)', id, 'box', 5 from inventory.categories where name = 'Lab consumables';
insert into inventory.items (sku, name, category_id, unit, reorder_level)
  select 'PIP-10', 'Pipette tips 10ul', id, 'pack', 2 from inventory.categories where name = 'Lab consumables';
select inventory.receive_stock(1, 1, 10, 'Initial count');
select inventory.receive_stock(2, 1, 3);
select inventory.transfer_stock(1, 1, 2, 2, 'For lab 2');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 1 and location_id = 1) = 8, 'transfer reduces source');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 1 and location_id = 2) = 2, 'transfer adds to destination');
select pg_temp.expect_error($$select inventory.adjust_stock(1, 2, -5, 'lost')$$, 'Not enough stock');
select pg_temp.expect_error($$select inventory.adjust_stock(1, 2, -1, '  ')$$, 'reason');
select pg_temp.expect_error($$update inventory.stock_movements set quantity = 99$$, 'permission denied');
select pg_temp.expect_error($$insert into inventory.stock_levels values (1, 1, 1000)$$, 'permission denied');
reset role;

-- User sees stock but not movement history
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.stock_levels) = 3, 'user sees stock levels');
select pg_temp.check((select count(*) from inventory.stock_movements) = 0, 'user cannot see movement history');

-- Happy path: submit -> recommend -> approve with modification -> fulfil
select pg_temp.check(inventory.submit_request(1, 'Weekly lab use',
  '[{"item_id":1,"quantity":6},{"item_id":2,"quantity":1}]') = 1, 'user submits request #1');
select pg_temp.expect_error($$update inventory.requests set status = 'approved'$$, 'permission denied');
select pg_temp.expect_error($$select inventory.approve_request(1)$$, 'cannot do this');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select inventory.approve_request(1)$$, 'Only reviewed');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from inventory.requests) = 1, 'validator sees all requests');
select inventory.review_request(1, true, 'Looks fine');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select inventory.fulfill_request(1)$$, 'Only approved');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select inventory.approve_request(1,
  (select jsonb_agg(jsonb_build_object('line_id', id, 'approved_qty', case when item_id = 1 then 4 else requested_qty end))
     from inventory.request_lines where request_id = 1),
  'Reduced gloves to 4');
select pg_temp.check((select approved_qty from inventory.request_lines where request_id = 1 and item_id = 1) = 4, 'super user modified qty');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select inventory.cancel_request(1)$$, 'no longer be cancelled');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select inventory.fulfill_request(1, 'Handed over at counter');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 1 and location_id = 1) = 4, 'issue reduced gloves 8 -> 4');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 2 and location_id = 1) = 2, 'issue reduced tips 3 -> 2');
select pg_temp.check((select count(*) from inventory.low_stock) = 3, 'low stock: gloves at both locations + tips');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select status from inventory.requests where id = 1) = 'fulfilled', 'requester sees fulfilled');
select pg_temp.check((select count(*) from inventory.request_events where request_id = 1) = 4, 'audit trail has 4 events');

-- Not-recommended still goes to super user; store can reject; insufficient stock blocks hand-over
select inventory.submit_request(1, 'Big order', '[{"item_id":1,"quantity":50}]');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($$select inventory.review_request(2, false)$$, 'note');
select inventory.review_request(2, false, 'Too many');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select inventory.approve_request(2);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select inventory.fulfill_request(2)$$, 'Not enough stock');
select pg_temp.check((select status from inventory.requests where id = 2) = 'approved', 'failed hand-over left request approved');
select inventory.reject_request(2, 'Not enough stock, reorder placed');
reset role;

-- Validator cannot review own request; requester can cancel early; users only see own
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select inventory.submit_request(2, 'Validator needs tips', '[{"item_id":2,"quantity":1}]');
select pg_temp.expect_error($$select inventory.review_request(3, true)$$, 'own request');
select inventory.cancel_request(3, 'Not needed');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.requests) = 2, 'user sees only own requests');
reset role;

-- Admin is read-only but sees everything
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from inventory.requests) = 3 and (select count(*) from inventory.stock_movements) > 0, 'admin sees everything');
select pg_temp.expect_error($$select inventory.review_request(3, true)$$, 'cannot do this');
reset role;

-- Super user can deactivate staff but not touch admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select inventory.update_member('00000000-0000-0000-0000-00000000000a', 'user', false)$$, 'not found');
select inventory.update_member('00000000-0000-0000-0000-00000000000e', 'user', false);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.items) = 0, 'deactivated user loses access');
reset role;

-- anon has nothing
set role anon;
select pg_temp.expect_error($$select * from inventory.items$$, 'permission denied');
reset role;

\echo ALL TESTS PASSED
