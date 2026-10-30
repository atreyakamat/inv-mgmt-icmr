-- Audit log you can trust, sign-in history, a privacy-safe member directory,
-- and per-member guide progress.
--
-- 1. Super User can read the audit log (Admin already could).
-- 2. Every audit entry says how the change was made: in the app by a member,
--    by the server on a member's behalf, or directly in the database
--    (SQL Editor or psql), with the database login.
-- 3. The log is sealed: each entry carries a SHA-256 hash of its content and
--    of the entry before it. Editing, deleting or re-ordering any entry breaks
--    the chain, and inventory.verify_audit_log() reports where.
-- 4. Sign-ins, sign-outs, failed authenticator codes and password changes are
--    recorded in the same sealed log.
-- 5. inventory.directory(): names and roles of members for everyday screens.
--    Holders of a hidden role appear with the ordinary "User" role to anyone
--    who cannot manage accounts.
-- 6. Guide progress per member (no audit noise).
--
-- Run after 20261026100007, as one script.

-- ---------------------------------------------------------------------------
-- 1. Super User reads the audit log
-- ---------------------------------------------------------------------------
alter table inventory.role_permissions disable trigger role_permissions_guard;
insert into inventory.role_permissions (role_id, permission_key)
select id, 'audit.read' from inventory.roles where key = 'super_user'
on conflict do nothing;
alter table inventory.role_permissions enable trigger role_permissions_guard;

update inventory.permissions set description = 'Read the full audit log and sign-in history'
where key = 'audit.read';

-- ---------------------------------------------------------------------------
-- 2 + 3. Attribution and seal
-- ---------------------------------------------------------------------------
alter table inventory.audit_log drop constraint if exists audit_log_actor_kind_check;
alter table inventory.audit_log add constraint audit_log_actor_kind_check
  check (actor_kind in ('member', 'server', 'system', 'database'));

alter table inventory.audit_log
  add column if not exists db_user   text,
  add column if not exists seq       bigint,
  add column if not exists prev_hash bytea,
  add column if not exists hash      bytea;

-- One row: the latest sequence number and hash. Updating it serialises
-- writers, so the chain never forks.
create table if not exists inventory_private.audit_head (
  id   int primary key default 1 check (id = 1),
  seq  bigint not null,
  hash bytea not null
);
revoke all on inventory_private.audit_head from public, anon, authenticated;

-- Hash of one entry. Stable across time zones and sessions: the timestamp is
-- hashed as microseconds since the epoch, jsonb has one canonical text form.
create or replace function inventory_private.audit_digest(
  p_prev bytea, p_seq bigint, p_created_at timestamptz, p_actor_id uuid, p_actor_kind text,
  p_action text, p_table text, p_row text, p_old jsonb, p_new jsonb, p_note text, p_db_user text
) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(p_prev || convert_to(jsonb_build_array(
    p_seq, (extract(epoch from p_created_at) * 1000000)::bigint, p_actor_id, p_actor_kind,
    p_action, p_table, p_row, p_old, p_new, p_note, p_db_user)::text, 'UTF8'))
