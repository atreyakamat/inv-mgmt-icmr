-- Inventory management: workflow functions.
-- The only way to change requests, stock, accounts and roles. Each function
-- checks a permission (which implies active member + MFA), validates state,
-- and writes the audit trail.
--
-- Request flow
--   submit ─► review (recommend / not) ─► approve (may change qty) or reject
--   ─► fulfil (stock issued) or reject by store.   Requester may cancel until approved.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create function inventory._require(p_key text) returns inventory.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me inventory.profiles := inventory.current_member();
begin
  if me.id is null then
    if auth.uid() is null then
      raise exception 'Not signed in' using errcode = '42501';
    end if;
    raise exception 'Your account is not active or has not completed two-factor sign-in'
      using errcode = '42501', hint = 'not_member';
  end if;
  if not inventory.has_permission(p_key) then
    raise exception 'You do not have permission to do this'
      using errcode = '42501', hint = 'missing:' || p_key;
  end if;
  return me;
end $$;

create function inventory._clean(t text) returns text
language sql immutable set search_path = '' as $$ select nullif(trim(t), '') $$;

create function inventory._lock_request(p_id bigint) returns inventory.requests
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests;
begin
  select * into req from inventory.requests where id = p_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  return req;
end $$;

create function inventory._event(p_request bigint, p_from inventory.request_status,
                                 p_to inventory.request_status, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into inventory.request_events (request_id, actor_id, from_status, to_status, note)
  values (p_request, auth.uid(), p_from, p_to, inventory._clean(p_note));
$$;

create function inventory._audit(p_action text, p_table text, p_row text, p_note text default null,
                                 p_new jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into inventory.audit_log (actor_id, actor_kind, action, table_name, row_id, note, new_data)
  values (auth.uid(), case when auth.uid() is null then 'server' else 'member' end,
          p_action, p_table, p_row, inventory._clean(p_note), p_new);
$$;

-- ---------------------------------------------------------------------------
-- Accounts (the auth user itself is created server-side with the service key;
-- the server then inserts the profile row. These functions cover everything
-- a member can do from the app.)
-- ---------------------------------------------------------------------------

-- Who am I: profile + role + permissions, in one call for the app shell.
create function inventory.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'active', p.active,
    'role', jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'hidden', r.hidden),
    'mfa_verified', (auth.jwt()->>'aal') = 'aal2',
    'permissions', coalesce((select jsonb_agg(permission_key order by permission_key)
                             from inventory.role_permissions where role_id = p.role_id), '[]'::jsonb)
  )
  from inventory.profiles p join inventory.roles r on r.id = p.role_id
  where p.id = auth.uid()
$$;

