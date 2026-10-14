-- ============================================================
-- RECONCILE: public.matches — ONE canonical shape
-- Run in Supabase Dashboard → SQL Editor, AFTER product_flow_bundle.sql.
-- Idempotent: safe to re-run.
--
-- WHY THIS FILE EXISTS
-- product_flow_bundle.sql declares `matches` as the Qrashe table
-- (tier / created_by / status active|unmatched) with
-- `create table if not exists`. On any database where the legacy
-- weekly `matches` table already existed, that statement is a NO-OP,
-- so the product-flow definition never actually applied and three
-- shapes coexisted at once:
--   * the repo definition  — tier='qrashe', status active|unmatched;
--   * the live table       — the weekly engine's shape:
--     compatibility_score, is_visible, compatibility_drivers,
--     explanation, success_probability, last_interaction_at,
--     interested_at, discarded_at, and
--     status pending|interested|discarded|matched|ghosted;
--   * match-generator      — upserting status 'pending', is_visible
--     and compatibility_drivers rows into it.
-- This file makes the live table match the definition.
--
-- CANONICAL SHAPE (the rule from here on)
--   A `matches` row is created ONLY by complete_force_connect(), i.e.
--   by a verified Force Connect payment. Weekly Tier 1 / Tier 2 live
--   in match_history; the weekly engine must NOT write `matches`
--   (it would mislabel a weekly pair as Qrashe — the app reads every
--   status='active' row on this table as a Qrashe match).
--     tier   : 'qrashe'; NULL only on pre-tier legacy rows.
--     status : 'active' | 'unmatched' for canonical rows. The five
--              legacy values remain accepted so rows that already
--              exist stay valid — this file migrates and deletes no
--              rows.
--
-- NO DATA IS DESTROYED: the legacy columns (is_visible,
-- compatibility_drivers, explanation, success_probability,
-- last_interaction_at, interested_at, discarded_at) are RETAINED and
-- simply have no writer. Drop them deliberately later, once a
-- retention decision is made — see the note at the end of section 2.
--
-- VERIFY AFTER RUNNING: see section 6.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table — fresh-install path. On an existing database this is a
--    no-op and sections 2-4 bring the existing table to this shape.
-- ------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  -- Canonical: NULL means "legacy row, created before tiers existed".
  tier text default 'qrashe' check (tier is null or tier = 'qrashe'),
  created_by uuid references public.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','unmatched','pending','interested',
                      'discarded','matched','ghosted')),
  compatibility_score integer not null default 0,
  created_at timestamptz not null default now(),
  -- Legacy weekly-engine columns, retained for existing rows only.
  -- No code writes or reads these any more.
  is_visible boolean default false,
  compatibility_drivers jsonb,
  explanation jsonb,
  success_probability double precision default 0.0,
  last_interaction_at timestamptz default now(),
  interested_at timestamptz,
  discarded_at timestamptz,
  unique (user_a_id, user_b_id),
  check (user_a_id <> user_b_id)
);

-- ------------------------------------------------------------
-- 2. Columns — add whatever the canonical shape needs and the live
--    table may be missing.
-- ------------------------------------------------------------
alter table public.matches add column if not exists tier text;
alter table public.matches add column if not exists created_by uuid
  references public.users(id) on delete set null;
alter table public.matches add column if not exists compatibility_score integer;

-- Legacy columns exist on the live table already; these keep a
-- partial or fresh database in the same shape.
alter table public.matches add column if not exists is_visible boolean default false;
alter table public.matches add column if not exists compatibility_drivers jsonb;
alter table public.matches add column if not exists explanation jsonb;
alter table public.matches add column if not exists success_probability double precision default 0.0;
alter table public.matches add column if not exists last_interaction_at timestamptz default now();
alter table public.matches add column if not exists interested_at timestamptz;
alter table public.matches add column if not exists discarded_at timestamptz;

-- Defaults and nullability: one definition, applied to the live table.
alter table public.matches alter column tier set default 'qrashe';
alter table public.matches alter column status set default 'active';
alter table public.matches alter column compatibility_score set default 0;

