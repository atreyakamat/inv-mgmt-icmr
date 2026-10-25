-- Inventory management: workflow functions.
-- These are the only way to change requests, stock and membership. Each one
-- checks the caller's role and the current state, then writes an audit trail.
--
-- Request flow
--   user submits ─► validator recommends / not ─► super user approves (may change qty) or rejects
--   ─► store manager hands over (stock issued, fulfilled) or rejects
--   requester may cancel until the super user approves.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create function inventory._require_role(variadic roles inventory.app_role[]) returns inventory.app_role
language plpgsql stable security definer set search_path = '' as $$
declare r inventory.app_role := inventory.my_role();
begin
  if r is null then
    raise exception 'Not an active member' using errcode = '42501';
  end if;
  if not (r = any (roles)) then
    raise exception 'Your role (%) cannot do this', r using errcode = '42501';
  end if;
  return r;
end $$;

create function inventory._clean(t text) returns text
language sql immutable set search_path = '' as $$ select nullif(trim(t), '') $$;

-- Locks the request row and returns it.
create function inventory._lock_request(p_id bigint) returns inventory.requests
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests;
begin
  select * into req from inventory.requests where id = p_id for update;
  if not found then
    raise exception 'Request % not found', p_id using errcode = 'P0002';
  end if;
  return req;
end $$;

create function inventory._log(p_request bigint, p_from inventory.request_status,
                               p_to inventory.request_status, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into inventory.request_events (request_id, actor_id, from_status, to_status, note)
  values (p_request, auth.uid(), p_from, p_to, inventory._clean(p_note));
$$;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

-- Called after sign-in. Turns a matching invite into a profile.
create function inventory.claim_invite() returns inventory.app_role
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  inv inventory.invites;
  existing inventory.app_role;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select role into existing from inventory.profiles where id = auth.uid();
  if found then
    return existing;
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  select * into inv from inventory.invites where email = v_email and accepted_at is null for update;
  if not found then
    return null;
  end if;

  insert into inventory.profiles (id, email, full_name, role)
  values (auth.uid(), v_email, inv.full_name, inv.role);
  update inventory.invites set accepted_at = now() where email = inv.email;
  return inv.role;
end $$;

create function inventory.invite_member(p_email text, p_full_name text, p_role inventory.app_role)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email));
begin
  perform inventory._require_role('super_user');
  if p_role not in ('validator', 'store_manager', 'user') then
    raise exception 'Invites can only be for validator, store manager or user';
  end if;
  if exists (select 1 from inventory.profiles where email = v_email) then
    raise exception 'That person is already a member';
  end if;
  insert into inventory.invites (email, full_name, role, invited_by)
  values (v_email, trim(p_full_name), p_role, auth.uid())
  on conflict (email) do update
    set full_name = excluded.full_name, role = excluded.role,
        invited_by = excluded.invited_by, created_at = now(), accepted_at = null;
end $$;