create function inventory.update_my_name(p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not inventory.is_member() then
    raise exception 'Not an active member' using errcode = '42501';
  end if;
  if inventory._clean(p_full_name) is null then raise exception 'Name is required'; end if;
  update inventory.profiles set full_name = trim(p_full_name) where id = auth.uid();
end $$;

-- Change a member's role. Nobody can change their own role; hidden roles can
-- only be assigned by someone who already holds one.
create function inventory.set_member_role(p_user_id uuid, p_role_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('users.manage');
  target inventory.profiles;
  new_role inventory.roles;
begin
  if p_user_id = me.id then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;
  select * into target from inventory.profiles where id = p_user_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  select * into new_role from inventory.roles where id = p_role_id;
  if not found then raise exception 'Role not found' using errcode = 'P0002'; end if;

  if (new_role.hidden or inventory.role_is_hidden(target.role_id))
     and not inventory.role_is_hidden(me.role_id) then
    raise exception 'Member not found' using errcode = 'P0002';  -- hidden roles stay hidden
  end if;

  update inventory.profiles set role_id = p_role_id where id = p_user_id;
  perform inventory._audit('set_member_role', 'profiles', p_user_id::text, null,
                           jsonb_build_object('from_role', target.role_id, 'to_role', p_role_id));
end $$;

-- Deactivate / reactivate. The server also bans the auth user so open
-- sessions die immediately.
create function inventory.set_member_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('users.manage');
  target inventory.profiles;
begin
  if p_user_id = me.id then
    raise exception 'You cannot deactivate yourself' using errcode = '42501';
  end if;
  select * into target from inventory.profiles where id = p_user_id for update;
  if not found or (inventory.role_is_hidden(target.role_id) and not inventory.role_is_hidden(me.role_id)) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  update inventory.profiles set active = p_active where id = p_user_id;
  perform inventory._audit(case when p_active then 'activate_member' else 'deactivate_member' end,
                           'profiles', p_user_id::text);
end $$;

-- ---------------------------------------------------------------------------
-- Roles (roles.manage). System role flags and locked permission sets are
-- protected by triggers, so even this permission cannot alter admin/super user.
-- ---------------------------------------------------------------------------
create function inventory.create_role(p_key text, p_name text, p_description text,
                                      p_permissions text[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  perform inventory._require('roles.manage');
  insert into inventory.roles (key, name, description)
  values (lower(trim(p_key)), trim(p_name), inventory._clean(p_description))
  returning id into v_id;
  insert into inventory.role_permissions (role_id, permission_key)
  select v_id, unnest(p_permissions);
  perform inventory._audit('create_role', 'roles', v_id::text, null, to_jsonb(p_permissions));
  return v_id;
end $$;

create function inventory.update_role(p_role_id bigint, p_name text, p_description text,
                                      p_permissions text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare me inventory.profiles := inventory._require('roles.manage');
begin
  if not exists (select 1 from inventory.roles where id = p_role_id) then
    raise exception 'Role not found' using errcode = 'P0002';
  end if;
  if p_role_id = me.role_id then
    raise exception 'You cannot change the permissions of your own role' using errcode = '42501';
  end if;
  update inventory.roles set name = trim(p_name), description = inventory._clean(p_description)
   where id = p_role_id;
  delete from inventory.role_permissions where role_id = p_role_id
     and not (permission_key = any (p_permissions));
  insert into inventory.role_permissions (role_id, permission_key)
  select p_role_id, unnest(p_permissions)
  on conflict do nothing;
  perform inventory._audit('update_role', 'roles', p_role_id::text, null, to_jsonb(p_permissions));
end $$;

create function inventory.delete_role(p_role_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform inventory._require('roles.manage');
  if exists (select 1 from inventory.profiles where role_id = p_role_id) then
    raise exception 'Move its members to another role first';
  end if;
  delete from inventory.roles where id = p_role_id;  -- trigger blocks system roles
  perform inventory._audit('delete_role', 'roles', p_role_id::text);
end $$;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------

-- p_lines: [{"item_id": 1, "quantity": 3}, ...]
create function inventory.submit_request(p_location_id bigint, p_purpose text,
                                         p_lines jsonb, p_needed_by date default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('requests.submit');
  v_id bigint;
  v_count int;
begin
  if inventory._clean(p_purpose) is null then raise exception 'Purpose is required'; end if;
  if not exists (select 1 from inventory.locations where id = p_location_id and active) then
    raise exception 'Location not found';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item';
  end if;
  if jsonb_array_length(p_lines) > 50 then raise exception 'At most 50 items per request'; end if;
  if p_needed_by is not null and p_needed_by < current_date then
    raise exception 'Needed-by date is in the past';
  end if;
  if (select count(*) from inventory.requests
       where requester_id = me.id and status in ('submitted', 'recommended', 'not_recommended', 'approved')) >= 10 then
    raise exception 'You already have 10 open requests';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where coalesce((l->>'quantity')::int, 0) <= 0 or (l->>'quantity')::int > 100000) then
    raise exception 'Quantities must be between 1 and 100000';
  end if;

  insert into inventory.requests (requester_id, location_id, purpose, needed_by)
  values (me.id, p_location_id, trim(p_purpose), p_needed_by)
  returning id into v_id;

  insert into inventory.request_lines (request_id, item_id, requested_qty)
  select v_id, (l->>'item_id')::bigint, sum((l->>'quantity')::int)
  from jsonb_array_elements(p_lines) l
  join inventory.items i on i.id = (l->>'item_id')::bigint and i.active
  group by (l->>'item_id')::bigint;

  get diagnostics v_count = row_count;
  if v_count <> (select count(distinct l->>'item_id') from jsonb_array_elements(p_lines) l) then
    raise exception 'One or more items are not available';
  end if;

  perform inventory._event(v_id, null, 'submitted', null);
  return v_id;
end $$;

create function inventory.cancel_request(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests := inventory._lock_request(p_id);
begin
  if not inventory.is_member() or req.requester_id is distinct from auth.uid() then
    raise exception 'Only the requester can cancel' using errcode = '42501';
  end if;
  if req.status not in ('submitted', 'recommended', 'not_recommended') then
    raise exception 'This request can no longer be cancelled';
  end if;
  update inventory.requests set status = 'cancelled', closed_at = now() where id = p_id;
  perform inventory._event(p_id, req.status, 'cancelled', p_note);
end $$;

create function inventory.review_request(p_id bigint, p_recommend boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('requests.review');
  req inventory.requests := inventory._lock_request(p_id);
  v_to inventory.request_status := case when p_recommend then 'recommended' else 'not_recommended' end;
begin
  if req.status <> 'submitted' then raise exception 'Only submitted requests can be reviewed'; end if;
  if req.requester_id = me.id then
    raise exception 'You cannot review your own request' using errcode = '42501';
  end if;
  if not p_recommend and inventory._clean(p_note) is null then
    raise exception 'Add a note explaining why it is not recommended';
  end if;
  update inventory.requests
     set status = v_to, reviewer_id = me.id, reviewer_note = inventory._clean(p_note), reviewed_at = now()
   where id = p_id;
  perform inventory._event(p_id, req.status, v_to, p_note);
end $$;

-- p_lines (optional): [{"line_id": 1, "approved_qty": 2}, ...]; lines left out
-- keep the requested qty. approved_qty 0 drops a line; at least one must remain.
create function inventory.approve_request(p_id bigint, p_lines jsonb default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('requests.approve');
  req inventory.requests := inventory._lock_request(p_id);
begin
  if req.status not in ('recommended', 'not_recommended') then
    raise exception 'Only reviewed requests can be approved';
  end if;
  if req.requester_id = me.id then
    raise exception 'You cannot approve your own request' using errcode = '42501';
  end if;

  update inventory.request_lines rl set approved_qty = rl.requested_qty where rl.request_id = p_id;

  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then raise exception 'Invalid quantities'; end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) l
      where coalesce((l->>'approved_qty')::int, -1) < 0
         or not exists (select 1 from inventory.request_lines rl
                        where rl.id = (l->>'line_id')::bigint and rl.request_id = p_id)
    ) then
      raise exception 'Invalid quantities';
    end if;
    update inventory.request_lines rl
       set approved_qty = (l->>'approved_qty')::int
      from jsonb_array_elements(p_lines) l
     where rl.id = (l->>'line_id')::bigint and rl.request_id = p_id;
  end if;

  if not exists (select 1 from inventory.request_lines where request_id = p_id and approved_qty > 0) then
    raise exception 'Approve at least one item, or reject the request instead';
  end if;

  update inventory.requests
     set status = 'approved', approver_id = me.id, approver_note = inventory._clean(p_note), approved_at = now()
   where id = p_id;
  perform inventory._event(p_id, req.status, 'approved', p_note);
end $$;

-- Approvers reject reviewed requests; fulfillers reject approved ones.
create function inventory.reject_request(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory.current_member();
  req inventory.requests;
begin
  if me.id is null then raise exception 'Not an active member' using errcode = '42501'; end if;
  if inventory._clean(p_note) is null then raise exception 'Add a note explaining the rejection'; end if;
  req := inventory._lock_request(p_id);

  if req.status in ('recommended', 'not_recommended') then
    perform inventory._require('requests.approve');
    update inventory.requests set status = 'rejected', approver_id = me.id,
           approver_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  elsif req.status = 'approved' then
    perform inventory._require('requests.fulfill');
    update inventory.requests set status = 'rejected', fulfiller_id = me.id,
           fulfiller_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  else
    raise exception 'This request cannot be rejected in its current state';
  end if;
  perform inventory._event(p_id, req.status, 'rejected', p_note);
end $$;

-- Hand items over: issues stock for every approved line, atomically.
create function inventory.fulfill_request(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('requests.fulfill');
  req inventory.requests := inventory._lock_request(p_id);
begin
  if req.status <> 'approved' then raise exception 'Only approved requests can be handed over'; end if;

  insert into inventory.stock_movements (item_id, location_id, kind, quantity, request_id, note, created_by)
  select rl.item_id, req.location_id, 'issue', -rl.approved_qty, p_id, 'Request #' || p_id, me.id
  from inventory.request_lines rl
  where rl.request_id = p_id and rl.approved_qty > 0
  order by rl.item_id;  -- consistent lock order

  update inventory.requests set status = 'fulfilled', fulfiller_id = me.id,
         fulfiller_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  perform inventory._event(p_id, req.status, 'fulfilled', p_note);
end $$;

-- ---------------------------------------------------------------------------
-- Stock (stock.write)
-- ---------------------------------------------------------------------------
create function inventory._check_item_location(p_item bigint, p_location bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from inventory.items where id = p_item and active) then
    raise exception 'Item not found or inactive';
  end if;
  if not exists (select 1 from inventory.locations where id = p_location and active) then
    raise exception 'Location not found or inactive';
  end if;
end $$;

create function inventory.receive_stock(p_item_id bigint, p_location_id bigint, p_quantity int, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare me inventory.profiles := inventory._require('stock.write');
begin
  perform inventory._check_item_location(p_item_id, p_location_id);
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Quantity must be between 1 and 1000000';
  end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, note, created_by)
  values (p_item_id, p_location_id, 'receive', p_quantity, inventory._clean(p_note), me.id);
end $$;

-- p_delta is signed: -2 for two damaged units, +1 for one found in a count.
create function inventory.adjust_stock(p_item_id bigint, p_location_id bigint, p_delta int, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare me inventory.profiles := inventory._require('stock.write');
begin
  perform inventory._check_item_location(p_item_id, p_location_id);
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'Invalid adjustment'; end if;
  if inventory._clean(p_note) is null then raise exception 'Add a reason for the adjustment'; end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, note, created_by)
  values (p_item_id, p_location_id, 'adjust', p_delta, inventory._clean(p_note), me.id);
end $$;

create function inventory.transfer_stock(p_item_id bigint, p_from_location bigint, p_to_location bigint,
                                         p_quantity int, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me inventory.profiles := inventory._require('stock.write');
  g uuid := gen_random_uuid();
begin
  perform inventory._check_item_location(p_item_id, p_from_location);
  perform inventory._check_item_location(p_item_id, p_to_location);
  if p_from_location = p_to_location then raise exception 'Pick two different locations'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    raise exception 'Quantity must be between 1 and 1000000';
  end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, transfer_group, note, created_by)
  values (p_item_id, p_from_location, 'transfer_out', -p_quantity, g, inventory._clean(p_note), me.id),
         (p_item_id, p_to_location,   'transfer_in',   p_quantity, g, inventory._clean(p_note), me.id);
end $$;

-- ---------------------------------------------------------------------------
-- Client-callable surface
-- ---------------------------------------------------------------------------
revoke all on function
  inventory._require(text), inventory._clean(text), inventory._lock_request(bigint),
  inventory._event(bigint, inventory.request_status, inventory.request_status, text),
  inventory._audit(text, text, text, text, jsonb), inventory._check_item_location(bigint, bigint),
  inventory.touch_updated_at(), inventory.audit_row(), inventory.apply_stock_movement(),
  inventory.forbid_change(), inventory.guard_roles(), inventory.guard_role_capacity(),
  inventory.sync_profile_email()
from public, anon, authenticated;

grant execute on function
  inventory.me(),
  inventory.update_my_name(text),
  inventory.set_member_role(uuid, bigint),
  inventory.set_member_active(uuid, boolean),
  inventory.create_role(text, text, text, text[]),
  inventory.update_role(bigint, text, text, text[]),
  inventory.delete_role(bigint),
  inventory.submit_request(bigint, text, jsonb, date),
  inventory.cancel_request(bigint, text),
  inventory.review_request(bigint, boolean, text),
  inventory.approve_request(bigint, jsonb, text),
  inventory.reject_request(bigint, text),
  inventory.fulfill_request(bigint, text),
  inventory.receive_stock(bigint, bigint, int, text),
  inventory.adjust_stock(bigint, bigint, int, text),
  inventory.transfer_stock(bigint, bigint, bigint, int, text)
to authenticated;

revoke execute on all functions in schema inventory from anon;