-- Backfill only NULLs (never overwrites a real score) so the NOT NULL
-- below can hold. A no-op on the live table, where the column is
-- already `integer NOT NULL DEFAULT 0`.
update public.matches set compatibility_score = 0 where compatibility_score is null;

-- Only NULLs are filled, never an existing value: a missing audit
-- timestamp or status gets what the column default would have applied at
-- insert time. This is what lets NOT NULL hold on a live table and on a
-- fresh install alike. status -> 'pending' deliberately, so a row of
-- unknown provenance never reads as a live Qrashe match.
update public.matches set created_at = now() where created_at is null;
update public.matches set status = 'pending' where status is null;

do $$
begin
  alter table public.matches alter column compatibility_score set not null;
  alter table public.matches alter column created_at set not null;
  alter table public.matches alter column status set not null;

  if exists (select 1 from public.matches
             where user_a_id is null or user_b_id is null) then
    raise notice 'matches: rows with a NULL participant found — user_a_id/user_b_id left nullable. Resolve or remove those rows and re-run to finish the shape.';
  else
    alter table public.matches alter column user_a_id set not null;
    alter table public.matches alter column user_b_id set not null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Constraints — replace the legacy status check with the
--    documented superset, and add the canonical ones the live table
--    is missing (it has only the primary key on id).
-- ------------------------------------------------------------
alter table public.matches drop constraint if exists matches_status_check;
alter table public.matches add constraint matches_status_check
  check (status in ('active','unmatched','pending','interested',
                    'discarded','matched','ghosted'));

alter table public.matches drop constraint if exists matches_tier_check;
alter table public.matches add constraint matches_tier_check
  check (tier is null or tier = 'qrashe');

do $$
declare
  v_total integer;
  v_self integer;
  v_dupes integer;
begin
  select count(*) into v_total from public.matches;

  -- (a) self-pairs
  select count(*) into v_self
  from public.matches where user_a_id = user_b_id;
  if v_self > 0 then
    raise notice 'matches: % self-pair row(s) present — matches_distinct_pair_check NOT added (query: select * from public.matches where user_a_id = user_b_id).', v_self;
  else
    alter table public.matches drop constraint if exists matches_distinct_pair_check;
    alter table public.matches add constraint matches_distinct_pair_check
      check (user_a_id <> user_b_id);
  end if;

  -- (b) one row per pair. Legacy rows were written unordered, so the
  -- same two people can appear as both (a,b) and (b,a); that has to
  -- be resolved by a human decision, not silently by this file.
  if exists (
    select 1 from pg_constraint
    where conname = 'matches_unique_pair'
      and conrelid = 'public.matches'::regclass
  ) then
    raise notice 'matches: unique pair key already present.';
  else
    select count(*) into v_dupes
    from (
      select least(user_a_id, user_b_id) as lo,
             greatest(user_a_id, user_b_id) as hi
      from public.matches
      where user_a_id is not null and user_b_id is not null
      group by 1, 2
      having count(*) > 1
    ) d;

    if v_dupes > 0 then
      raise notice 'matches: % duplicated pair(s) present — unique pair key NOT added. Inspect with: select least(user_a_id,user_b_id) lo, greatest(user_a_id,user_b_id) hi, count(*) from public.matches group by 1,2 having count(*) > 1;', v_dupes;
    else
      alter table public.matches add constraint matches_unique_pair
        unique (user_a_id, user_b_id);
      raise notice 'matches: unique pair key added (% rows checked).', v_total;
    end if;
  end if;
end $$;

-- Foreign keys, in the canonical form. The live table references the
-- participants WITHOUT `on delete cascade`, which makes deleting an
-- account fail once that account has a match row — and account deletion
-- is a supported RPC. `created_by` is provenance only: the connection
-- belongs to both participants, so losing the payer nulls the column
-- rather than the row.
do $$
declare
  c record;
  v_dangling integer;