$$;
revoke execute on function inventory_private.audit_digest(bytea, bigint, timestamptz, uuid, text, text, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;

-- Seal existing entries, oldest first.
alter table inventory.audit_log disable trigger audit_log_immutable;
do $$
declare
  r record;
  v_seq bigint := 0;
  v_hash bytea := sha256(convert_to('store-register audit log', 'UTF8'));
begin
  if exists (select 1 from inventory_private.audit_head) then
    return;  -- already sealed by an earlier run
  end if;
  for r in select * from inventory.audit_log order by id loop
    v_seq := v_seq + 1;
    update inventory.audit_log
       set seq = v_seq, prev_hash = v_hash,
           hash = inventory_private.audit_digest(v_hash, v_seq, r.created_at, r.actor_id, r.actor_kind,
                    r.action, r.table_name, r.row_id, r.old_data, r.new_data, r.note, r.db_user)
     where id = r.id
     returning hash into v_hash;
  end loop;
  insert into inventory_private.audit_head (id, seq, hash) values (1, v_seq, v_hash);
end $$;
alter table inventory.audit_log enable trigger audit_log_immutable;

alter table inventory.audit_log
  alter column seq set not null,
  alter column prev_hash set not null,
  alter column hash set not null;
create unique index if not exists audit_log_seq_idx on inventory.audit_log (seq);

-- Runs last before every insert: says how the change was made, then links it
-- into the chain. Callers cannot choose seq or hashes.
create or replace function inventory_private.seal_audit_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
  v_seq bigint;
  v_prev bytea;
begin
  if v_role not in ('authenticated', 'service_role') then
    -- Not through the Data API: SQL Editor, psql, a migration or a script.
    new.actor_kind := 'database';
    new.db_user := session_user;
  else
    new.db_user := null;
  end if;
  new.created_at := coalesce(new.created_at, now());

  update inventory_private.audit_head set seq = seq + 1 where id = 1
  returning seq, hash into v_seq, v_prev;
  if v_seq is null then
    raise exception 'Audit log is not initialised';
  end if;

  new.seq := v_seq;
  new.prev_hash := v_prev;
  new.hash := inventory_private.audit_digest(v_prev, v_seq, new.created_at, new.actor_id, new.actor_kind,
                new.action, new.table_name, new.row_id, new.old_data, new.new_data, new.note, new.db_user);
  update inventory_private.audit_head set hash = new.hash where id = 1;
  return new;
end $$;
revoke execute on function inventory_private.seal_audit_entry() from public, anon, authenticated;

drop trigger if exists zz_audit_log_seal on inventory.audit_log;
create trigger zz_audit_log_seal before insert on inventory.audit_log
  for each row execute function inventory_private.seal_audit_entry();

-- TRUNCATE skips row triggers; refuse it outright.
drop trigger if exists audit_log_no_truncate on inventory.audit_log;
create trigger audit_log_no_truncate before truncate on inventory.audit_log
  for each statement execute function inventory.forbid_change();

-- Walk the whole chain. Reports the first entry that does not match.
create or replace function inventory.verify_audit_log() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  v_expect bigint := 0;
  v_hash bytea := sha256(convert_to('store-register audit log', 'UTF8'));
  v_head inventory_private.audit_head;
begin
  perform inventory._require('audit.read');
  for r in select * from inventory.audit_log order by seq loop
    v_expect := v_expect + 1;
    if r.seq <> v_expect then
      return jsonb_build_object('ok', false, 'checked', v_expect - 1, 'at', v_expect,
        'problem', format('Entry %s is missing (removed from the log)', v_expect));
    end if;
    if r.prev_hash <> v_hash or r.hash <> inventory_private.audit_digest(r.prev_hash, r.seq, r.created_at,
         r.actor_id, r.actor_kind, r.action, r.table_name, r.row_id, r.old_data, r.new_data, r.note, r.db_user) then
      return jsonb_build_object('ok', false, 'checked', v_expect - 1, 'at', r.seq,
        'problem', format('Entry %s was changed after it was written', r.seq));
    end if;
    v_hash := r.hash;
  end loop;

  select * into v_head from inventory_private.audit_head where id = 1;
  if v_head.seq <> v_expect or v_head.hash <> v_hash then
    return jsonb_build_object('ok', false, 'checked', v_expect, 'at', v_expect + 1,
      'problem', format('The newest entries after %s were removed', v_expect));
  end if;
  return jsonb_build_object('ok', true, 'checked', v_expect,
    'hash', encode(v_hash, 'hex'), 'checked_at', now());
end $$;

-- ---------------------------------------------------------------------------
-- 4. Sign-in history
-- ---------------------------------------------------------------------------
-- Called by the app server for the signed-in caller only. One sign-in entry
-- per session; failed codes are capped so the log cannot be flooded.
create or replace function inventory.record_auth_event(p_event text, p_device text default null, p_ip text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session text := coalesce(auth.jwt()->>'session_id', '');
  v_data jsonb;
begin
  if v_uid is null or not exists (select 1 from inventory.profiles where id = v_uid) then
    return;  -- not a store register account: nothing to record
  end if;
  if p_event not in ('sign_in', 'sign_out', 'code_failed', 'password_set') then
    raise exception 'Unknown event';
  end if;
  if p_event = 'sign_in' then
    if (auth.jwt()->>'aal') is distinct from 'aal2' then
      return;  -- a sign-in counts once the authenticator code is accepted
    end if;
    if exists (select 1 from inventory.audit_log
               where table_name = 'sessions' and row_id = v_session and action = 'sign_in') then
      return;
    end if;
  end if;
  if p_event = 'code_failed' and (
       select count(*) from inventory.audit_log
       where actor_id = v_uid and action = 'code_failed' and created_at > now() - interval '10 minutes') >= 10 then
    return;
  end if;

  v_data := jsonb_strip_nulls(jsonb_build_object(
    'device', left(inventory._clean(p_device), 200),
    'ip', left(inventory._clean(p_ip), 64)));
  insert into inventory.audit_log (actor_id, actor_kind, action, table_name, row_id, new_data)
  values (v_uid, 'member', p_event, 'sessions', nullif(v_session, ''), nullif(v_data, '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Directory for everyday screens
-- ---------------------------------------------------------------------------
create or replace function inventory.directory()
returns table (id uuid, full_name text, email text, role_name text, active boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email,
         case
           when r.hidden and not inventory_private.has_permission('users.manage')
             then coalesce((select u.name from inventory.roles u where u.key = 'user'), 'User')
           else r.name
         end,
         p.active
  from inventory.profiles p
  join inventory.roles r on r.id = p.role_id
  where inventory_private.is_member()
  order by p.full_name
$$;

-- ---------------------------------------------------------------------------
-- 6. Guide progress
-- ---------------------------------------------------------------------------
create table if not exists inventory.member_prefs (
  user_id       uuid primary key references inventory.profiles (id) on delete cascade,
  tour_version  int not null default 0 check (tour_version >= 0),
  updated_at    timestamptz not null default now()
);
alter table inventory.member_prefs enable row level security;
revoke all on inventory.member_prefs from public, anon, authenticated;
grant all on inventory.member_prefs to service_role;

create or replace function inventory.set_tour_version(p_version int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not inventory_private.is_member() then
    raise exception 'Not an active member' using errcode = '42501';
  end if;
  if p_version is null or p_version < 0 or p_version > 1000 then
    raise exception 'Invalid version';
  end if;
  insert into inventory.member_prefs (user_id, tour_version, updated_at)
  values (auth.uid(), p_version, now())
  on conflict (user_id) do update set tour_version = excluded.tour_version, updated_at = now();
end $$;

create or replace function inventory.me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'active', p.active,
    'role', jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'hidden', r.hidden),
    'mfa_verified', (auth.jwt()->>'aal') = 'aal2',
    'permissions', coalesce((select jsonb_agg(permission_key order by permission_key)
                             from inventory.role_permissions where role_id = p.role_id), '[]'::jsonb),
    'tour_version', coalesce((select m.tour_version from inventory.member_prefs m where m.user_id = p.id), 0)
  )
  from inventory.profiles p join inventory.roles r on r.id = p.role_id
  where p.id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Privileges for the new API functions
-- ---------------------------------------------------------------------------
revoke execute on function inventory.verify_audit_log(), inventory.record_auth_event(text, text, text),
  inventory.directory(), inventory.set_tour_version(int)
from public, anon;
grant execute on function inventory.verify_audit_log(), inventory.record_auth_event(text, text, text),
  inventory.directory(), inventory.set_tour_version(int)
to authenticated;
