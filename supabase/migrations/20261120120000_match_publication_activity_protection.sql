-- Match publication activity protection — production parity (Stage 4).
--
-- Aligns the repository migration chain with the implementation that is
-- installed and verified in production (project mhdjnhiqahsllbczbzpk):
--
--   * match_history carries the two interaction flags the publisher checks,
--     its week_id is NOT NULL and its delivered_at defaults to now();
--   * the SELECT policy hides a match until its release timestamp, so a user
--     cannot see an unreleased week just because the row belongs to them;
--   * the two activity tables the publisher inspects exist, with production's
--     foreign keys and delete rules — match_signals cascades from
--     match_history, match_behavior does not;
--   * service_role may read the generation sequence;
--   * both RPCs run with an empty search path;
--   * publish_week_allocation rejects a future generation, locks the target
--     week's history rows, refuses to replace a week that holds user activity,
--     and validates every row before anything is written.
--
-- Why the activity check is not optional: match_signals cascades from
-- match_history, so an unprotected week-scoped delete would silently destroy
-- user signal history; match_behavior does not cascade, so the same delete
-- would raise a foreign-key violation and abort the run with an opaque error.
-- Both become a single, answerable PT409 week_in_use verdict instead.
--
-- Forward-only. No historical migration is edited. Nothing here touches
-- public.matches (Qrashe's paid pairs) or any table outside the publication
-- path.

-- ----------------------------------------------------------------
-- 1. uuid_generate_v4() — production's match_behavior.id default.
--    The chain has never installed uuid-ossp; production has it.
-- ----------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------
-- 2. Activity tables.
--
--    A clean database needs both, because the publisher reads them. An
--    existing table is reconciled, never dropped: the required columns are
--    verified first and a mismatch raises instead of being swallowed, so a
--    half-built object can never masquerade as the production one.
-- ----------------------------------------------------------------

-- 2a. match_signals — the candidate's signal on a delivered pair.
--     Cascades from match_history, so deleting a week deletes its signals.
do $$
declare
  required text[] := array[
    'id','match_history_id','sender_id','receiver_id',
    'is_interested','payment_status','unlocked_at','created_at'
  ];
  missing text[] := '{}';
  col text;
begin
  if to_regclass('public.match_signals') is null then
    create table public.match_signals (
      id uuid not null default gen_random_uuid(),
      match_history_id uuid,
      sender_id uuid,
      receiver_id uuid,
      is_interested boolean default false,
      payment_status text default 'unpaid',
      unlocked_at timestamptz,
      created_at timestamptz default timezone('utc', now()),
      constraint match_signals_pkey primary key (id),
      constraint match_signals_match_history_fkey
        foreign key (match_history_id) references public.match_history(id) on delete cascade,
      constraint match_signals_sender_fkey
        foreign key (sender_id) references public.users(id) on delete cascade,
      constraint match_signals_receiver_fkey
        foreign key (receiver_id) references public.users(id) on delete cascade,
      constraint match_signals_history_sender_key unique (match_history_id, sender_id)
    );

    alter table public.match_signals enable row level security;

    -- Production's single authenticated policy: a participant may reach their
    -- own rows, nobody else's.
    create policy "match_signals_participant_access"
      on public.match_signals
      for all
      to authenticated
      using ((auth.uid() = sender_id) or (auth.uid() = receiver_id))
      with check ((auth.uid() = sender_id) or (auth.uid() = receiver_id));

    -- Production records broad table privileges on this table; access is
    -- constrained by the policy above, not by the grant.
    grant all on public.match_signals to anon, authenticated, service_role;
    raise notice 'match_signals created';
  else
    foreach col in array required loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'match_signals'
           and column_name = col
      ) then
        missing := missing || col;
      end if;
    end loop;
    if array_length(missing, 1) > 0 then
      raise exception
        'public.match_signals exists but is incompatible: missing %. Nothing was changed.',
        array_to_string(missing, ', ');
    end if;

    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.match_signals'::regclass
         and contype = 'f'
         and confrelid = 'public.match_history'::regclass
         and confdeltype = 'c'
    ) then
      raise exception
        'public.match_signals exists but its match_history foreign key does not cascade. Nothing was changed.';
    end if;
    raise notice 'match_signals already present and compatible';
  end if;