begin
  select count(*) into v_dangling
  from public.matches m
  where (m.user_a_id is not null and not exists (select 1 from public.users u where u.id = m.user_a_id))
     or (m.user_b_id is not null and not exists (select 1 from public.users u where u.id = m.user_b_id))
     or (m.created_by is not null and not exists (select 1 from public.users u where u.id = m.created_by));

  if v_dangling > 0 then
    raise notice 'matches: % row(s) reference a user that no longer exists — foreign keys left as they are. Resolve them and re-run.', v_dangling;
    return;
  end if;

  for c in
    select conname from pg_constraint
     where conrelid = 'public.matches'::regclass and contype = 'f'
  loop
    execute format('alter table public.matches drop constraint %I', c.conname);
  end loop;

  alter table public.matches add constraint matches_user_a_id_fkey
    foreign key (user_a_id) references public.users(id) on delete cascade;
  alter table public.matches add constraint matches_user_b_id_fkey
    foreign key (user_b_id) references public.users(id) on delete cascade;
  alter table public.matches add constraint matches_created_by_fkey
    foreign key (created_by) references public.users(id) on delete set null;

  raise notice 'matches: participant FKs now cascade; created_by is set null on delete.';
end $$;

-- The client reads this table with `.or(user_a_id.eq.X,user_b_id.eq.X)`;
-- the unique key covers the user_a_id side, this covers the other.
create index if not exists idx_matches_user_b on public.matches (user_b_id);

-- Legacy index on (user_a_id, is_visible): nothing filters is_visible any
-- more, so it only costs writes. Dropping an index destroys no data.
drop index if exists public.idx_matches_user_visible;

-- ------------------------------------------------------------
-- 4. Access — RLS on, participant-scoped SELECT, no client writes.
--    The live table also carried a permissive UPDATE policy that let
--    either participant rewrite their own match row; under the
--    canonical shape only complete_force_connect() may write.
-- ------------------------------------------------------------
alter table public.matches enable row level security;

drop policy if exists "Users can update their own matches" on public.matches;
drop policy if exists "Users can view their own matches" on public.matches;

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

revoke all on table public.matches from anon;
revoke insert, update, delete on table public.matches from authenticated;

-- ------------------------------------------------------------
-- 5. Retire the legacy writers. Two live functions insert into
--    `matches` outside the payment path; both are dead code (nothing
--    in the repo calls them) and both produce non-canonical rows.
--    generate_tuesday_matches() is also TRUNCATE-based and was
--    granted to anon/authenticated — any logged-in user could wipe
--    every Qrashe pair.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'generate_tuesday_matches'
  ) then
    execute 'revoke all on function public.generate_tuesday_matches() from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.generate_tuesday_matches() from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.generate_tuesday_matches() from authenticated';
    end if;
    raise notice 'matches: generate_tuesday_matches() execute revoked (legacy weekly engine, truncates matches).';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_for_match'
  ) then
    execute 'revoke execute on function public.check_for_match(uuid, uuid) from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke execute on function public.check_for_match(uuid, uuid) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke execute on function public.check_for_match(uuid, uuid) from authenticated';
    end if;
    raise notice 'matches: check_for_match() execute revoked (legacy like-to-match writer).';
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Verify — run these and compare against the expectations:
--      * columns: id, user_a_id, user_b_id, tier, created_by, status,
--        compatibility_score, created_at (+ the retained legacy set)
--      * constraints: matches_status_check, matches_tier_check,
--        matches_distinct_pair_check, matches_unique_pair
--      * policies: matches_select_participant (SELECT only)
--      * a row count that did not shrink (no rows were deleted here)
--
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'matches'
--  order by ordinal_position;
--
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'public.matches'::regclass
--  order by conname;
--
-- select policyname, cmd, roles::text from pg_policies
--  where schemaname = 'public' and tablename = 'matches';
--
-- select count(*) as total_rows,
--        count(*) filter (where tier = 'qrashe') as qrashe_rows,
--        count(*) filter (where tier is null) as legacy_rows
--   from public.matches;
-- ============================================================
