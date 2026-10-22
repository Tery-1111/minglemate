-- ============================================================
-- PRODUCTION BASELINE (3 of 3) — PAYMENT-INTENT LIFECYCLE COMPATIBILITY
--
-- Target: project `minglemate`, ref mhdjnhiqahsllbczbzpk.
-- Runs AFTER 20261022160000_production_section2_contacts.sql.
--
-- WHY THIS FILE EXISTS
--   The deployed payment-callback (v1, verify_jwt=false) asks the database
--   for an expiry verdict and writes per-intent bookkeeping:
--
--     rpc('payment_intent_expiry_state', { p_intent_id })
--     payment_intents.expires_at / ticket_state / status_reason /
--     verification_requested_at / verification_conversation_id /
--     verification_state / verification_detail / verified_at /
--     unlock_state / unlock_applied_at / unlock_error / late_callback_at
--     status = 'expired'
--
--   Production has none of those columns, its status CHECK admits only
--   pending|succeeded|failed, and the RPC does not exist. The callback
--   therefore recorded the expiry verdict as 'unavailable' (a fallback, not
--   enforcement) and every bookkeeping UPDATE failed silently — the exact
--   "paid but nothing recorded" state the lifecycle design exists to stop.
--
-- WHAT THIS FILE DOES — the smallest schema that makes the deployed code
-- work as intended, and nothing else:
--   1. Preflight: refuses to run if the table or the idempotency cache is
--      missing, or if a conflicting expiry overload already exists.
--   2. public.payment_intent_window() + payment_intents.expires_at, with
--      the window defined once and existing rows backfilled from
--      created_at (never from now()).
--   3. Admits 'expired' to the status vocabulary.
--   4. Adds the callback's bookkeeping columns and the three state CHECKs
--      whose value sets the callback actually writes.
--   5. public.payment_intent_expiry_state(uuid, timestamptz default now())
--      — SECURITY INVOKER, so RLS decides visibility; not an oracle.
--   6. Post-check: every column, constraint, default, function and grant
--      is asserted inside the same transaction. Any failure rolls the
--      whole file back.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * No sweep (expire_stale_payment_intents) and no
--     payment_intent_anomalies view: nothing in production calls them, so
--     they are not needed for the callback to work. They can follow as a
--     separate, operator-facing change.
--   * No DROP of any table or column, no UPDATE except the expires_at
--     backfill, no DELETE, no entitlement change. payment_intents is empty
--     on production today; the backfill is a no-op there.
--   * No payment record is created, consumed or reinterpreted.
--   * No change to the Section 2 / Connect / Force Connect rules.
--
-- PROVENANCE
--   The staging source of the same design is
--   supabase/sql/superseded/payment_intent_lifecycle.sql. This file is NOT
--   a copy: staging's version also created the sweep and the audit view,
--   and it depended on harden_resilience.sql. Here the DDL is additive,
--   self-guarded and scoped to production's live shape.
--
-- NOT IN supabase/migrations/ ON PURPOSE — production was adopted on
--   baseline objects, not on the chain. The chain guard
--   (20260901000000_production_chain_replay_guard.sql) aborts a push.
--
-- STATUS: APPLIED to minglemate (mhdjnhiqahsllbczbzpk) on 2026-10-22 —
--         recorded as version 20261022170000 in
--         supabase_migrations.schema_migrations. The expiry verdict returns
--         live/expired/no_intent for the constructed cases, status 'expired'
--         is accepted, a full bookkeeping write lands, a bad unlock_state is
--         rejected, and the deployed callback recorded a genuine late
--         callback (status expired + status_reason + late_callback_at, no
--         unlock) and a live no-effect callback (succeeded + unlock_state
--         no_effect + the missing Daraja config named) over HTTP 200. All
--         test rows were removed; row counts returned to baseline.
--         See GATES.md gates 55–66 and
--         docs/PRODUCTION_PAYMENT_INTENT_LIFECYCLE.md.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Preflight
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
  conflicting regprocedure;
