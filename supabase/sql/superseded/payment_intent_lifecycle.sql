-- ============================================================
-- PAYMENT INTENT LIFECYCLE — expiry + verifiable unlock state
-- Run in Supabase Dashboard → SQL Editor, AFTER product_flow_bundle.sql
-- (1.6), which adds payment_intents.purpose / recipient_user_id that the
-- audit view reads. Idempotent: safe to re-run.
--
-- WHY THIS FILE EXISTS
-- payment-callback could claim in its header that a callback is
-- "genuine, idempotent, and re-verified", but nothing in the schema
-- let anyone CHECK that afterwards:
--   * a pending intent had no expiry, so a callback could still
--     unlock long after the STK push was dead, and abandoned intents
--     stayed 'pending' forever (poisoning the rate-limit window and
--     the admin funnel);
--   * 'expired' was not a legal status, so a dead intent had no
--     terminal state to move to;
--   * nothing recorded WHICH guard passed, WHAT the async
--     transaction-status re-verify returned, or WHETHER the unlock
--     actually happened. A callback could fail its unlock, take the
--     money, log nothing, and look identical to a success.
--
-- WHAT THIS ADDS
--   A. depends-on: callback_key + processed_payment_callbacks. Both are
--      declared in harden_resilience.sql, which is marked STAGING ONLY
--      and is absent from DEPLOYMENT-CHECKLIST.md — so on any database
--      where that file never ran, the callback's key check was skipped
--      (the `if (intent.callback_key && ...)` guard is false when the
--      column is missing) and the idempotency insert failed, which the
--      function mistook for "someone else is processing" and returned
--      without unlocking. Declaring them here makes the payment path
--      work on a database built from the checklist alone.
--   B. payment_intents.expires_at — the window a callback may unlock in,
--      with the window itself defined once, by
--      public.payment_intent_window().
--   C. a status vocabulary that includes 'expired'.
--   D. recorded ticket / verification / unlock state per intent,
--      so 'it unlocked' is a queryable fact rather than a comment.
--   E. public.payment_intent_expiry_state() — the ONE place the expiry
--      comparison exists. The sweep below, the audit view below it, and the
--      payment-callback edge function all ASK this function instead of
--      comparing timestamps themselves, so the rule cannot drift between
--      them. It is SECURITY INVOKER and revoked from clients, so it answers
--      only for callers that can already see the row (service_role, the SQL
--      editor) — it is not an oracle for arbitrary intent ids.
--   F. expire_stale_payment_intents() — the terminal transition: it moves
--      exactly the rows that function calls 'expired'.
--   G. payment_intent_anomalies — the read-only audit surface.
--
-- VERIFY AFTER RUNNING: see section G.
-- ============================================================

-- ------------------------------------------------------------
-- A. Dependencies of the callback's verification path.
--    (No-ops where harden_resilience.sql already applied them.)
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists callback_key text;

create table if not exists public.processed_payment_callbacks (
  cache_key text primary key,
  created_at timestamptz not null default now()
);

alter table public.processed_payment_callbacks enable row level security;
-- Clients never read or write the cache — zero policies.

-- ------------------------------------------------------------
-- B. Expiry. A push that nobody answered must not be unlockable
--    hours later: Daraja's STK prompt is dead within minutes, so a
--    callback after this window is not evidence of a live payment.
--    initiate-payment does not set expires_at, so this column is the
--    single source of truth — and the window it is built from is
--    defined once, here, and referenced by both statements below.
-- ------------------------------------------------------------
create or replace function public.payment_intent_window()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;

comment on function public.payment_intent_window() is
  'The one definition of the STK window. The default on payment_intents.expires_at and the backfill below both call it, so the two can never disagree, and changing the window is a one-line change here.';

alter table public.payment_intents
  add column if not exists expires_at timestamptz;

-- Existing rows: derive from created_at, never from now() — an old
-- pending intent must come out already expired, not freshly alive.
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
-- C. Status vocabulary gains the terminal state for a dead push.
-- ------------------------------------------------------------
alter table public.payment_intents drop constraint if exists payment_intents_status_check;
alter table public.payment_intents add constraint payment_intents_status_check
  check (status in ('pending','succeeded','failed','expired'));

-- ------------------------------------------------------------
-- D. Per-intent evidence. Every column here answers a question an
--    operator or a test can ask without reading the function source.
-- ------------------------------------------------------------
alter table public.payment_intents
  -- Which ticket guard the callback evaluated: 'verified' (per-intent
  -- key matched), 'missing_key', 'wrong_key', 'no_key_on_intent'
  -- (column present but the intent predates it), or NULL (never seen).
  add column if not exists ticket_state text;

alter table public.payment_intents
  -- Why the intent ended up failed/expired (amount mismatch, Daraja
  -- failure code, callback after expiry). Previously console-only.
  add column if not exists status_reason text;

alter table public.payment_intents
  -- When the async Daraja transaction-status query was enqueued.
  add column if not exists verification_requested_at timestamptz,
  -- ConversationID Daraja returns in the query ACK; the async result
  -- quotes it back, and it is the only way to attach a "no such
  -- transaction" answer (which carries no receipt) to its intent.
  add column if not exists verification_conversation_id text,
  -- 'pending' | 'confirmed' | 'contradicted' | 'unavailable'
  add column if not exists verification_state text,
  -- Daraja's ResultCode/ResultDesc/receipt, verbatim.
  add column if not exists verification_detail text,
  add column if not exists verified_at timestamptz;

