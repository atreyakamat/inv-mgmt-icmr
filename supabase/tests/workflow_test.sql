-- End-to-end test of RBAC, MFA gating, RLS and the request workflow.
-- Run with tests/run.sh against a scratch database (uses tests/auth_stub.sql).
\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(p uuid, p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'aal', p_aal, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then
      raise notice 'ok  (blocked) %', left(regexp_replace(p_sql, '\s+', ' ', 'g'), 70);
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

create or replace function pg_temp.role_id(k text) returns bigint language sql as
  $$ select id from inventory.roles where key = k $$;

-- Accounts are provisioned server-side (service role). Simulate that as owner.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@co.test', now()),
  ('00000000-0000-0000-0000-00000000000b', 'super@co.test', now()),
  ('00000000-0000-0000-0000-00000000000c', 'validator@co.test', now()),
  ('00000000-0000-0000-0000-00000000000d', 'store@co.test', now()),
  ('00000000-0000-0000-0000-00000000000e', 'user@co.test', now()),
  ('00000000-0000-0000-0000-00000000000f', 'stranger@co.test', now()),
  ('00000000-0000-0000-0000-000000000010', 'user2@co.test', now());
insert into inventory.profiles (id, email, full_name, role_id) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@co.test', 'Hidden Admin', pg_temp.role_id('admin')),
  ('00000000-0000-0000-0000-00000000000b', 'super@co.test', 'Super', pg_temp.role_id('super_user')),
  ('00000000-0000-0000-0000-00000000000c', 'validator@co.test', 'Val', pg_temp.role_id('validator')),
  ('00000000-0000-0000-0000-00000000000d', 'store@co.test', 'Store Manager', pg_temp.role_id('store_manager')),
  ('00000000-0000-0000-0000-00000000000e', 'user@co.test', 'Normal User', pg_temp.role_id('user')),
  ('00000000-0000-0000-0000-000000000010', 'user2@co.test', 'Second User', pg_temp.role_id('user'));

select pg_temp.check((select count(*) from inventory.audit_log where table_name = 'profiles' and action = 'insert') = 6, 'profile creation audited');

-- Only one super user
select pg_temp.expect_error($$insert into inventory.profiles (id, email, full_name, role_id)
  values ('00000000-0000-0000-0000-00000000000f', 'stranger@co.test', 'X', pg_temp.role_id('super_user'))$$, 'limited to 1');

-- MFA gating: aal1 sees only own profile row
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b', 'aal1');
select pg_temp.check((select count(*) from inventory.profiles) = 1, 'aal1: only own profile visible');
select pg_temp.check((select count(*) from inventory.items) = 0 and (select count(*) from inventory.roles) = 0, 'aal1: nothing else visible');
select pg_temp.check((inventory.me()->>'mfa_verified')::boolean = false and inventory.me()->'role'->>'key' = 'super_user', 'me() works before MFA');
select pg_temp.expect_error($$select inventory.approve_request(1)$$, 'two-factor');
reset role;

-- Stranger (auth user without profile) gets nothing
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.check(inventory.me() is null, 'stranger has no profile');
select pg_temp.check((select count(*) from inventory.profiles) = 0 and (select count(*) from inventory.items) = 0, 'stranger sees nothing');
select pg_temp.expect_error($$select inventory.submit_request(1, 'x', '[{"item_id":1,"quantity":1}]')$$, 'not active');
reset role;

-- Hidden admin: invisible to everyone without users.manage
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.profiles) = 5, 'user sees 5 members (no admin)');
select pg_temp.check((select count(*) from inventory.roles where hidden) = 0, 'user cannot see hidden role');
select pg_temp.check((select count(*) from inventory.roles) = 4, 'user sees 4 roles');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from inventory.profiles where role_id = pg_temp.role_id('admin')) = 0, 'store manager cannot see admin');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from inventory.profiles where role_id = pg_temp.role_id('admin')) = 1, 'super user can see admin');
select pg_temp.check((select count(*) from inventory.roles) = 5, 'super user sees all 5 roles');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((inventory.me()->'permissions') ? 'users.manage' and not (inventory.me()->'permissions') ? 'requests.approve', 'admin permissions as designed');
reset role;