begin
  if to_regclass('public.payment_intents') is null then
    missing := array_append(missing, 'table public.payment_intents');
  end if;
  if to_regclass('public.processed_payment_callbacks') is null then
    missing := array_append(missing, 'table public.processed_payment_callbacks');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      '20261022170000 cannot run: %. Nothing was changed.',
      array_to_string(missing, '; ');
  end if;

  -- A same-named function with a different signature would create an
  -- ambiguous overload, and a one-argument overload would make PostgREST's
  -- rpc('payment_intent_expiry_state', {p_intent_id}) ambiguous. Refuse
  -- rather than guess.
  select p.oid::regprocedure into conflicting
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'payment_intent_expiry_state'
    -- to_regprocedure (not a cast) so an absent function is NULL, not an
    -- error, before the function exists.
    and p.oid is distinct from
        to_regprocedure('public.payment_intent_expiry_state(uuid,timestamptz)')
  limit 1;

  if conflicting is not null then
    raise exception
      '20261022170000 cannot run: conflicting function % already exists. Nothing was changed.',
      conflicting;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. The window, defined once
-- ------------------------------------------------------------
create or replace function public.payment_intent_window()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;

comment on function public.payment_intent_window() is
  'The one definition of the STK window. The payment_intents.expires_at default and the backfill both call it, and payment_intent_expiry_state() is the only comparison, so the rule has a single source.';

alter table public.payment_intents
  add column if not exists expires_at timestamptz;

-- Existing rows derive from created_at, never from now(): an old pending
-- intent must come out already expired, not freshly alive.
update public.payment_intents
   set expires_at = created_at + public.payment_intent_window()
 where expires_at is null;

alter table public.payment_intents
  alter column expires_at set default (now() + public.payment_intent_window());

do $$
begin
  if exists (select 1 from public.payment_intents where expires_at is null) then
    raise notice 'payment_intents: NULL expires_at rows remain — column left nullable.';
  else
    alter table public.payment_intents alter column expires_at set not null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Status vocabulary gains the terminal state for a dead push
-- ------------------------------------------------------------
alter table public.payment_intents
  drop constraint if exists payment_intents_status_check;

alter table public.payment_intents
  add constraint payment_intents_status_check
  check (status in ('pending','succeeded','failed','expired'));