alter table public.payment_intents
  -- Did the thing the money bought actually come into existence?
  -- 'applied' | 'failed' | 'no_effect' (the RPC declined: not paired,
  -- recipient gone) — verified against the target table, not assumed.
  add column if not exists unlock_state text,
  add column if not exists unlock_applied_at timestamptz,
  add column if not exists unlock_error text;

alter table public.payment_intents
  -- A genuine callback that arrived after expires_at: recorded for
  -- reconciliation, deliberately NOT unlocked.
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
-- E. The expiry verdict — asked, never re-derived. Everything that
--    needs to know whether the window has closed goes through here:
--      * payment-callback calls it via rpc() and acts on the answer;
--      * the sweep below calls it to decide what to terminalise;
--      * the audit view below calls it to label anomalies.
--    Two arguments, and the second exists only so a test can pin a
--    moment; production callers pass the id alone and the database
--    supplies its own now(), so no caller can move the window.
-- ------------------------------------------------------------
create or replace function public.payment_intent_expiry_state(
  p_intent_id uuid,
  p_at timestamptz default now()
)
returns text
language sql
stable
-- SECURITY INVOKER on purpose: RLS decides visibility, so this cannot be
-- used to learn the state of an intent the caller cannot already read.
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

-- ------------------------------------------------------------
-- F. Terminal transition for abandoned pushes. Nothing calls this
--    today; wire it to pg_cron (or a scheduled edge function) when
--    one exists — until then the callback still refuses expired
--    intents on its own, so safety does not depend on the sweep.
--      select cron.schedule('expire-payment-intents', '*/10 * * * *',
--                           'select public.expire_stale_payment_intents()');
-- ------------------------------------------------------------
create or replace function public.expire_stale_payment_intents()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- The predicate is the shared verdict, not a second copy of it: this
  -- sweeps exactly what payment_intent_expiry_state() calls 'expired'.
  update public.payment_intents
     set status = 'expired'
   where status = 'pending'
     and public.payment_intent_expiry_state(id) = 'expired';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_stale_payment_intents() from anon, authenticated, public;
grant execute on function public.expire_stale_payment_intents() to service_role;

-- ------------------------------------------------------------
-- G. The audit surface. security_invoker so the caller's RLS applies:
--    clients hold no policy on payment_intents and therefore see
--    nothing; service_role and the SQL editor see everything.
-- ------------------------------------------------------------
create or replace view public.payment_intent_anomalies
with (security_invoker = true) as
select *
from (
  select
    pi.id,
    pi.user_id,
    pi.purpose,
    pi.status,
    pi.amount,
    pi.phone,
    pi.mpesa_transaction_id,
    pi.created_at,
    pi.expires_at,
    pi.ticket_state,
    pi.verification_state,
    pi.verification_detail,
    pi.unlock_state,
    pi.unlock_applied_at,
    pi.unlock_error,
    pi.late_callback_at,
    -- Precedence: a contradicted verification is reported ahead of the
    -- unlock outcome, because it questions whether the payment was real at
    -- all; every unlock column is in the view either way, so nothing is
    -- hidden by the ordering.
    case
      when pi.status = 'succeeded' and pi.verification_state = 'contradicted'
        then 'verification_contradicted'
      when pi.status = 'succeeded' and coalesce(pi.unlock_state, '') <> 'applied'
        then 'paid_but_not_unlocked'
      when pi.late_callback_at is not null
        then 'late_genuine_callback'
      when pi.ticket_state is not null and pi.ticket_state <> 'verified'
        then 'unverified_ticket'
      when pi.status = 'pending'
           and public.payment_intent_expiry_state(pi.id) = 'expired'
        then 'pending_past_expiry'
      else null
    end as anomaly
  from public.payment_intents pi
) a
where a.anomaly is not null;

revoke all on public.payment_intent_anomalies from anon, authenticated;
grant select on public.payment_intent_anomalies to service_role;

-- ------------------------------------------------------------
-- H. Verify — run these after applying.
--
--   -- The window is defined in ONE place. This must print a default that
--   -- names payment_intent_window(), not a literal interval:
--   select pg_get_expr(ad.adbin, ad.adrelid) as expires_at_default
--     from pg_attrdef ad
--     join pg_attribute a on a.attrelid = ad.adrelid and a.attnum = ad.adnum
--    where ad.adrelid = 'public.payment_intents'::regclass
--      and a.attname = 'expires_at';
--
--   -- The COMPARISON is defined in ONE place. Both of these must return
--   -- zero rows; a row here is a second copy of the rule that can drift:
--   select p.proname from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname <> 'payment_intent_expiry_state'
--      and p.prosrc ~ '[^_]expires_at\s*<';
--   select c.relname from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind in ('v','m')
--      and pg_get_viewdef(c.oid) ~ '[^_]expires_at\s*<';
--
--   -- One caller in the edge function, and it passes no clock:
--   --   grep -n 'payment_intent_expiry_state' \
--   --     supabase/functions/payment-callback/index.ts
--
--   -- B/C: the window and the terminal state exist
--   select column_name, column_default, is_nullable
--     from information_schema.columns
--    where table_name = 'payment_intents'
--      and column_name in ('expires_at','ticket_state','unlock_state');
--
--   -- D: a stale pending intent expires, nothing else moves
--   select public.expire_stale_payment_intents();   -- pending rows past expires_at
--   select status, count(*) from public.payment_intents group by status;
--
--   -- F: the audit surface is empty on a healthy database
--   select * from public.payment_intent_anomalies;
--   -- expect: paid_but_not_unlocked == 0 for every row settled in the
--   -- cookie-book after this change, because the callback now verifies
--   -- the effect before recording success.
-- ============================================================