end $$;

-- 2b. match_behavior — recorded behaviour on a delivered pair.
--     Does NOT cascade: production refuses the delete instead, which is why
--     the publisher must check it before replacing a week.
do $$
declare
  required text[] := array['id','match_history_id','user_id','action','created_at','action_timestamp'];
  missing text[] := '{}';
  col text;
begin
  if to_regclass('public.match_behavior') is null then
    create table public.match_behavior (
      id uuid not null default uuid_generate_v4(),
      match_history_id uuid,
      user_id uuid,
      action text not null,
      created_at timestamptz default now(),
      action_timestamp timestamptz default now(),
      constraint match_behavior_pkey primary key (id),
      -- Default NO ACTION, as in production: activity must block the delete,
      -- never be removed by it.
      constraint match_behavior_match_history_fkey
        foreign key (match_history_id) references public.match_history(id),
      constraint match_behavior_user_fkey
        foreign key (user_id) references public.users(id)
    );

    alter table public.match_behavior enable row level security;
    -- Production has RLS enabled and no policies: no client role reaches this
    -- table, whatever its grants say.
    grant all on public.match_behavior to anon, authenticated, service_role;
    raise notice 'match_behavior created';
  else
    foreach col in array required loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'match_behavior'
           and column_name = col
      ) then
        missing := missing || col;
      end if;
    end loop;
    if array_length(missing, 1) > 0 then
      raise exception
        'public.match_behavior exists but is incompatible: missing %. Nothing was changed.',
        array_to_string(missing, ', ');
    end if;

    if exists (
      select 1 from pg_constraint
       where conrelid = 'public.match_behavior'::regclass
         and contype = 'f'
         and confrelid = 'public.match_history'::regclass
         and confdeltype = 'c'
    ) then
      raise exception
        'public.match_behavior exists but its match_history foreign key cascades. Production refuses the delete; reconcile the constraint before applying this migration. Nothing was changed.';
    end if;
    raise notice 'match_behavior already present and compatible';
  end if;
end $$;

-- ----------------------------------------------------------------
-- 3. match_history alignment.
-- ----------------------------------------------------------------

-- 3a. Interaction flags the publisher inspects. Added only when absent; an
--     existing column of a different type is a mismatch, not a no-op.
do $$
declare
  required text[] := array['tier1_interaction','tier2_interaction'];
  wrong text[] := '{}';
  col text;
begin
  foreach col in array required loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'match_history'
         and column_name = col
         and data_type <> 'boolean'
    ) then
      wrong := wrong || col;
    end if;
  end loop;
  if array_length(wrong, 1) > 0 then
    raise exception
      'public.match_history.% exists with a non-boolean type. Nothing was changed.',
      array_to_string(wrong, ', ');
  end if;
end $$;

alter table public.match_history add column if not exists tier1_interaction boolean default false;
alter table public.match_history add column if not exists tier2_interaction boolean default false;

-- 3b. week_id NOT NULL. Existing rows are never rewritten or deleted: if a
--     row has no week, this stops with a clear message instead.
do $$
declare
  null_weeks bigint;
begin
  select count(*) into null_weeks from public.match_history where week_id is null;
  if null_weeks > 0 then
    raise exception
      'cannot enforce match_history.week_id NOT NULL: % row(s) have a null week_id. Give them their week first; nothing was changed.',
      null_weeks;
  end if;
end $$;

alter table public.match_history alter column week_id set not null;

-- 3c. delivered_at defaults to now(), as in production. Rows that are already
--     published keep the timestamp they were written with.
alter table public.match_history alter column delivered_at set default now();

