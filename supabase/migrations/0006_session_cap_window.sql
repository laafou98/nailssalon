-- The per-session cap is a rolling 24-hour window, not a lifetime total: a cookie lives 30 days, and a client who
-- had tried 15 looks over a fortnight was locked out for good. The global cap still counts everything ever spent.

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
  select coalesce(sum(units), 0) into v_session
  from unit_ledger
  where session_id = p_session_id and created_at > now() - interval '24 hours';

  if v_global + p_units > p_global_cap or v_session + p_units > p_session_cap then
    return false;
  end if;

  insert into unit_ledger (session_id, render_id, engine, units)
  values (p_session_id, p_render_id, p_engine, p_units);
  update sessions set units_used = units_used + p_units where id = p_session_id;
  return true;
end;
$$;

revoke all on function public.reserve_units(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