-- Role management guards
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select inventory.update_role(pg_temp.role_id('admin'), 'Admin', null, array['requests.approve'])$$, 'own role');
select pg_temp.expect_error($$select inventory.update_role(pg_temp.role_id('super_user'), 'Super', null, array['requests.approve','catalog.write'])$$, 'fixed set');
select pg_temp.expect_error($$select inventory.delete_role(pg_temp.role_id('user'))$$, 'members');
select pg_temp.expect_error($$select inventory.delete_role(pg_temp.role_id('validator'))$$, 'members');
select pg_temp.expect_error($$insert into inventory.roles (key, name) values ('x', 'X')$$, 'permission denied');
select inventory.create_role('auditor', 'Auditor', 'Read-only finance view', array['audit.read', 'requests.read_all', 'stock.read_history']);
select pg_temp.check((select count(*) from inventory.role_permissions rp join inventory.roles r on r.id = rp.role_id where r.key = 'auditor') = 3, 'admin created a custom role');
select inventory.update_role(pg_temp.role_id('auditor'), 'Auditor', null, array['audit.read']);
select pg_temp.check((select count(*) from inventory.role_permissions rp join inventory.roles r on r.id = rp.role_id where r.key = 'auditor') = 1, 'admin trimmed custom role');
select pg_temp.expect_error($$select inventory.set_member_role('00000000-0000-0000-0000-00000000000a', pg_temp.role_id('super_user'))$$, 'own role');
select inventory.set_member_role('00000000-0000-0000-0000-000000000010', pg_temp.role_id('auditor'));
select pg_temp.check((select count(*) from inventory.audit_log where action = 'set_member_role') = 1, 'role change audited');
select inventory.set_member_role('00000000-0000-0000-0000-000000000010', pg_temp.role_id('user'));
select inventory.delete_role(pg_temp.role_id('auditor'));
select pg_temp.expect_error($$select inventory.delete_role(pg_temp.role_id('user'))$$, 'members');
reset role;

-- Super user manages accounts but can't touch hidden admin or escalate
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$select inventory.set_member_active('00000000-0000-0000-0000-00000000000a', false)$$, 'not found');
select pg_temp.expect_error($$select inventory.set_member_role('00000000-0000-0000-0000-00000000000e', pg_temp.role_id('admin'))$$, 'not found');
select pg_temp.expect_error($$select inventory.set_member_role('00000000-0000-0000-0000-00000000000e', pg_temp.role_id('super_user'))$$, 'limited to 1');
select pg_temp.expect_error($$select inventory.create_role('x', 'X', null, array['audit.read'])$$, 'permission');
reset role;

-- Catalog: only catalog.write writes; no deletes at all
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$insert into inventory.categories (name) values ('Nope')$$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into inventory.categories (name) values ('Nope')$$, 'row-level security');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$insert into inventory.locations (name) values ('Nope')$$, 'row-level security');
select pg_temp.expect_error($$select inventory.receive_stock(1, 1, 5)$$, 'permission');
reset role;
alter table inventory.categories alter column id restart;
alter table inventory.locations alter column id restart;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into inventory.categories (name) values ('Lab consumables');
insert into inventory.locations (name) values ('Main store'), ('Lab 2');
insert into inventory.items (sku, name, category_id, unit, reorder_level)
  select 'GLV-M', 'Nitrile gloves (M)', id, 'box', 5 from inventory.categories where name = 'Lab consumables';
insert into inventory.items (sku, name, category_id, unit, reorder_level)
  select 'PIP-10', 'Pipette tips 10ul', id, 'pack', 2 from inventory.categories where name = 'Lab consumables';
select pg_temp.expect_error($$delete from inventory.items$$, 'permission denied');
update inventory.items set reorder_level = 4 where sku = 'GLV-M';
update inventory.items set reorder_level = 5 where sku = 'GLV-M';
reset role;
select pg_temp.check((select count(*) from inventory.audit_log where table_name = 'items' and action = 'insert') = 2, 'catalog inserts audited');
select pg_temp.check((select new_data->>'reorder_level' from inventory.audit_log where table_name = 'items' and action = 'update' order by id limit 1) = '4', 'catalog update audited with new data');
select pg_temp.check((select actor_id from inventory.audit_log where table_name = 'items' order by id limit 1) = '00000000-0000-0000-0000-00000000000d', 'audit records the actor');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select inventory.receive_stock(1, 1, 10, 'Initial count');
select inventory.receive_stock(2, 1, 3);
select inventory.transfer_stock(1, 1, 2, 2, 'For lab 2');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 1 and location_id = 1) = 8, 'transfer reduces source');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 1 and location_id = 2) = 2, 'transfer adds to destination');
select pg_temp.expect_error($$select inventory.adjust_stock(1, 2, -5, 'lost')$$, 'Not enough stock');
select pg_temp.expect_error($$select inventory.adjust_stock(1, 2, -1, '  ')$$, 'reason');
select pg_temp.expect_error($$update inventory.stock_movements set quantity = 99$$, 'permission denied');
select pg_temp.expect_error($$insert into inventory.stock_levels values (1, 1, 1000)$$, 'permission denied');
select pg_temp.check((select count(*) from inventory.audit_log) = 0, 'store manager cannot read audit log');

-- Whole delivery in one call, including a brand-new catalog item
select pg_temp.check(inventory.receive_delivery(1, 'Invoice 4411 - Goa Scientific',
  jsonb_build_array(
    jsonb_build_object('item_id', 2, 'quantity', 4),
    jsonb_build_object('new_item', jsonb_build_object('name', 'Parafilm roll', 'category_id', 1, 'unit', 'roll', 'reorder_level', 1), 'quantity', 3)
  )) is not null, 'store manager receives a delivery with a new item');
