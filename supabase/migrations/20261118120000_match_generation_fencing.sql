-- ---------------------------------------------------------------------------
-- Matching reliability: generation fencing + atomic week replacement
--
-- WHY
--   The weekly generator published with a single merge-upsert
--   (on_conflict user_id,week_id). Two defects followed:
--     * a same-week re-run never removed assignments for users who lost their
--       partner, leaving orphan rows and broken mutual links in the live week;
--     * nothing ordered competing runs, so an older computation could publish
--       over a newer one (a plain lock only orders the write, not the work).
--
-- WHAT
--   1. match_generation_seq   — monotonic generation identifiers.
--   2. match_week_generations — per-week fencing state (newest authorized run,
--      newest published run, and the exact payload it published).
--   3. begin_match_generation(week) — called at the START of every run.
--   4. publish_week_allocation(week, generation, rows) — fence check + week
--      scoped delete + insert in ONE transaction. A stale generation raises
--      before any write; a failure rolls the delete back, so the previously
--      published allocation survives. One generation is bound to exactly one
--      payload: an identical replay is idempotent (no write), a different
--      payload under the same generation raises generation_conflict.
--
-- SCOPE
--   Purely additive. No change to match_history, its indexes or its RLS.
--   Historical weeks are unreachable: the delete is scoped by week_id.
--   Executable by service_role only.
-- ---------------------------------------------------------------------------

-- 1. Monotonic generation counter. Never reused; gaps are acceptable because
--    nextval() is non-transactional and a rolled-back run still burns a value.
create sequence if not exists public.match_generation_seq as bigint start 1;

-- 2. Per-week fencing state: one row per week for the lifetime of the week.
create table if not exists public.match_week_generations (
  week_id                     text primary key,
  latest_generation           bigint not null,
  latest_published_generation bigint,
  published_rows              jsonb,
  published_at                timestamptz,
  updated_at                  timestamptz not null default now()
);

alter table public.match_week_generations add column if not exists published_rows jsonb;

alter table public.match_week_generations enable row level security;

revoke all on public.match_week_generations from anon, authenticated;
revoke all on sequence public.match_generation_seq from anon, authenticated;

-- The generator recovers a fence verdict by reading this row back when the
-- transport loses the error message (PostgREST drops the connection on the
-- SQLSTATE the fence raises). That diagnostic read is service-role only; no
-- client role may see fencing state.
grant select on public.match_week_generations to service_role;

comment on table public.match_week_generations is
  'Fencing state for weekly matching runs: latest_generation is the newest AUTHORIZED run, latest_published_generation the newest one that actually replaced the week, published_rows the payload it published.';

comment on column public.match_week_generations.published_rows is
  'Exact JSONB payload accepted for latest_published_generation. Binds one generation to one allocation: an identical replay writes nothing, a different payload raises generation_conflict.';

-- 3. Called once at the start of every matching run, BEFORE any data is read,
--    so ordering reflects authorization order rather than write order.
create or replace function public.begin_match_generation(p_week_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  g bigint;
begin
  if p_week_id is null or p_week_id = '' then
    raise exception 'begin_match_generation: week id is required' using errcode = '22023';
  end if;

  g := nextval('public.match_generation_seq');

  -- greatest() makes concurrent starts order-independent: whichever commit
  -- lands last, latest_generation is the highest (newest) authorization.
  insert into public.match_week_generations (week_id, latest_generation, updated_at)
  values (p_week_id, g, now())
  on conflict (week_id) do update
    set latest_generation = greatest(public.match_week_generations.latest_generation,
                                     excluded.latest_generation),
        updated_at = now();

  return g;
end $$;

-- 4. Fenced, atomic, week-scoped replacement of the weekly allocation.
create or replace function public.publish_week_allocation(
  p_week_id    text,
  p_generation bigint,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_generation   bigint;
  published_generation bigint;
  stored_rows          jsonb;
  incoming_rows        jsonb := coalesce(p_rows, '[]'::jsonb);
  inserted             integer;
  existing_count       integer;
begin
  if p_week_id is null or p_week_id = '' then
    raise exception 'publish_week_allocation: week id is required' using errcode = '22023';
  end if;
  if p_generation is null then
    raise exception 'publish_week_allocation: generation is required' using errcode = '22023';
  end if;

  -- Row lock: serialises publishers of THIS week for the rest of the
  -- transaction, and is released on commit and on rollback alike.
  -- Distinct weeks use distinct rows, so they never block each other.
  select latest_generation, latest_published_generation, published_rows
    into current_generation, published_generation, stored_rows
  from public.match_week_generations
  where week_id = p_week_id
  for update;

  if not found then
    raise exception 'unknown_generation' using errcode = 'P0002';
  end if;

  -- FENCING: only the newest authorized run may publish. Checked before any
  -- write, so a rejected run leaves match_history and the counters untouched.
  if p_generation < current_generation then
    raise exception 'stale_generation' using errcode = '40001';
  end if;

  -- REPLAY BINDING: one generation publishes exactly one allocation.
  -- Repeating an already published generation is accepted only when the
  -- payload is identical, and then it writes nothing at all. A different
  -- payload under the same generation is rejected, so a repeat can never
  -- silently replace an allocation that is already live. Publishers are
  -- serialised by the row lock above, so concurrent conflicting replicas
  -- cannot both succeed.
  if p_generation = published_generation then
    if stored_rows is distinct from incoming_rows then
      raise exception 'generation_conflict' using errcode = '40001';
    end if;
    select count(*) into existing_count from public.match_history where week_id = p_week_id;
    return jsonb_build_object('published', existing_count, 'generation', p_generation, 'replayed', true);
  end if;

  -- Week-scoped replace. Historical weeks are unreachable by this predicate.
  delete from public.match_history where week_id = p_week_id;

  insert into public.match_history (user_id, week_id, tier1_match_id, tier2_match_id, delivered_at)
  select (r->>'user_id')::uuid,
         p_week_id,
         nullif(r->>'tier1_match_id', '')::uuid,
         nullif(r->>'tier2_match_id', '')::uuid,
         (r->>'delivered_at')::timestamptz
  from jsonb_array_elements(incoming_rows) as r;

  get diagnostics inserted = row_count;

  update public.match_week_generations
     set latest_published_generation = p_generation,
         -- Invariant: the newest authorization is never older than the newest
         -- publication (only reachable when publish is called out of order).
         latest_generation = greatest(latest_generation, p_generation),
         published_rows = incoming_rows,
         published_at = now(),
         updated_at = now()
   where week_id = p_week_id;

  return jsonb_build_object('published', inserted, 'generation', p_generation, 'replayed', false);
end $$;

revoke all on function public.begin_match_generation(text) from public, anon, authenticated;
revoke all on function public.publish_week_allocation(text, bigint, jsonb) from public, anon, authenticated;

grant execute on function public.begin_match_generation(text) to service_role;
grant execute on function public.publish_week_allocation(text, bigint, jsonb) to service_role;

comment on function public.begin_match_generation(text) is
  'Mints the generation identifier for a weekly matching run. Called before any data read.';
comment on function public.publish_week_allocation(text, bigint, jsonb) is
  'Fenced, atomic replacement of one week of match_history. Raises stale_generation without writing when a newer run has been authorized, and generation_conflict when the same generation is repeated with a different payload.';