-- 3d. Delivery gate. A row is visible to its owner only once its release time
--     has passed — matching the generator's 18:00 UTC stamp.
drop policy if exists "match_history_select_own" on public.match_history;
create policy "match_history_select_own"
  on public.match_history
  for select
  to authenticated
  using (auth.uid() = user_id and delivered_at <= now());

-- ----------------------------------------------------------------
-- 4. Sequence privileges. Production holds exactly {postgres, service_role} on
--    the sequence, so the Supabase default grants to the client roles are
--    removed rather than merely overridden. Ownership and the current value
--    are untouched.
-- ----------------------------------------------------------------
revoke all on sequence public.match_generation_seq from public, anon, authenticated;
grant usage, select, update on sequence public.match_generation_seq to service_role;

-- ----------------------------------------------------------------
-- 5. begin_match_generation — same body, empty search path.
-- ----------------------------------------------------------------
create or replace function public.begin_match_generation(p_week_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
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

-- ----------------------------------------------------------------
-- 6. publish_week_allocation — production behaviour, forward-only.
--
--    Order of operations (each one matters):
--      validate input → lock fence row → reject unknown / future / stale
--      → replay binding → validate rows → lock the week's history rows
--      → activity check → week-scoped replace → update fence → return
--
--    Nothing is written before every check has passed, so a refusal leaves
--    the previous allocation exactly as it was.
-- ----------------------------------------------------------------
create or replace function public.publish_week_allocation(
  p_week_id    text,
  p_generation bigint,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_generation   bigint;
  published_generation bigint;
  stored_rows          jsonb;
  incoming_rows        jsonb := coalesce(p_rows, '[]'::jsonb);
  inserted             integer;
  existing_count       integer;
  row_value            jsonb;
begin
  -- 1. Input validation.
  if p_week_id is null or p_week_id = '' then
    raise exception 'publish_week_allocation: week id is required' using errcode = '22023';
  end if;
  if p_generation is null then
    raise exception 'publish_week_allocation: generation is required' using errcode = '22023';
  end if;
  if p_rows is not null and jsonb_typeof(p_rows) <> 'array' then
    raise exception 'publish_week_allocation: rows must be a json array' using errcode = '22023';
  end if;

  -- 2. Fence row lock: serialises publishers of THIS week for the rest of the
  --    transaction. Distinct weeks use distinct rows and never block each
  --    other.
  select latest_generation, latest_published_generation, published_rows
    into current_generation, published_generation, stored_rows
  from public.match_week_generations
  where week_id = p_week_id
  for update;

  if not found then
    raise exception 'unknown_generation' using errcode = 'P0002';
  end if;

  -- A generation that has not been authorised for this week can never publish.
  -- Only begin_match_generation mints a generation, so this is a caller error.
  if p_generation > current_generation then
    raise exception 'invalid_generation' using errcode = '22023',
      detail = format('generation %s was never authorised for week %s (latest authorised %s)',
                      p_generation, p_week_id, current_generation);
  end if;

  -- An older run must never overwrite a newer one. Checked before any write.
  -- PT409: an expected conflict, answered by PostgREST as HTTP 409.
  if p_generation < current_generation then
    raise exception using errcode = 'PT409', message = 'stale_generation';
  end if;

  -- REPLAY BINDING: one generation publishes exactly one allocation. Repeating
  -- an already published generation is accepted only when the payload is
  -- identical, and then it writes nothing at all. A different payload under
  -- the same generation is rejected, so a repeat can never silently replace an
  -- allocation that is already live.
  if p_generation = published_generation then
    if stored_rows is distinct from incoming_rows then
      raise exception using errcode = 'PT409', message = 'generation_conflict';
    end if;
    select count(*) into existing_count from public.match_history where week_id = p_week_id;
    return jsonb_build_object('published', existing_count, 'generation', p_generation, 'replayed', true);
  end if;

  -- 3. Row validation. Every row must identify a user and a delivery time;
  --    the ids must be uuids and the timestamp must be parseable. Validated
  --    before anything is locked or deleted.
  for row_value in select value from jsonb_array_elements(incoming_rows) loop
    if row_value->>'user_id' is null or btrim(row_value->>'user_id') = '' then
      raise exception 'publish_week_allocation: every row needs a user_id' using errcode = '22023';
    end if;
    begin
      perform (row_value->>'user_id')::uuid;
    exception when others then
      raise exception 'publish_week_allocation: a row has a user_id that is not a uuid' using errcode = '22023';
    end;

    if row_value->>'delivered_at' is null or btrim(row_value->>'delivered_at') = '' then
      raise exception 'publish_week_allocation: every row needs a delivered_at' using errcode = '22023';
    end if;
    begin
      perform (row_value->>'delivered_at')::timestamptz;
    exception when others then
      raise exception 'publish_week_allocation: a row has a delivered_at that is not a timestamp' using errcode = '22023';
    end;

    if coalesce(row_value->>'tier1_match_id', '') <> '' then
      begin
        perform (row_value->>'tier1_match_id')::uuid;
      exception when others then
        raise exception 'publish_week_allocation: a row has a tier1_match_id that is not a uuid' using errcode = '22023';
      end;
    end if;
    if coalesce(row_value->>'tier2_match_id', '') <> '' then
      begin
        perform (row_value->>'tier2_match_id')::uuid;
      exception when others then
        raise exception 'publish_week_allocation: a row has a tier2_match_id that is not a uuid' using errcode = '22023';
      end;
    end if;
  end loop;

  -- 4. Lock the week's existing history rows BEFORE inspecting activity, so no
  --    activity can be recorded between the check and the replacement.
  perform 1 from public.match_history where week_id = p_week_id for update;

  -- 5. Activity protection. Any user activity on the week makes it immutable,
  --    because replacing it would either cascade that activity away
  --    (match_signals) or be refused by the database (match_behavior).
  --    PT409: an expected refusal, answered by PostgREST as HTTP 409.
  if exists (
    select 1
      from public.match_signals s
      join public.match_history mh on mh.id = s.match_history_id
     where mh.week_id = p_week_id
  ) then
    raise exception using errcode = 'PT409', message = 'week_in_use';
  end if;

  if exists (
    select 1
      from public.match_behavior b
      join public.match_history mh on mh.id = b.match_history_id
     where mh.week_id = p_week_id
  ) then
    raise exception using errcode = 'PT409', message = 'week_in_use';
  end if;

  if exists (
    select 1
      from public.match_history mh
     where mh.week_id = p_week_id
       and (coalesce(mh.tier1_interaction, false) or coalesce(mh.tier2_interaction, false))
  ) then
    raise exception using errcode = 'PT409', message = 'week_in_use';
  end if;

  -- 6. Atomic week-scoped replacement. Historical weeks are unreachable by this
  --    predicate, and any failure rolls the delete back.
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

-- ----------------------------------------------------------------
-- 7. Execution privileges — exactly the production ACL: the owner and
--    service_role, nobody else.
-- ----------------------------------------------------------------
revoke all on function public.begin_match_generation(text) from public, anon, authenticated;
revoke all on function public.publish_week_allocation(text, bigint, jsonb) from public, anon, authenticated;

grant execute on function public.begin_match_generation(text) to service_role;
grant execute on function public.publish_week_allocation(text, bigint, jsonb) to service_role;

-- The generator reads the fence row back when a transport failure hides the
-- verdict; no client role ever sees fencing state.
grant select on public.match_week_generations to service_role;

comment on function public.publish_week_allocation(text, bigint, jsonb) is
  'Fenced, atomic replacement of one week of match_history. Raises 22023 invalid_generation for a generation that was never authorised, PT409 stale_generation when a newer run has been authorised, PT409 generation_conflict when the same generation is repeated with a different payload, and PT409 week_in_use when the week already holds user activity.';
