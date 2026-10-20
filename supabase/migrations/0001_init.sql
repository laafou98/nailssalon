-- NailsSalon initial schema.
-- Client-facing tables are accessed only through server route handlers (service role).
-- Salon owners can manage their own salon, catalogue and pricing directly.

create extension if not exists pgcrypto;

-- Salons & catalogue ---------------------------------------------------------

create table public.salons (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references auth.users (id) on delete set null,
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null,
  whatsapp    text check (whatsapp ~ '^\+?[0-9]{8,15}$'),
  city        text,
  currency    text not null default 'MAD',
  locale      text not null default 'fr' check (locale in ('en', 'fr', 'ar')),
  created_at  timestamptz not null default now()
);

create table public.polishes (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons (id) on delete cascade,
  brand       text not null,
  name        text not null,
  hex         text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  -- CIELAB (D65), precomputed for ΔE2000 matching
  lab_l       real not null,
  lab_a       real not null,
  lab_b       real not null,
  finish      text not null check (finish in (
                'matte', 'cream', 'jelly', 'sheer', 'metallic', 'pearl',
                'shimmer_fine', 'shimmer_coarse', 'textured')),
  in_stock    boolean not null default true,
  created_at  timestamptz not null default now()
);
create index polishes_salon_idx on public.polishes (salon_id) where in_stock;

create table public.price_rules (
  salon_id          uuid primary key references public.salons (id) on delete cascade,
  base_price        numeric(10, 2) not null default 0,
  -- e.g. {"solid": 0, "french": 20, "ombre": 30, "cat_eye": 30, "art": 50} per finger
  art_tiers         jsonb not null default '{}'::jsonb,
  length_surcharge  numeric(10, 2) not null default 0,
  -- e.g. {"base": 45, "per_art_finger": 8}
  minutes           jsonb not null default '{}'::jsonb
);

-- Client sessions & pipeline ---------------------------------------------------

create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid references public.salons (id) on delete set null,
  units_used  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table public.images (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references public.sessions (id) on delete cascade,
  kind        text not null check (kind in ('hand', 'inspo', 'design', 'render', 'after')),
  path        text not null,            -- object path in the "images" storage bucket
  sha256      text not null,
  width       integer,
  height      integer,
  landmarks   jsonb,                    -- MediaPipe hand landmarks, normalised
  created_at  timestamptz not null default now()
);
create index images_sha_idx on public.images (sha256);

create table public.designs (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid references public.sessions (id) on delete cascade,
  source_image_id  uuid references public.images (id) on delete set null,
  spec             jsonb not null,      -- DesignSpec (see src/lib/spec)
  confidence       real not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.renders (
  id               uuid primary key default gen_random_uuid(),
  design_id        uuid references public.designs (id) on delete cascade,
  hand_image_id    uuid references public.images (id) on delete cascade,
  -- sha256(hand image hash + canonical spec JSON): identical requests never spend a unit twice
  cache_key        text not null unique,
  engine           text not null check (engine in ('nail_vto', 'nail_transfer')),
  youcam_task_id   text,
  status           text not null default 'pending'
                     check (status in ('pending', 'running', 'success', 'error')),
  error            text,
  result_image_id  uuid references public.images (id) on delete set null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create table public.recipes (
  id              uuid primary key default gen_random_uuid(),
  design_id       uuid references public.designs (id) on delete cascade,
  render_id       uuid references public.renders (id) on delete set null,
  salon_id        uuid references public.salons (id) on delete set null,
  quote           jsonb not null default '{}'::jsonb,
  polish_matches  jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table public.fidelity_checks (
  id              uuid primary key default gen_random_uuid(),
  recipe_id       uuid not null references public.recipes (id) on delete cascade,
  after_image_id  uuid references public.images (id) on delete set null,
  score           real,
  per_finger      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table public.unit_ledger (
  id          bigint generated always as identity primary key,
  session_id  uuid references public.sessions (id) on delete set null,
  render_id   uuid references public.renders (id) on delete set null,
  engine      text not null,
  units       integer not null check (units > 0),
  created_at  timestamptz not null default now()
);

-- Atomically reserve YouCam units against per-session and global caps.
-- Returns true and records the spend if both caps allow it; false otherwise.
create or replace function public.reserve_units(
  p_session_id  uuid,
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

  insert into unit_ledger (session_id, engine, units) values (p_session_id, p_engine, p_units);
  update sessions set units_used = units_used + p_units where id = p_session_id;
  return true;
end;
$$;

revoke all on function public.reserve_units(uuid, text, integer, integer, integer) from public, anon, authenticated;

-- Row level security -----------------------------------------------------------

alter table public.salons          enable row level security;
alter table public.polishes        enable row level security;
alter table public.price_rules     enable row level security;
alter table public.sessions        enable row level security;
alter table public.images          enable row level security;
alter table public.designs         enable row level security;
alter table public.renders         enable row level security;
alter table public.recipes         enable row level security;
alter table public.fidelity_checks enable row level security;
alter table public.unit_ledger     enable row level security;

-- Salon owners manage their own salon.
create policy "owners read own salon" on public.salons
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owners create salon" on public.salons
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owners update own salon" on public.salons
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Salon owners manage their own catalogue and pricing.
create policy "owners manage own polishes" on public.polishes
  for all to authenticated
  using (exists (select 1 from public.salons s where s.id = salon_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.salons s where s.id = salon_id and s.owner_id = (select auth.uid())));

create policy "owners manage own price rules" on public.price_rules
  for all to authenticated
  using (exists (select 1 from public.salons s where s.id = salon_id and s.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.salons s where s.id = salon_id and s.owner_id = (select auth.uid())));

-- Pipeline tables (sessions, images, designs, renders, recipes, fidelity_checks,
-- unit_ledger) have RLS enabled and no policies: only the server (service role) touches them.

-- Storage ------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