create function inventory.revoke_invite(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform inventory._require_role('super_user');
  delete from inventory.invites where email = lower(trim(p_email)) and accepted_at is null;
end $$;

-- Super user can change role / deactivate staff, never admin or super user rows.
create function inventory.update_member(p_user_id uuid, p_role inventory.app_role, p_active boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare target inventory.profiles;
begin
  perform inventory._require_role('super_user');
  select * into target from inventory.profiles where id = p_user_id for update;
  if not found or target.role in ('admin', 'super_user') then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if p_role not in ('validator', 'store_manager', 'user') then
    raise exception 'Role must be validator, store manager or user';
  end if;
  update inventory.profiles set role = p_role, active = p_active where id = p_user_id;
end $$;

create function inventory.update_my_name(p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not inventory.is_member() then
    raise exception 'Not an active member' using errcode = '42501';
  end if;
  update inventory.profiles set full_name = trim(p_full_name) where id = auth.uid();
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
  v_id bigint;
  v_count int;
begin
  perform inventory._require_role('user', 'validator', 'store_manager');

  if inventory._clean(p_purpose) is null then
    raise exception 'Purpose is required';
  end if;
  if not exists (select 1 from inventory.locations where id = p_location_id and active) then
    raise exception 'Location not found';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item';
  end if;
  if p_needed_by is not null and p_needed_by < current_date then
    raise exception 'Needed-by date is in the past';
  end if;

  insert into inventory.requests (requester_id, location_id, purpose, needed_by)
  values (auth.uid(), p_location_id, trim(p_purpose), p_needed_by)
  returning id into v_id;

  insert into inventory.request_lines (request_id, item_id, requested_qty)
  select v_id, (l->>'item_id')::bigint, (l->>'quantity')::int
  from jsonb_array_elements(p_lines) l
  join inventory.items i on i.id = (l->>'item_id')::bigint and i.active;

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_lines) then
    raise exception 'One or more items are not available';
  end if;

  perform inventory._log(v_id, null, 'submitted', null);
  return v_id;
end $$;

create function inventory.cancel_request(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests := inventory._lock_request(p_id);
begin
  if req.requester_id is distinct from auth.uid() or not inventory.is_member() then
    raise exception 'Only the requester can cancel' using errcode = '42501';
  end if;
  if req.status not in ('submitted', 'recommended', 'not_recommended') then
    raise exception 'This request can no longer be cancelled';
  end if;
  update inventory.requests set status = 'cancelled', closed_at = now() where id = p_id;
  perform inventory._log(p_id, req.status, 'cancelled', p_note);
end $$;

create function inventory.review_request(p_id bigint, p_recommend boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  req inventory.requests;
  v_to inventory.request_status := case when p_recommend then 'recommended' else 'not_recommended' end;
begin
  perform inventory._require_role('validator');
  req := inventory._lock_request(p_id);
  if req.status <> 'submitted' then
    raise exception 'Only submitted requests can be reviewed';
  end if;
  if req.requester_id = auth.uid() then
    raise exception 'You cannot review your own request' using errcode = '42501';
  end if;
  if not p_recommend and inventory._clean(p_note) is null then
    raise exception 'Add a note explaining why it is not recommended';
  end if;
  update inventory.requests
     set status = v_to, validator_id = auth.uid(), validator_note = inventory._clean(p_note), validated_at = now()
   where id = p_id;
  perform inventory._log(p_id, req.status, v_to, p_note);
end $$;

-- p_lines (optional): [{"line_id": 1, "approved_qty": 2}, ...]; lines left out keep the requested qty.
-- approved_qty 0 drops a line; at least one line must stay above 0.
create function inventory.approve_request(p_id bigint, p_lines jsonb default null, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests;
begin
  perform inventory._require_role('super_user');
  req := inventory._lock_request(p_id);
  if req.status not in ('recommended', 'not_recommended') then
    raise exception 'Only reviewed requests can be approved';
  end if;

  update inventory.request_lines rl set approved_qty = rl.requested_qty where rl.request_id = p_id;

  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then
      raise exception 'Invalid quantities';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_lines) l
      where (l->>'approved_qty')::int < 0
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
     set status = 'approved', approver_id = auth.uid(), approver_note = inventory._clean(p_note), approved_at = now()
   where id = p_id;
  perform inventory._log(p_id, req.status, 'approved', p_note);
end $$;

-- Super user rejects reviewed requests; store manager rejects approved ones.
create function inventory.reject_request(p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r inventory.app_role := inventory._require_role('super_user', 'store_manager');
  req inventory.requests;
begin
  if inventory._clean(p_note) is null then
    raise exception 'Add a note explaining the rejection';
  end if;
  req := inventory._lock_request(p_id);
  if r = 'super_user' and req.status not in ('recommended', 'not_recommended') then
    raise exception 'Only reviewed requests can be rejected here';
  end if;
  if r = 'store_manager' and req.status <> 'approved' then
    raise exception 'Only approved requests can be rejected by the store';
  end if;

  if r = 'super_user' then
    update inventory.requests set status = 'rejected', approver_id = auth.uid(),
           approver_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  else
    update inventory.requests set status = 'rejected', store_manager_id = auth.uid(),
           store_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  end if;
  perform inventory._log(p_id, req.status, 'rejected', p_note);
end $$;

-- Store manager hands items over: issues stock for every approved line, atomically.
create function inventory.fulfill_request(p_id bigint, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare req inventory.requests;
begin
  perform inventory._require_role('store_manager');
  req := inventory._lock_request(p_id);
  if req.status <> 'approved' then
    raise exception 'Only approved requests can be handed over';
  end if;

  insert into inventory.stock_movements (item_id, location_id, kind, quantity, request_id, note, created_by)
  select rl.item_id, req.location_id, 'issue', -rl.approved_qty, p_id,
         'Request #' || p_id, auth.uid()
  from inventory.request_lines rl
  where rl.request_id = p_id and rl.approved_qty > 0
  order by rl.item_id;  -- consistent lock order

  update inventory.requests set status = 'fulfilled', store_manager_id = auth.uid(),
         store_note = inventory._clean(p_note), closed_at = now() where id = p_id;
  perform inventory._log(p_id, req.status, 'fulfilled', p_note);
end $$;

-- ---------------------------------------------------------------------------
-- Stock (store manager)
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
begin
  perform inventory._require_role('store_manager');
  perform inventory._check_item_location(p_item_id, p_location_id);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, note, created_by)
  values (p_item_id, p_location_id, 'receive', p_quantity, inventory._clean(p_note), auth.uid());
end $$;

-- p_delta is signed: -2 for two damaged units, +1 for one found in a count.
create function inventory.adjust_stock(p_item_id bigint, p_location_id bigint, p_delta int, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform inventory._require_role('store_manager');
  perform inventory._check_item_location(p_item_id, p_location_id);
  if p_delta is null or p_delta = 0 then
    raise exception 'Adjustment cannot be 0';
  end if;
  if inventory._clean(p_note) is null then
    raise exception 'Add a reason for the adjustment';
  end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, note, created_by)
  values (p_item_id, p_location_id, 'adjust', p_delta, inventory._clean(p_note), auth.uid());
end $$;

create function inventory.transfer_stock(p_item_id bigint, p_from_location bigint, p_to_location bigint,
                                         p_quantity int, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare g uuid := gen_random_uuid();
begin
  perform inventory._require_role('store_manager');
  perform inventory._check_item_location(p_item_id, p_from_location);
  perform inventory._check_item_location(p_item_id, p_to_location);
  if p_from_location = p_to_location then
    raise exception 'Pick two different locations';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be more than 0';
  end if;
  insert into inventory.stock_movements (item_id, location_id, kind, quantity, transfer_group, note, created_by)
  values (p_item_id, p_from_location, 'transfer_out', -p_quantity, g, inventory._clean(p_note), auth.uid()),
         (p_item_id, p_to_location,   'transfer_in',   p_quantity, g, inventory._clean(p_note), auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Client-callable surface
-- ---------------------------------------------------------------------------
revoke all on function
  inventory._require_role(variadic inventory.app_role[]), inventory._clean(text),
  inventory._lock_request(bigint), inventory._log(bigint, inventory.request_status, inventory.request_status, text),
  inventory._check_item_location(bigint, bigint),
  inventory.touch_updated_at(), inventory.apply_stock_movement(), inventory.forbid_change()
from public, anon, authenticated;

grant execute on function
  inventory.claim_invite(),
  inventory.invite_member(text, text, inventory.app_role),
  inventory.revoke_invite(text),
  inventory.update_member(uuid, inventory.app_role, boolean),
  inventory.update_my_name(text),
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
