-- One recipe card per render: a double tap (or React's dev double effect) made two URLs for the same picture.
delete from public.recipes r
using public.recipes earlier
where r.render_id = earlier.render_id and earlier.created_at < r.created_at;
create unique index if not exists recipes_render_uidx on public.recipes (render_id);

-- Claude readings are metered per session (no YouCam units, but real API credit): 60 is plenty for a client,
-- and bounds what a looping caller can spend.
alter table public.sessions add column if not exists vision_calls integer not null default 0;

create or replace function public.count_vision_call(p_session_id uuid, p_cap integer) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sessions set vision_calls = vision_calls + 1 where id = p_session_id and vision_calls < p_cap;
  return found;
end;
$$;

revoke all on function public.count_vision_call(uuid, integer) from public, anon, authenticated;