select pg_temp.check((select quantity from inventory.stock_levels sl join inventory.items i on i.id = sl.item_id where i.name = 'Parafilm roll') = 3, 'new item stocked');
select pg_temp.check((select count(distinct batch_id) from inventory.stock_movements where note = 'Invoice 4411 - Goa Scientific') = 1, 'delivery lines share one batch');
select pg_temp.expect_error($$select inventory.receive_delivery(1, 'x', '[{"new_item": {"name": "parafilm ROLL", "category_id": 1}, "quantity": 1}]')$$, 'already in the catalog');
select pg_temp.expect_error($$select inventory.receive_delivery(1, 'x', '[{"item_id": 2, "quantity": 2}, {"item_id": 2, "quantity": 0}]')$$, 'Line 2');
select pg_temp.check((select quantity from inventory.stock_levels where item_id = 2 and location_id = 1) = 7, 'failed delivery saved nothing (tips still 3 + 4)');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select inventory.receive_delivery(1, 'x', '[{"item_id": 2, "quantity": 1}]')$$, 'permission');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
-- put stock back where the rest of the suite expects it
update inventory.items set active = false where name = 'Parafilm roll';
select inventory.adjust_stock(2, 1, -4, 'test reset');
reset role;

-- User sees stock but not movement history
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.stock_levels sl join inventory.items i on i.id = sl.item_id where i.active) = 3, 'user sees stock levels');
select pg_temp.check((select count(*) from inventory.stock_movements) = 0, 'user cannot see movement history');

-- Happy path: submit -> recommend -> approve with modification -> fulfil
select pg_temp.check(inventory.submit_request(1, 'Weekly lab use',
  '[{"item_id":1,"quantity":6},{"item_id":2,"quantity":1}]') = 1, 'user submits request #1');
select pg_temp.expect_error($$select inventory.submit_request(1, 'x', '[{"item_id":1,"quantity":0}]')$$, 'between 1');
select pg_temp.expect_error($$update inventory.requests set status = 'approved'$$, 'permission denied');
select pg_temp.expect_error($$select inventory.approve_request(1)$$, 'permission');
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
select pg_temp.check((select count(*) from inventory.low_stock) = 1 and (select item_name from inventory.low_stock) = 'Pipette tips 10ul', 'low stock judged on totals: only tips (2 <= 2); gloves 4+2 > 5');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select status from inventory.requests where id = 1) = 'fulfilled', 'requester sees fulfilled');
select pg_temp.check((select count(*) from inventory.request_events where request_id = 1) = 4, 'timeline has 4 events');

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

-- Open-request cap
select pg_temp.as_user('00000000-0000-0000-0000-000000000010');
do $$ begin for i in 1..10 loop perform inventory.submit_request(1, 'spam ' || i, '[{"item_id":2,"quantity":1}]'); end loop; end $$;
select pg_temp.expect_error($$select inventory.submit_request(1, 'one more', '[{"item_id":2,"quantity":1}]')$$, '10 open');
reset role;

-- Admin is read-only on operations but sees everything, including the audit log
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from inventory.requests) = 13 and (select count(*) from inventory.stock_movements) > 0, 'admin sees everything');
select pg_temp.check((select count(*) from inventory.audit_log) > 20, 'admin reads audit log');
select pg_temp.expect_error($$select inventory.review_request(3, true)$$, 'permission');
select pg_temp.expect_error($$select inventory.submit_request(1, 'x', '[{"item_id":2,"quantity":1}]')$$, 'permission');
select pg_temp.expect_error($$insert into inventory.audit_log (action) values ('fake')$$, 'permission denied');
reset role;

-- Deactivation cuts access immediately
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select inventory.set_member_active('00000000-0000-0000-0000-00000000000e', false);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.check((select count(*) from inventory.items) = 0, 'deactivated user loses access');
select pg_temp.check((inventory.me()->>'active')::boolean = false, 'deactivated user can still see own status');
reset role;

-- Email sync from auth
update auth.users set email = 'Super.New@co.test' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select email from inventory.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'super.new@co.test', 'profile email follows auth email');

-- The API schema exposes exactly the workflow functions; access-check helpers live elsewhere
select pg_temp.check(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'inventory' and has_function_privilege('authenticated', p.oid, 'execute'))
  = array['adjust_stock','approve_request','cancel_request','create_role','delete_role','fulfill_request',
          'me','receive_delivery','receive_stock','reject_request','review_request','set_member_active',
          'set_member_role','submit_request','transfer_stock','update_my_name','update_role'],
  'API schema exposes only the workflow functions');
select pg_temp.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'inventory' and p.proname in ('current_member','is_member','has_permission','role_is_hidden','my_permissions')),
  'access-check helpers are not in the API schema');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error($$select inventory.has_permission('users.manage')$$, 'does not exist');
reset role;

-- anon has nothing
set role anon;
select pg_temp.expect_error($$select * from inventory.items$$, 'permission denied');
select pg_temp.expect_error($$select inventory.me()$$, 'permission denied');
reset role;

\echo ALL TESTS PASSED
