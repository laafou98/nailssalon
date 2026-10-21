-- Tie each unit reservation to the render that spent it, so a failed render can be refunded.
-- YouCam only charges units for tasks that succeed.

drop function if exists public.reserve_units(uuid, text, integer, integer, integer);

create or replace function public.reserve_units(
  p_session_id  uuid,
  p_render_id   uuid,
  p_engine      text,
  p_units       integer,
  p_session_cap integer,
  p_global_cap  integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_global   integer;
  v_session  integer;
begin
  perform pg_advisory_xact_lock(hashtext('unit_ledger'));

  select coalesce(sum(units), 0) into v_global from unit_ledger;
  select coalesce(sum(units), 0) into v_session from unit_ledger where session_id = p_session_id;

  if v_global + p_units > p_global_cap or v_session + p_units > p_session_cap then
    return false;
  end if;

  insert into unit_ledger (session_id, render_id, engine, units)
  values (p_session_id, p_render_id, p_engine, p_units);
  update sessions set units_used = units_used + p_units where id = p_session_id;
  return true;
end;
$$;

-- Give back the units reserved for a render that failed. Returns the units refunded.
create or replace function public.refund_units(p_render_id uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session  uuid;
  v_units    integer;
begin
  perform pg_advisory_xact_lock(hashtext('unit_ledger'));

  select session_id, coalesce(sum(units), 0)::integer into v_session, v_units
  from unit_ledger where render_id = p_render_id group by session_id;

  if v_units is null or v_units = 0 then
    return 0;
  end if;

  delete from unit_ledger where render_id = p_render_id;
  update sessions set units_used = greatest(units_used - v_units, 0) where id = v_session;
  return v_units;
end;
$$;

revoke all on function public.reserve_units(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.refund_units(uuid) from public, anon, authenticated;

-- The same photo uploaded twice in a session reuses one row (and one storage object).
create unique index images_session_kind_sha_idx on public.images (session_id, kind, sha256);