-- ------------------------------------------------------------
-- 4. Per-intent evidence — every column the callback writes
-- ------------------------------------------------------------
alter table public.payment_intents
  -- Which ticket guard the callback evaluated.
  add column if not exists ticket_state text,
  -- Why the intent ended up failed/expired (amount mismatch, Daraja code,
  -- callback after expiry). Previously console-only.
  add column if not exists status_reason text,
  -- When the async Daraja transaction-status query was enqueued.
  add column if not exists verification_requested_at timestamptz,
  -- ConversationID from the query ACK; the async result quotes it back.
  add column if not exists verification_conversation_id text,
  -- 'pending' | 'confirmed' | 'contradicted' | 'unavailable'
  add column if not exists verification_state text,
  -- Daraja's ResultCode/ResultDesc/receipt, verbatim.
  add column if not exists verification_detail text,
  add column if not exists verified_at timestamptz,
  -- Did the thing the money bought actually come into existence?
  -- 'applied' | 'failed' | 'no_effect'
  add column if not exists unlock_state text,
  add column if not exists unlock_applied_at timestamptz,
  add column if not exists unlock_error text,
  -- A genuine callback after expires_at: recorded for reconciliation,
  -- deliberately NOT unlocked.
  add column if not exists late_callback_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_intents_verification_state_check'
      and conrelid = 'public.payment_intents'::regclass
  ) then
    alter table public.payment_intents
      add constraint payment_intents_verification_state_check
      check (verification_state is null or verification_state in
             ('pending','confirmed','contradicted','unavailable'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_intents_unlock_state_check'
      and conrelid = 'public.payment_intents'::regclass
  ) then
    alter table public.payment_intents
      add constraint payment_intents_unlock_state_check
      check (unlock_state is null or unlock_state in
             ('applied','failed','no_effect'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_intents_ticket_state_check'
      and conrelid = 'public.payment_intents'::regclass
  ) then
    alter table public.payment_intents
      add constraint payment_intents_ticket_state_check
      check (ticket_state is null or ticket_state in
             ('verified','missing_key','wrong_key','no_key_on_intent'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. The expiry verdict — asked, never re-derived
--    SECURITY INVOKER on purpose: RLS decides visibility, so this cannot
--    be used to learn the state of an intent the caller cannot see.
--    The optional second argument exists so a test can pin a moment;
--    production callers pass the id alone and the database supplies now().
-- ------------------------------------------------------------
create or replace function public.payment_intent_expiry_state(
  p_intent_id uuid,
  p_at timestamptz default now()
)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
           when r.id is null then 'no_intent'
           when r.expires_at is null then 'no_window'
           when coalesce(p_at, now()) >= r.expires_at then 'expired'
           else 'live'
         end
  from (select 1) d
  -- left join so an absent intent still yields exactly one row
  left join (
    select id, expires_at from public.payment_intents where id = p_intent_id
  ) r on true
$$;

revoke all on function public.payment_intent_expiry_state(uuid, timestamptz)
  from anon, authenticated, public;
grant execute on function public.payment_intent_expiry_state(uuid, timestamptz)
  to service_role;

comment on function public.payment_intent_expiry_state(uuid, timestamptz) is
  'The one expiry comparison for payment intents. payment-callback asks this and acts on the answer; it does not compare expires_at itself.';

-- ------------------------------------------------------------
-- 6. Post-check — a failed assertion rolls back the whole file
-- ------------------------------------------------------------
do $$
declare
  expected_columns text[] := array[
    'expires_at','ticket_state','status_reason',
    'verification_requested_at','verification_conversation_id',
    'verification_state','verification_detail','verified_at',
    'unlock_state','unlock_applied_at','unlock_error','late_callback_at'
  ];
  missing_columns text[];
  status_def text;
  default_expr text;
  verdict text;
begin
  select array_agg(c) into missing_columns
  from unnest(expected_columns) c
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payment_intents'
      and column_name = c
  );

  if missing_columns is not null then
    raise exception 'post-check: missing columns %', missing_columns;
  end if;

  select pg_get_constraintdef(oid) into status_def
  from pg_constraint
  where conrelid = 'public.payment_intents'::regclass
    and conname = 'payment_intents_status_check';

  if status_def is null or position('expired' in status_def) = 0 then
    raise exception 'post-check: status CHECK does not admit expired (got %)', status_def;
  end if;

  select pg_get_expr(ad.adbin, ad.adrelid) into default_expr
  from pg_attrdef ad
  join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
  where ad.adrelid = 'public.payment_intents'::regclass
    and a.attname = 'expires_at';

  if default_expr is null or position('payment_intent_window' in default_expr) = 0 then
    raise exception 'post-check: expires_at default does not use payment_intent_window() (got %)', default_expr;
  end if;

  verdict := public.payment_intent_expiry_state(gen_random_uuid());
  if verdict <> 'no_intent' then
    raise exception 'post-check: expiry verdict for an unknown id was %, expected no_intent', verdict;
  end if;

  if has_function_privilege('anon', 'public.payment_intent_expiry_state(uuid, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.payment_intent_expiry_state(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'post-check: expiry verdict is executable by a client role';
  end if;

  if not has_function_privilege('service_role', 'public.payment_intent_expiry_state(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'post-check: service_role cannot execute the expiry verdict';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_intents'::regclass
      and conname in ('payment_intents_verification_state_check',
                      'payment_intents_unlock_state_check',
                      'payment_intents_ticket_state_check')
    group by conrelid having count(*) = 3
  ) then
    raise exception 'post-check: one or more state CHECKs are missing';
  end if;
end $$;
