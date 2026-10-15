-- ============================================================
-- CONSOLIDATED SCHEMA CHAIN — the single entrypoint for this schema.
--
-- Replaces, in one dependency-ordered file, the bundles and migrations that
-- previously had to be applied in a particular order by hand. Several objects
-- were declared in two or three of them (payment_intents.callback_key,
-- processed_payment_callbacks, enforce_message_rate_limit, the messages and
-- matches policies, profiles_public, my_profile, complete_connect_unlock,
-- get_unlocked_contacts, handle_new_user, the matches table and its index, the
-- Section 2 entitlement columns). Each is now defined exactly once, by the
-- stage that owns it, with the copy that the documented deployment order
-- (DEPLOYMENT-CHECKLIST.md steps 1.1–1.11) left live.
--
-- HOW TO APPLY
--   * Supabase CLI:  supabase db push      (this file's timestamp sorts after
--                                           every file it replaces)
--   * SQL editor:    paste this whole file and run it — it is one script.
--   * Re-running is safe: every statement is IF NOT EXISTS / create-or-replace
--     / drop-if-exists, so a second run changes nothing.
--
-- THE ALERT CHANNEL (optional, and the only out-of-band setup this chain needs)
--   The payment stage schedules public.payment_ops_tick() every five minutes:
--   it expires abandoned M-Pesa pushes, turns a paid-but-not-unlocked intent or
--   an entitlement whose evidence does not support it into an alert, and
--   delivers that alert so it reaches a person instead of waiting for someone
--   to run a query. Delivery needs two things the SQL editor can do:
--     * the pg_cron and pg_net extensions (Dashboard -> Database -> Extensions)
--       — pg_cron for the schedule, pg_net for the webhook call. Without
--       pg_cron the chain still applies: it prints the one cron.schedule
--       statement to run once the extension is on.
--     * the webhook URL, in Vault rather than in this file:
--         select vault.create_secret('<your webhook url>',
--                                    'OPS_ALERT_WEBHOOK_URL');
--       Slack, Discord and Telegram all accept the body this sends. Without
--       the secret nothing breaks: the alerts are still recorded in
--       public.ops_alerts, each row says why it could not be delivered, and
--       inspect_state.sql reports the undelivered count.
--
-- RETIRED SOURCES: the scripts this chain replaces are kept verbatim under
-- supabase/sql/superseded/ for provenance only. Do not run them. Re-applying one
-- after the chain can re-open a defect the chain closes: harden_resilience.sql
-- re-creates the rate-limit function counting by messages.created_at, a column
-- that does not exist, so every message insert would fail with 42703 again, and
-- the profile copies would re-collide on profiles_public, whose column list
-- Postgres will not change. supabase/sql/inspect_state.sql lists them once, as
-- retired, instead of as scripts with a verdict of their own.
--
-- PRECONDITIONS (a normal Supabase project already has these; this chain does
-- not create them):
--   * auth.users, auth.uid()
--   * public.users with the app's profile columns (age, bio, interests,
--     residence_type, display_phone, looking_for, campus_id, ...) — the chain
--     adds only the columns the app's own scripts introduced
--   * public.user_responses, public.messages (timestamp column sent_at),
--     public.section2_chat_progress, public.campuses, public.notifications
--   * public.match_history — the legacy weekly-engine table (user_id,
--     tier1_match_id, tier2_match_id). No file in this repository creates it,
--     but three functions below read it, so it must already exist; on a
--     brand-new project run the weekly engine's original DDL first. The chain
--     never writes it and never changes it.
--   * the pgcrypto extension (gen_random_uuid)
--
-- WHAT IT DOES NOT OWN: supabase/sql/inspect_state.sql (the read-only verdict
-- tool — run it after this), audit_rls.sql and seed_test_sessions.sql
-- (diagnostic and seed helpers), and the edge functions, deployed separately.
--
-- VERIFY AFTER RUNNING: supabase/sql/inspect_state.sql must report this file
-- APPLIED with no missing object, section 08 CRON must show the
-- payment-ops-tick schedule (and, if any alert was raised, that it was
-- delivered), section 10 ENTITLEMENTS must show the recorder coverage as ok
-- with no live finding, `select * from public.entitlement_evidence_anomalies`
-- must return no row, and scripts/verify-payment-ticket.mjs pins the payment
-- behaviour this chain defines. Editing this file? Run
-- `node scripts/check-schema-chain.mjs` — it needs no database and no
-- dependencies, and it fails if an object is defined twice, if a stage moves
-- out of order, or if one of the defects this chain removes comes back
-- (the messages.created_at rate limit, a display_phone-wide users grant, a
-- second copy of the 30-minute window). It also guards stage 6's own
-- invariants: that every grant path still carries the recorder, that each one
-- still states its reason, that the ledger has exactly one writer, and that no
-- grant kind can be recorded without a rule saying what justifies it.
-- ============================================================

-- ============================================================
-- STAGE 1 — identity, base tables and resilience
-- users RLS and the signup path (minus handle_new_user, which the
-- entitlement stage owns), the answers-column fix, the dead bot trigger,
-- the entitlement columns, payment_intents itself, the base tables the
-- later stages read (user_blocks, reports), then the database-side rate
-- limits and app settings.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/fix_rls.sql ----------

-- ============================================================
-- FIX: RLS policies for `users` and `user_responses`
-- Run in Supabase Dashboard → SQL Editor.
-- Idempotent: drops then recreates each policy, so it is safe
-- to run regardless of the current live state.
--
-- Part 1 fixes the signup bug (profile row creation via trigger)
-- Part 2 locks Section 1 answers to their owner
-- ============================================================

-- ============================================================
-- PART 1 — users table
-- ============================================================

-- 1a. Auto-create the profile row when a user signs up.
--     SECURITY DEFINER bypasses RLS, so this works even while
--     the user has no session yet (email-confirmation flow).
-- 1a. handle_new_user() and the on_auth_user_created trigger are NOT defined
--     here: the entitlement stage below owns them — one definition, the
--     clamp-aware version that grants the 14-day Section 2 trial server-side.

-- 1b. Explicit policies (replace whatever exists — idempotent)

-- Anyone logged in can read profiles (core matchmaking feature).
-- NOTE: this exposes ALL columns incl. onesignal_player_id and
-- payment fields. Consider a view with selected columns later.
-- The live project carries seven policies on public.users (F3). The three
-- below replace them, so the live names are dropped here — an apply that does
-- not drop them leaves both sets in force and the widest one wins. RLS is
-- switched on in the same place, because until now nothing in this chain
-- enabled it on this table.
alter table public.users enable row level security;
drop policy if exists "Allow public read access for active profiles" on public.users;
drop policy if exists "Users can read matched users profiles" on public.users;
drop policy if exists "Users can read own profile" on public.users;
drop policy if exists "Allow background system creation during signup" on public.users;
drop policy if exists "Users can insert own profile" on public.users;
drop policy if exists "Allow users to modify their own specific profile rows" on public.users;
drop policy if exists "Users can update own profile" on public.users;

drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);

-- Logged-in users may insert their OWN profile row
-- (covers signup when email confirmation is disabled).
drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

-- Users may update only their own profile.
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================
-- PART 2 — user_responses table (Section 1 answers)
-- ============================================================

-- Ensure RLS is actually ON for this table.
alter table public.user_responses enable row level security;

-- Answers are private: owner-only for all operations.
-- (The match-generator edge function uses the service role key,
--  which bypasses RLS — matching keeps working.)
drop policy if exists "responses_select_own" on public.user_responses;
create policy "responses_select_own"
  on public.user_responses for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "responses_insert_own" on public.user_responses;
create policy "responses_insert_own"
  on public.user_responses for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "responses_update_own" on public.user_responses;
create policy "responses_update_own"
  on public.user_responses for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- DONE. Verify with audit_rls.sql afterwards.
--
-- Caveats to review manually:
--  * If any feature intentionally shows a MATCH's answers to the
--    other user (e.g. Section 2 comparison), that table needs a
--    scoped sharing policy via match_history — not a blanket one.
--  * If signup still shows an error after this, it is the client
--    upsert in Signup.jsx hitting the (now-correct) RLS wall as
--    anon — the trigger has already created the row, so the app
--    code should tolerate that error.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/fix_responses_column.sql ----------

-- ============================================================
-- FIX: user_responses.responses_array type — integer[] → text[]
-- Run standalone in Supabase Dashboard → SQL Editor (any time,
-- before or after the other bundles; no dependencies).
-- Safe to re-run (checks current type first).
--
-- WHY: The adopted 50-question engine (match-generator →
-- compatibilityEngine.ts) compares ANSWER TEXT between users
-- (answersAreSimilar: word-overlap on option strings).
-- Section1.jsx correctly writes option text, but the column is
-- still integer[] from the old 40-question index system, so every
-- answer insert fails with:
--   22P02 invalid input syntax for type integer
-- Existing data (if any) is numeric indices from the old system;
-- the cast preserves them as text (they simply read as stale
-- indices the UI ignores — string answers never equal an index).
-- ============================================================

do $$
declare
  col_type text;
begin
  select data_type
    into col_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_responses'
     and column_name  = 'responses_array';

  if col_type is null then
    raise notice 'user_responses.responses_array not found — nothing to do';
  elsif col_type = 'ARRAY' then
    select format_type(a.atttypid, a.atttypmod)
      into col_type
      from pg_attribute a
     where a.attrelid = 'public.user_responses'::regclass
       and a.attname  = 'responses_array'
       and not a.attisdropped;

    if col_type = 'integer[]' or col_type = 'int4[]' or col_type = 'bigint[]' then
      alter table public.user_responses
        alter column responses_array type text[]
        using responses_array::text[];
      raise notice 'responses_array migrated to text[] ✓';
    else
      raise notice 'responses_array is already % — nothing to do', col_type;
    end if;
  else
    raise notice 'responses_array is non-array type % — inspect manually', col_type;
  end if;
end
$$;

-- If RLS was somehow disabled on this table, keep it locked
-- (owner-only answers — mirrors supabase/sql/superseded/fix_rls.sql Part 2).
alter table public.user_responses enable row level security;

-- ---------- folded from supabase/sql/superseded/fix_bot_question_trigger.sql ----------

-- fix_bot_question_trigger.sql
--
-- CONFIRMED DEFECT: trg_auto_bot_question (AFTER INSERT on messages) runs
-- handle_bot_question_trigger(), which queries section2_chat_progress by
-- match_week_id — a column that table does not have — so EVERY message
-- insert fails with 42703 (column "match_week_id" does not exist) once this
-- trigger exists. Its body is also an early prototype: it inserts literal
-- 'Question N of 20: [Insert Question Text]' placeholder rows.
--
-- The shipping bot-question flow is client-side (Chat.jsx sendBotQuestion,
-- driven by section2_chat_progress keyed on user_id_a/user_id_b), so this
-- DB trigger is dead legacy code whose only possible effect was to break
-- every message insert. Fix = drop the trigger. The function definition is
-- left in place (harmless without its trigger).

drop trigger if exists trg_auto_bot_question on public.messages;

-- ------------------------------------------------------------
-- The Section 2 entitlement columns. In the original ordering these were
-- added by the last migration, AFTER the views and policies that read them;
-- here they exist before anything else in the chain refers to them.
-- ------------------------------------------------------------
--    live database these statements are no-ops.
-- ------------------------------------------------------------
alter table public.users
  add column if not exists section2_unlocked boolean not null default false;

alter table public.users
  add column if not exists section2_free_expires_at timestamptz;

-- ---------- folded from supabase/sql/superseded/remediation_bundle.sql ----------

-- ============================================================
-- REMEDIATION BUNDLE: payment_intents table + remaining RLS
-- (C2/C3/C4, H7, H8, M4) — run in Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. payment_intents — server-side record of every STK push.
--    initiate-payment inserts; payment-callback consumes.
-- ------------------------------------------------------------
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed')),
  checkout_request_id text unique,
  mpesa_transaction_id text unique,
  created_at timestamptz not null default now()
);

alter table public.payment_intents enable row level security;

-- Clients never read or write intents directly — zero policies.
-- Edge functions use the service role (bypasses RLS).

-- Rate-limit window queries need an index
create index if not exists payment_intents_user_created_idx
  on public.payment_intents (user_id, created_at desc);

-- ------------------------------------------------------------
-- 2. Idempotent purchases (M4): one row per M-Pesa receipt.
--    unique on payment_intents.mpesa_transaction_id above;
--    token_purchases gets the same treatment.
--    (If the table already has duplicates this will fail —
--     dedupe first: delete dupes keeping min(created_at).)
-- ------------------------------------------------------------
do $$
begin
  begin
    alter table public.token_purchases
      add constraint token_purchases_txn_unique unique (mpesa_transaction_id);
  exception when duplicate_table or undefined_table then null;
  end;
end $$;

-- ------------------------------------------------------------
-- 3. messages RLS (H7): participants read; sender = auth.uid()
--    on insert; no client updates/deletes.
-- ------------------------------------------------------------
alter table public.messages enable row level security;

-- 3. The messages policies are NOT defined here: product_flow_bundle (1.6)
--    replaced both — participants-only SELECT plus archived-conversation
--    hiding, and an INSERT check that also honours blocks and locked or
--    unmatched conversations. One definition, and it is the one that was
--    live after step 1.6.

-- ------------------------------------------------------------
-- 4. section2_chat_progress RLS (H8): participants only, and
--    contacts_unlocked can never be client-set to true — the
--    server trigger derives it from questions_discussed.
-- ------------------------------------------------------------
alter table public.section2_chat_progress enable row level security;

drop policy if exists "progress_select_participants" on public.section2_chat_progress;
create policy "progress_select_participants"
  on public.section2_chat_progress for select
  to authenticated
  using (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

drop policy if exists "progress_insert_participants" on public.section2_chat_progress;
create policy "progress_insert_participants"
  on public.section2_chat_progress for insert
  to authenticated
  with check (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

drop policy if exists "progress_update_participants" on public.section2_chat_progress;
create policy "progress_update_participants"
  on public.section2_chat_progress for update
  to authenticated
  using (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

-- Server-side truth for the paywall flag (H8)
create or replace function public.enforce_contacts_unlocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The same role test clamp_user_protected_columns uses, copied verbatim.
  -- PostgREST exposes the request's role as `request.jwt.claim.role`
  -- (legacy, per-claim) and inside the `request.jwt.claims` JSON.
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_is_client boolean;
begin
  -- A client write is one that carries a user JWT and is not the service
  -- role. Server code and internal triggers carry no user JWT (auth.uid()
  -- is null), so they pass through unchanged.
  v_is_client := auth.uid() is not null and v_role <> 'service_role';

  if v_is_client then
    -- Contacts are opened by a payment and by nothing else (F1). The question
    -- counter is not a reveal, so a client write can no longer set the flag:
    -- an INSERT starts locked, an UPDATE keeps whatever the server wrote.
    if tg_op = 'INSERT' then
      new.contacts_unlocked := false;
    else
      new.contacts_unlocked := old.contacts_unlocked;
    end if;
    return new;
  end if;

  -- Server paths are unchanged. The reveal is a grant, and the rule states
  -- its own reason: the recorder would otherwise mark every unlock "no
  -- explicit reason recorded" — which is true of a hand-granted campus flag
  -- and false of a threshold the product set.
  if coalesce(new.questions_discussed, 0) >= 14
     and not coalesce(new.contacts_unlocked, false) then
    perform public.set_entitlement_context(
      'chat_contacts_unlocked',
      'the 14th question for this pair was discussed: the free contact reveal is the product threshold, not a decision',
      'public.section2_chat_progress',
      new.id::text);
  end if;
  new.contacts_unlocked := (coalesce(new.questions_discussed, 0) >= 14);
  return new;
end;
$$;

drop trigger if exists trg_contacts_unlocked on public.section2_chat_progress;
create trigger trg_contacts_unlocked
  before insert or update on public.section2_chat_progress
  for each row execute function public.enforce_contacts_unlocked();

-- ------------------------------------------------------------
-- 5. Note: Chat.jsx's "14+ questions" threshold matches this
--    trigger's constant. If you change one, change both.
-- ------------------------------------------------------------

-- ---------- moved here from the product-flow stage ----------

-- The reports table is created in this stage because the resilience section
-- below defines admin_reports_list(), which reads public.reports. In the
-- original ordering that function was applied before the table existed, which
-- worked only on a database where reports had already been created by an
-- earlier script. (That function carried a `language sql` body, whose reads
-- are validated at creation; it is `language plpgsql` now that the is_admin()
-- guard lives inside it, so its reads resolve at first execution instead. The
-- stage ordering below is kept either way.)

-- ------------------------------------------------------------
-- 6. reports — lightweight, no moderation system.
-- ------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  reported_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid());


-- ---------- moved here from the account-settings stage ----------

-- user_blocks is created in this stage because the messages policies in the
-- product-flow stage below filter on it (a blocked pair cannot message). In
-- the original ordering the account-settings bundle happened to run before the
-- product-flow bundle, so the policies were created after the table.

-- ------------------------------------------------------------
-- 3. user_blocks — server-enforced blocking
-- ------------------------------------------------------------
create table if not exists public.user_blocks (
  -- FKs reference public.users (mirrors auth.users ids; the signup
  -- trigger keeps rows in sync). This also gives PostgREST a real
  -- relationship so the UI can embed blocked users' names.
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

-- You can see blocks you made OR received (received-visibility is
-- required by the messages policy subquery below; content is ids only).
drop policy if exists "blocks_select_involved" on public.user_blocks;
create policy "blocks_select_involved"
  on public.user_blocks for select
  to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

-- Only you can block someone, as yourself
drop policy if exists "blocks_insert_own" on public.user_blocks;
create policy "blocks_insert_own"
  on public.user_blocks for insert
  to authenticated
  with check (blocker_id = auth.uid());

-- Only you can unblock (blocker side)
drop policy if exists "blocks_delete_own" on public.user_blocks;
create policy "blocks_delete_own"
  on public.user_blocks for delete
  to authenticated
  using (blocker_id = auth.uid());

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);


-- ---------- folded from supabase/sql/superseded/harden_resilience.sql ----------

-- ============================================================
-- HARDEN RESILIENCE — folded into this chain; it is no longer a separate file
--
-- As a standalone script this section was headed "STAGING ONLY" and named two
-- different project refs, one of which was not to receive it. That warning is
-- deliberately gone: this content is now part of the chain, and the chain is
-- applied everywhere, staging and production alike. What made the original file
-- staging-only was its sections A and B — the per-intent callback key and the
-- callback idempotency cache — and those are declared once in the payment stage
-- below, where the callback actually reads them, so nothing here is provisional.
-- Idempotent: IF NOT EXISTS / create-or-replace / drop-if-exists.
--
-- Sections here:
--   C. Rate limits: messages 60/h, connection requests 30/h
--   D. app_settings                   (maintenance banner, admin-only write)
--   E. admin_reports_list()           (reports review via existing admin RPC enforcement)
-- ============================================================

-- ------------------------------------------------------------
-- A/B. payment_intents.callback_key and public.processed_payment_callbacks
--      are declared once, in the payment stage below (step 1.11 in the old
--      ordering). They are kept out of here so the payment path has exactly
--      one owner: this file is marked STAGING ONLY and was never in the
--      deployment checklist, so anything that existed only here did not
--      exist on a project built from the checklist alone.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- C. Database-side rate limits (enforced for every insert path,
--    not only the UI). Tunables are the two literals:
--      messages: 60 per rolling hour
--      connection requests (payment_intents): 30 per rolling hour
--    NOTE: payment_intents carries a 5-per-hour edge-function
--    throttle already; this DB guard is a backstop for ALL rows.
--    SECURITY DEFINER avoids RLS self-visibility edge cases; the
--    count is always scoped to the inserting user themselves.
-- ------------------------------------------------------------
create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.messages m
    where m.sender_id = new.sender_id
      and m.sent_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            hint = 'Wait a bit before sending more messages.';
  end if;
  return new;
end;
$$;
-- (fix_rate_limit_column.sql is folded in above: this is the corrected
-- definition. The version originally in this file counted messages by
-- created_at, a column public.messages does not have, so every message insert
-- failed with 42703 until the fix was applied after it.)


drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

create or replace function public.enforce_intent_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.payment_intents pi
    where pi.user_id = new.user_id
      and pi.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            message = 'RATE_LIMITED';
  end if;
  return new;
end;
$$;

drop trigger if exists intents_rate_limit on public.payment_intents;
create trigger intents_rate_limit
  before insert on public.payment_intents
  for each row execute function public.enforce_intent_rate_limit();

-- ------------------------------------------------------------
-- D. app_settings — single-row maintenance banner
--    PUBLIC READ (every client fetches it on load), write only
--    through the existing admin RPC enforcement (no direct write
--    policy → only service role / SECURITY DEFINER admin RPCs).
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  maintenance_message text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read"
  on public.app_settings for select
  using (true);

-- No INSERT/UPDATE/DELETE policies: writes go only through
-- admin_set_maintenance_message() below (is_admin() enforced).

-- Seed the single row if absent (idempotent).
insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

create or replace function public.admin_set_maintenance_message(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;
  perform public.set_entitlement_context(
    'maintenance_message_changed',
    'admin set the maintenance banner shown to every user',
    'auth.users',
    auth.uid()::text);

  update public.app_settings
  set maintenance_message = coalesce(p_message, ''),
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;
end;
$$;

revoke all on function public.admin_set_maintenance_message(text) from anon, authenticated, public;

-- ------------------------------------------------------------
-- E. Reports review list for the Admin panel
--    Reuses the EXISTING admin enforcement (is_admin()); no new
--    admin logic — same pattern as admin_users_list etc.
-- ------------------------------------------------------------
create or replace function public.admin_reports_list(
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reported_id uuid,
  reported_name text,
  reason text,
  created_at timestamptz,
  reporter_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The guard the SQL version could not carry: a plain `language sql`
  -- function cannot raise conditionally, so the ONLY thing standing
  -- between any authenticated caller and every report row was the revoke
  -- below — one future `grant` away from exposure. This is the same guard
  -- every other admin_* RPC in this file carries.
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
    select r.id,
           r.reporter_id,
           ru.full_name,
           r.reported_id,
           eu.full_name,
           r.reason,
           r.created_at,
           pu.profile_status
    from public.reports r
    left join public.users ru on ru.id = r.reporter_id
    left join public.users eu on eu.id = r.reported_id
    left join public.users pu on pu.id = r.reported_id
    order by r.created_at desc
    limit least(coalesce(p_limit, 100), 200)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_reports_list(int, int) from anon, authenticated, public;
-- Reachable by the admins the guard admits, and by nobody else.
grant execute on function public.admin_reports_list(int, int) to authenticated;

-- ============================================================
-- VERIFY after running:
--   select column_name from information_schema.columns
--    where table_name='payment_intents' and column_name='callback_key';
--   select count(*) from public.processed_payment_callbacks;   -- 0
--   select tgname from pg_trigger where tgrelid='public.messages'::regclass;
--   select maintenance_message from public.app_settings;       -- ''
--   select * from public.admin_reports_list(10, 0);            -- error if not admin
-- ============================================================

-- ---------- folded from supabase/sql/superseded/fix_rate_limit_column.sql ----------

-- Folded into the resilience section above: the enforce_message_rate_limit()
-- definition there is this file's corrected version (messages.sent_at).


-- ============================================================
-- STAGE 2 — product flow, matching and paid contact
-- the canonical matches shape, conversations, connect_unlocks, reports, the
-- reconciled shape of an existing matches table, then the share toggles and
-- the two RPCs that read them.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/product_flow_bundle.sql ----------

-- ============================================================
-- PRODUCT FLOW BUNDLE: Discover/Force Connect/Qrashe, paid
-- Connect (KSh 70 / 50) with contact snapshots, conversation
-- lifecycle (lock → read-only 1 week → archived), reports.
-- Run in Supabase SQL Editor AFTER fix_rls, harden_profile_reads,
-- admin_role, remediation_bundle, storage_rls, account_settings_bundle.
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. users: contact-sharing controls + optional social handles.
--    Owner-controlled; affect FUTURE paid connects only (paid
--    unlocks snapshot values at purchase time — see below).
--    These columns are PRIVATE: never granted to public grants.
-- ------------------------------------------------------------
alter table public.users
  add column if not exists share_phone boolean not null default true;
alter table public.users
  add column if not exists share_whatsapp boolean not null default true;
alter table public.users
  add column if not exists share_email boolean not null default false;
alter table public.users
  add column if not exists social_instagram text;
alter table public.users
  add column if not exists social_x text;
alter table public.users
  add column if not exists social_tiktok text;

-- ------------------------------------------------------------
-- 2. payment_intents: purpose + recipient. Prices are enforced
--    server-side in initiate-payment; the callback switches on
--    purpose. Existing 'section2' rows keep the default.
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists purpose text not null default 'section2';
alter table public.payment_intents
  drop constraint if exists payment_intents_purpose_check;
alter table public.payment_intents
  add constraint payment_intents_purpose_check
    check (purpose in ('section2','connect_tier1','connect_tier2','connect_qrashe','force_connect'));
alter table public.payment_intents
  add column if not exists recipient_user_id uuid references public.users(id);

-- ------------------------------------------------------------
-- 3. matches — Qrashe pairs created ONLY by the verified Force
--    Connect payment (complete_force_connect RPC). Weekly Tier 1/2
--    live in match_history and the weekly engine must NOT write this
--    table: the app reads every status='active' row here as a Qrashe
--    match, so a weekly pair written here would be mislabelled.
--    Pair stored ordered: user_a_id = least(id), user_b_id = greatest(id).
--
--    THIS IS THE CANONICAL SHAPE. On a database that already had the
--    legacy weekly `matches` table, `create table if not exists` is a
--    no-op and none of this applies — the matches-shape stage below
--    (folded from supabase/sql/superseded/reconcile_matches_shape.sql)
--    exists to bring such a table to exactly this shape. Change both
--    together.
-- ------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  tier text default 'qrashe' check (tier is null or tier = 'qrashe'),
  created_by uuid references public.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','unmatched','pending','interested',
                      'discarded','matched','ghosted')),
  compatibility_score integer not null default 0,
  created_at timestamptz not null default now(),
  -- Retained legacy weekly-engine columns: existing rows keep their
  -- data, nothing writes them, and the matches-shape stage below does
  -- not drop them. They go only on a deliberate retention decision.
  is_visible boolean default false,
  compatibility_drivers jsonb,
  explanation jsonb,
  success_probability double precision default 0.0,
  last_interaction_at timestamptz default now(),
  interested_at timestamptz,
  discarded_at timestamptz,
  constraint matches_unique_pair unique (user_a_id, user_b_id),
  constraint matches_distinct_pair_check check (user_a_id <> user_b_id)
);

-- The client reads this table with `.or(user_a_id.eq.X,user_b_id.eq.X)`;
-- the unique key covers the user_a_id side, this covers the other.
create index if not exists idx_matches_user_b on public.matches (user_b_id);

alter table public.matches enable row level security;

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());
-- No client insert/update/delete: creation happens only inside
-- complete_force_connect (security definer, server-verified payment).
-- The legacy table also granted ALL to anon/authenticated and carried a
-- "Users can update their own matches" policy, which let a participant
-- rewrite their own match row; both are revoked/dropped in the
-- matches-shape stage below.
revoke all on table public.matches from anon;
revoke insert, update, delete on table public.matches from authenticated;

-- ------------------------------------------------------------
-- 3b. match_history — D-2ii: the legacy weekly-engine table, which no
--     committed file created. Three functions above read it
--     (discover_candidates, users_are_paired, get_match_contact), the
--     Matches / Home / MatchCelebration / MatchDetail / Messages pages
--     read it, and match-generator writes it with the service role via
--     .upsert(..., { onConflict: 'user_id,week_id' }). Until now it existed
--     only as a precondition, so on a project without it every one of
--     those reads fails and weekly delivery has nowhere to land.
--
--     Columns are exactly the ones the code touches: id, user_id,
--     week_id, tier1_match_id, tier2_match_id, delivered_at. week_id is
--     the `YYYY-Www` string built by getWeekId() on both sides, so it is
--     text. user_id holds public.users.id (the match-generator sources it
--     from .from('users'), and users_are_paired compares it to auth.uid()).
--
--     RLS on, read-own only, and NO write policy: delivery stays with the
--     service role in match-generator.
-- ------------------------------------------------------------
create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  week_id text,
  tier1_match_id uuid,
  tier2_match_id uuid,
  delivered_at timestamptz
);

alter table public.match_history add column if not exists delivered_at timestamptz;

create unique index if not exists match_history_user_week_uidx
  on public.match_history (user_id, week_id);

alter table public.match_history enable row level security;

drop policy if exists "match_history_select_own" on public.match_history;
create policy "match_history_select_own"
  on public.match_history for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.match_history from anon;
revoke insert, update, delete on public.match_history from authenticated;

-- ------------------------------------------------------------
-- 4. connect_unlocks — one PAID contact unlock per buyer/seller.
--    Contact values are SNAPSHOTTED at payment time: the owner
--    changing sharing settings later never revokes paid access,
--    and only then-enabled methods are stored.
-- ------------------------------------------------------------
create table if not exists public.connect_unlocks (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.users(id) on delete cascade,
  seller_id uuid not null references public.users(id) on delete cascade,
  tier text not null check (tier in ('tier1','tier2','qrashe')),
  amount numeric not null,
  payment_intent_id uuid references public.payment_intents(id),
  phone text,
  whatsapp_number text,
  email text,
  social_instagram text,
  social_x text,
  social_tiktok text,
  created_at timestamptz not null default now(),
  unique (buyer_id, seller_id),
  check (buyer_id <> seller_id)
);

alter table public.connect_unlocks enable row level security;

drop policy if exists "unlock_select_buyer" on public.connect_unlocks;
create policy "unlock_select_buyer"
  on public.connect_unlocks for select
  to authenticated
  using (buyer_id = auth.uid());
-- No client writes: rows are created only by complete_connect_unlock.

-- ------------------------------------------------------------
-- 5. conversations — lifecycle per user pair (ordered like matches):
--    active → locked (paid connect: no new messages, read-only)
--           → archived after 7 days (hidden from normal access)
--    unmatched (user-initiated Unmatch, pre-connect only)
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  match_tier text check (match_tier in ('tier1','tier2','qrashe')),
  status text not null default 'active'
    check (status in ('active','locked','unmatched')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  check (user_a_id <> user_b_id)
);

-- ------------------------------------------------------------
-- Convergence for databases that already had a conversations table:
-- the `create table if not exists` above is a no-op there, so a legacy
-- table missing any of these columns would fail this file's own later
-- `insert into public.conversations (... match_tier ...)` with 42703.
-- Columns only — no constraint is tightened on a table that may already
-- hold rows.
-- ------------------------------------------------------------
alter table public.conversations
  add column if not exists user_a_id  uuid,
  add column if not exists user_b_id  uuid,
  add column if not exists match_tier text,
  add column if not exists status     text default 'active',
  add column if not exists locked_at  timestamptz,
  add column if not exists created_at timestamptz default now();

do $$
begin
  -- The pair has to be unique. Tested by the columns the constraint
  -- covers, not by its name: the chain's own `unique (user_a_id,
  -- user_b_id)` is auto-named, so a name test would add a second,
  -- identical unique index to every database that already has one.
  if not exists (
    select 1
    from pg_constraint con
    where con.conrelid = 'public.conversations'::regclass
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by att.attname::text)
        from unnest(con.conkey) as k(attnum)
        join pg_attribute att
          on att.attrelid = con.conrelid and att.attnum = k.attnum
      ) = array['user_a_id', 'user_b_id']::text[]
  ) then
    begin
      alter table public.conversations
        add constraint conversations_user_pair_key unique (user_a_id, user_b_id);
    exception when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());
-- Status changes (lock/unmatch) happen via security-definer RPCs only.

-- 6. reports is created in the base stage ('identity, base tables and
--    resilience'): admin_reports_list() reads it.


create index if not exists conversations_participant_idx
  on public.conversations (user_a_id, user_b_id);
create index if not exists connect_unlocks_buyer_idx
  on public.connect_unlocks (buyer_id);

-- ------------------------------------------------------------
-- 7. messages policy updates:
--    a) INSERT: still sender-only + blocked-pair rejection, and now
--       rejects when the conversation is locked/unmatched (post-connect
--       the conversation is closed; users move to revealed contacts).
--    b) SELECT: hides messages of ARCHIVED conversations (locked
--       > 7 days). Rows remain in the database.
--    Replaces the policies from remediation_bundle/account_settings_bundle.
-- ------------------------------------------------------------
drop policy if exists "messages_insert_own_sender" on public.messages;
create policy "messages_insert_own_sender"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = recipient_id)
         or (ub.blocker_id = recipient_id and ub.blocked_id = auth.uid())
    )
    -- Only LOCKED/UNMATCHED conversations block new messages; an
    -- 'active' conversation row (e.g. a fresh Qrashe pair) chats normally.
    and not exists (
      select 1 from public.conversations c
      where (
        (c.user_a_id = auth.uid() and c.user_b_id = recipient_id)
        or (c.user_b_id = auth.uid() and c.user_a_id = recipient_id)
      )
      and c.status in ('locked','unmatched')
    )
  );

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  to authenticated
  using (
    (sender_id = auth.uid() or recipient_id = auth.uid())
    -- Hide history only for ARCHIVED conversations (locked > 7 days).
    -- Parenthesized so the status/age conditions apply to BOTH arms.
    and not exists (
      select 1 from public.conversations c
      where (
        (c.user_a_id = auth.uid() and c.user_b_id = least(sender_id, recipient_id))
        or (c.user_b_id = auth.uid() and c.user_a_id = least(sender_id, recipient_id))
      )
      and c.status = 'locked' and c.locked_at < now() - interval '7 days'
    )
  );

-- ------------------------------------------------------------
-- 8. RPCs — all security definer, uid server-derived. Clients can
--    never set prices, tiers, pairing, or unlock state.
-- ------------------------------------------------------------

-- 8a. Discover: exactly 5 candidate cards (facial-photo pairing is
--     resolved client-side from photos by these ids). Criteria mirror
--     the matching model: same campus, opposite gender, questionnaire
--     complete, active profile, no blocks, never previously paired.
create or replace function public.discover_candidates()
returns table (id uuid, full_name text, age int)
language sql
security definer
set search_path = public
as $$
  select u.id, u.full_name, u.age
  from public.users u
  where u.id <> auth.uid()
    and u.profile_status = 'active'
    and u.section1_complete = true
    and u.gender <> (select me.gender from public.users me where me.id = auth.uid())
    -- GENERAL STUDENT PLATFORM: campus-verified users stay campus-scoped;
    -- unaffiliated users (campus_id is null — gmail/other institutions)
    -- discover across all campuses. null = null is never true, so an
    -- explicit or-arm is required for them to see anyone.
    and (
      u.campus_id = (select me.campus_id from public.users me where me.id = auth.uid())
      or (u.campus_id is null
          and (select me.campus_id from public.users me where me.id = auth.uid()) is null)
    )
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = u.id)
         or (ub.blocker_id = u.id and ub.blocked_id = auth.uid())
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a_id = auth.uid() and m.user_b_id = u.id)
         or (m.user_b_id = auth.uid() and m.user_a_id = u.id)
    )
    and not exists (
      select 1 from public.match_history mh
      where (mh.user_id = auth.uid() and (mh.tier1_match_id = u.id or mh.tier2_match_id = u.id))
         or (mh.user_id = u.id and (mh.tier1_match_id = auth.uid() or mh.tier2_match_id = auth.uid()))
    )
  order by u.created_at
  limit 5;
$$;
grant execute on function public.discover_candidates() to authenticated;

-- 8b. Pairing check used by the unlock RPC (tier1/2 weekly match,
--     either direction, OR an active qrashe pair).
create or replace function public.users_are_paired(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_history mh
    where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
       or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
  ) or exists (
    select 1 from public.matches m
    where m.status = 'active'
      and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a))
  );
$$;

-- 8c. Force Connect completion — called by payment-callback AFTER the
--     intent is verified+succeeded. Creates the Qrashe match, the
--     conversation, and notifies the recipient (persistent notification
--     row + in-conversation system message). No accept/decline exists.
create or replace function public.complete_force_connect(intent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.payment_intents;
  buyer public.users;
  target public.users;
  pair_a uuid;
  pair_b uuid;
begin
  select * into it from public.payment_intents where id = intent_id;
  if it is null or it.purpose <> 'force_connect'
     or it.recipient_user_id is null or it.status <> 'succeeded' then
    return;
  end if;

  select * into buyer from public.users where id = it.user_id;
  select * into target from public.users where id = it.recipient_user_id;
  if buyer is null or target is null or buyer.id = target.id then
    return;
  end if;

  pair_a := least(buyer.id, target.id);
  pair_b := greatest(buyer.id, target.id);

  -- Idempotent: an existing pair row means the payment already applied.
  if exists (
    select 1 from public.matches m
    where m.user_a_id = pair_a and m.user_b_id = pair_b
  ) then
    return;
  end if;

  -- The grant declares its reason before it happens, and the recorder keeps it.
  -- Without this the pair would still be recorded, with the reason "no explicit
  -- reason recorded" — a warn, not a critical, but still a finding: the payment
  -- path is the one place where the evidence must be stated, not implied.
  perform public.set_entitlement_context(
    'qrashe_match_paid',
    'paid Force Connect: this pair exists because a verified succeeded intent bought it',
    'public.payment_intents',
    it.id::text);

  insert into public.matches (user_a_id, user_b_id, tier, created_by)
  values (pair_a, pair_b, 'qrashe', buyer.id);

  insert into public.conversations (user_a_id, user_b_id, match_tier, status)
  values (pair_a, pair_b, 'qrashe', 'active')
  on conflict (user_a_id, user_b_id) do update
    set status = 'active', match_tier = 'qrashe';

  insert into public.messages (sender_id, recipient_id, content, is_bot)
  values (buyer.id, target.id,
    '⚡ ' || buyer.full_name || ' sent you a Force Connect. You are now matched.', true);

  insert into public.notifications (user_id, message)
  values (target.id, '⚡ Force Connect: ' || buyer.full_name || ' connected with you.');
end;
$$;
revoke all on function public.complete_force_connect(uuid) from anon, public;
grant execute on function public.complete_force_connect(uuid) to service_role;

-- 8d. complete_connect_unlock() is defined in the share-toggles stage below,
--     which owns it: that version also snapshots the share_social_* flags.


-- 8e. Unmatch — pre-connect only; any participant, server-derived uid.
create or replace function public.unmatch_conversation(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  pair_a uuid;
  pair_b uuid;
begin
  if me is null or other_user_id is null then
    raise exception 'Not authenticated';
  end if;
  pair_a := least(me, other_user_id);
  pair_b := greatest(me, other_user_id);

  -- Blocked/unlocked conversations cannot be unmatched away.
  if exists (
    select 1 from public.connect_unlocks cu
    where (cu.buyer_id = me and cu.seller_id = other_user_id)
       or (cu.buyer_id = other_user_id and cu.seller_id = me)
  ) then
    raise exception 'Cannot unmatch after Connect';
  end if;

  update public.conversations
  set status = 'unmatched'
  where user_a_id = pair_a and user_b_id = pair_b and status = 'active';

  update public.matches
  set status = 'unmatched'
  where user_a_id = pair_a and user_b_id = pair_b
    and status = 'active'
    and (created_by = me or created_by = other_user_id);
end;
$$;
grant execute on function public.unmatch_conversation(uuid) to authenticated;

-- 8f. get_unlocked_contacts() is defined in the share-toggles stage below,
--     which owns it (the version that applies live sharing flags on the
--     legacy free path).


-- ------------------------------------------------------------
-- 9. The privacy fix (profiles_public without display_phone, and the column
--    grant on public.users revoked) is applied by the composed profile block
--    in the entitlement stage, which owns the view and its grants.


-- ------------------------------------------------------------
-- 10. Verify: connect_unlocks + matches + conversations + reports have
--     their policies; get_unlocked_contacts/discover_candidates exist.
-- ------------------------------------------------------------

-- ---------- folded from supabase/sql/superseded/reconcile_matches_shape.sql ----------

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
-- 1. The table is created in the product-flow stage above (the canonical
--    shape, named constraints included). This stage only reconciles a table
--    that already exists to that shape.


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

-- The participant SELECT policy is created with the table in the product-flow
-- stage; identical here, so it is not re-asserted.

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

-- ---------- folded from supabase/sql/superseded/20260927120000_social_share_toggles.sql ----------

-- ============================================================
-- SOCIAL SHARE TOGGLES (spec-audit Group 4 fix)
--
-- Finding: get_unlocked_contacts() revealed any filled social handle
-- unconditionally — the owner had no per-handle choice, unlike phone
-- (share_phone) and WhatsApp (share_whatsapp). Spec section 10/11:
-- only reveal methods the owner has chosen to make available.
--
-- Adds one boolean per handle, mirroring the existing pattern, and
-- gates both reveal paths:
--   * the PAID snapshot in complete_connect_unlock (captured at
--     payment time — settings changes never retroact), and
--   * the LEGACY free path in get_unlocked_contacts (live flags).
--
-- Default TRUE for existing users: handles already being revealed
-- stay revealed until the owner turns them off (no silent retroactive
-- hiding; paid snapshots are immutable regardless).
-- ============================================================

alter table public.users
  add column if not exists share_social_instagram boolean not null default true,
  add column if not exists share_social_x         boolean not null default true,
  add column if not exists share_social_tiktok    boolean not null default true;

-- These are the owner's own sharing settings: client-writable like
-- share_phone/share_whatsapp. They are NOT entitlement columns, so the
-- clamp_user_protected_columns trigger does not (and must not) touch
-- them.

-- ------------------------------------------------------------
-- 8d. Paid Connect completion — snapshot now respects the per-handle
--     toggles alongside share_phone/share_whatsapp/share_email.
-- ------------------------------------------------------------
create or replace function public.complete_connect_unlock(intent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.payment_intents;
  buyer public.users;
  seller public.users;
  pair_a uuid;
  pair_b uuid;
  tier_name text;
  v_unlock_id uuid;
begin
  select * into it from public.payment_intents where id = intent_id;
  if it is null or it.status <> 'succeeded'
     or it.purpose not in ('connect_tier1','connect_tier2','connect_qrashe')
     or it.recipient_user_id is null then
    return;
  end if;

  select * into buyer from public.users where id = it.user_id;
  select * into seller from public.users where id = it.recipient_user_id;
  if buyer is null or seller is null or buyer.id = seller.id then
    return;
  end if;

  -- Server-side pairing re-check: unlock only real matches.
  if not public.users_are_paired(buyer.id, seller.id) then
    return;
  end if;

  tier_name := case it.purpose
    when 'connect_tier1' then 'tier1'
    when 'connect_tier2' then 'tier2'
    else 'qrashe'
  end;

  -- Idempotent snapshot insert. Everything below (conversation lock,
  -- system message) runs ONLY on the first successful insert, so
  -- repeated callbacks/RPC calls cannot duplicate state.
  perform public.set_entitlement_context(
    'connection_unlock_paid',
    'paid contact unlock: the snapshot is taken because a verified succeeded intent bought it',
    'public.payment_intents',
    it.id::text);

  insert into public.connect_unlocks (
    buyer_id, seller_id, tier, amount, payment_intent_id,
    phone, whatsapp_number, email, social_instagram, social_x, social_tiktok
  )
  select buyer.id, seller.id, tier_name, it.amount, it.id,
    case when seller.share_phone then seller.phone end,
    case when seller.share_whatsapp then seller.whatsapp_number end,
    case when seller.share_email then seller.email end,
    case when seller.share_social_instagram then seller.social_instagram end,
    case when seller.share_social_x then seller.social_x end,
    case when seller.share_social_tiktok then seller.social_tiktok end
  on conflict (buyer_id, seller_id) do nothing
  returning id into v_unlock_id;

  if v_unlock_id is null then
    return; -- already unlocked by a previous callback
  end if;

  pair_a := least(buyer.id, seller.id);
  pair_b := greatest(buyer.id, seller.id);

  insert into public.conversations (user_a_id, user_b_id, match_tier, status, locked_at)
  values (pair_a, pair_b, tier_name, 'locked', now())
  on conflict (user_a_id, user_b_id) do update
    set status = 'locked', locked_at = now(),
        match_tier = coalesce(public.conversations.match_tier, tier_name);

  insert into public.messages (sender_id, recipient_id, content, is_bot)
  values (buyer.id, seller.id, buyer.full_name || ' connected with you.', true);
end;
$$;
revoke all on function public.complete_connect_unlock(uuid) from anon, public;
grant execute on function public.complete_connect_unlock(uuid) to service_role;

-- ------------------------------------------------------------
-- 8f. Contact reveal — PAID ONLY (F1). The free 14-question path is gone:
--     the only reveal is the snapshot a verified payment wrote into
--     connect_unlocks (complete_connect_unlock), and only to the buyer, and
--     only while the two are still a pair.
-- ------------------------------------------------------------
create or replace function public.get_unlocked_contacts(other_user_id uuid)
returns table (
  phone text,
  whatsapp_number text,
  email text,
  social_instagram text,
  social_x text,
  social_tiktok text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  unlocked record;
begin
  if me is null or other_user_id is null then
    return;
  end if;

  -- The caller must be in the match. A paid pair can no longer be unmatched
  -- (unmatch_conversation refuses once connect_unlocks exists), so this
  -- cannot revoke a reveal a payment already bought.
  if not public.users_are_paired(me, other_user_id) then
    return;
  end if;

  -- The only reveal: the snapshot a payment wrote for this buyer and this
  -- match. Nothing here reads questions_discussed, section2_unlocked, or
  -- section2_free_expires_at.
  select * into unlocked from public.connect_unlocks cu
  where cu.buyer_id = me and cu.seller_id = other_user_id;
  if found then
    return query select unlocked.phone, unlocked.whatsapp_number, unlocked.email,
      unlocked.social_instagram, unlocked.social_x, unlocked.social_tiktok;
  end if;
end;
$$;
revoke all on function public.get_unlocked_contacts(uuid) from anon, public;
grant execute on function public.get_unlocked_contacts(uuid) to authenticated;


-- ============================================================
-- STAGE 3 — profile reads and entitlement
-- the paywalled contact RPC, the account-settings surface, the composed
-- profile view/grant block, then the entitlement clamp and the server-side
-- 14-day trial grant.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/harden_profile_reads.sql ----------

-- ============================================================
-- HARDENING: column-scoped profile reads
--
-- Problem: the users RLS policy "users_select_authenticated"
-- exposes EVERY column to EVERY logged-in user, including:
--   * onesignal_player_id → anyone can push-notify any user
--     via send-notification (src/utils/notifications.js does
--     exactly this — and it's the documented pattern)
--   * phone, whatsapp_number, email → contact harvesting
--     (the chat paywall exists to hide exactly this!)
--   * payment / unlock bookkeeping columns
--
-- Strategy (all idempotent):
--   1. Replace blanket SELECT with a COLUMN-LEVEL grant on
--      non-sensitive columns only. Direct `select('*')` and
--      direct reads of email/phone/onesignal_player_id fail.
--   2. profiles_public view (security_invoker=on) over those
--      columns: RLS still applies, code reads it for other users.
--   3. my_profile() — SECURITY DEFINER RPC returning YOUR full
--      row (uid is server-derived via auth.uid(), not spoofable).
--   4. get_match_contact() — SECURITY DEFINER paywall: returns a
--      match's contact info ONLY if you're actually paired in
--      match_history AND an unlock condition truly holds.
--   INSERT/UPDATE/DELETE/REFERENCES grants are revoked and reissued per
--   column by the composed profile block below; RLS policies
--   (supabase/sql/superseded/fix_rls.sql) gate the row.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column-scoped SELECT on the base table
-- ------------------------------------------------------------
revoke select on public.users from anon, authenticated;

-- 1b. The users column grant is issued once, by the composed profile block in
--     the entitlement stage, without display_phone. The table-level revoke
--     above stays — that is the statement that closes the blanket grant.

-- service_role (edge functions) keeps unrestricted access
grant select on public.users to service_role;

-- ------------------------------------------------------------
-- 2. Public profile view — what OTHER users may see
-- ------------------------------------------------------------
-- 2. profiles_public is created once, by the composed profile block in the
--    entitlement stage (that block is the union of this file, 
--    account_settings_bundle.sql and product_flow_bundle.sql §9).


-- ------------------------------------------------------------
-- 3. Your own row, full columns, server-derived uid
--    (definer so it works without any base-table grants;
--     it can only ever return YOUR row)
-- ------------------------------------------------------------
-- 3. my_profile() is defined by the composed profile block below.


-- ------------------------------------------------------------
-- 4. Paywall-enforced contact unlock (replaces reading the
--    match's contact columns directly — previously ANY user
--    could read them regardless of payment state)
-- ------------------------------------------------------------
create or replace function public.get_match_contact(match_user_id uuid)
returns table (
  display_phone text,
  phone text,
  whatsapp_number text,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.users;
  target public.users;
  paired boolean;
begin
  select * into me from public.users where id = auth.uid();
  select * into target from public.users where id = match_user_id;

  if me is null or target is null then
    return;
  end if;

  -- must actually be weekly matches, either direction
  select exists (
    select 1 from public.match_history mh
    where (mh.user_id = me.id and mh.tier1_match_id = target.id)
       or (mh.user_id = me.id and mh.tier2_match_id = target.id)
       or (mh.user_id = target.id and mh.tier1_match_id = me.id)
       or (mh.user_id = target.id and mh.tier2_match_id = me.id)
  ) into paired;

  if not paired then
    return;
  end if;

  -- Paywall (F1): only a record a payment wrote for THIS caller and THIS
  -- match opens it — the paid snapshot, or this caller's own succeeded
  -- section2 intent. section2_unlocked and section2_free_expires_at are
  -- deliberately gone from this condition: the flag is not evidence for a
  -- specific match, and the trial is not a payment at all.
  if exists (
    select 1 from public.connect_unlocks cu
    where cu.buyer_id = me.id and cu.seller_id = target.id
  ) or exists (
    select 1 from public.payment_intents pi
    where pi.user_id = me.id
      and pi.purpose = 'section2'
      and pi.status = 'succeeded'
  ) then
    return query
      select target.display_phone, target.phone, target.whatsapp_number, target.email;
  end if;
end;
$$;

grant execute on function public.get_match_contact(uuid) to authenticated;

-- ============================================================
-- CLIENT STATE AFTER THIS RUNS (already applied in src/):
--   ✔ Matches.jsx  → reads .from('profiles_public')
--   ✔ Chat.jsx     → own row via .rpc('my_profile'); match row
--                    via profiles_public; contact reveal via
--                    .rpc('get_match_contact')
--   Still using granted own-row columns directly (fine):
--     Home, Section1, Section2, ProfileSetup, Signup
--   TODO for you:
--   * Profile.jsx still does .select('*') on its OWN row —
--     switch to .rpc('my_profile') (works, returns array)
--   * src/utils/notifications.js is dead code AND unsafe
--     (client fetches recipient player ids). Delete it; move
--     player-id lookup inside the send-notification function.
--   * Admin.jsx queries all users' rows as the logged-in admin —
--     needs a real admin role/policy, out of scope here.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/account_settings_bundle.sql ----------

-- ============================================================
-- ACCOUNT SETTINGS BUNDLE: prompts, bio cap, pause, blocking,
-- notification toggle, delete-account support.
-- Run in Supabase SQL Editor. Idempotent: safe to re-run.
-- Historical header from the retired bundle: the fix_rls.sql and
-- harden_profile_reads.sql sections it depended on are folded in
-- ABOVE, so there is nothing to run first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns on users
--    profile_prompts: structured [{id, question, answer}], max 3
--    notifications_enabled: owner-only toggle (match alerts)
--    (profile_status already exists: 'active' | 'paused')
-- ------------------------------------------------------------
alter table public.users
  add column if not exists profile_prompts jsonb not null default '[]'::jsonb;
alter table public.users
  add column if not exists notifications_enabled boolean not null default true;

-- Structured prompts: array, max 3, each row has id/question/answer
alter table public.users
  drop constraint if exists prompts_shape;
alter table public.users
  add constraint prompts_shape check (
    jsonb_typeof(profile_prompts) = 'array'
    and jsonb_array_length(profile_prompts) <= 3
  );

-- Bio is capped at 300 chars (client enforces too; DB is the boundary)
alter table public.users
  drop constraint if exists bio_max_300;
alter table public.users
  add constraint bio_max_300 check (bio is null or char_length(bio) <= 300);

-- ------------------------------------------------------------
-- 2. Column grants: profile_prompts + looking_for are public
--    profile info (shown to matches). notifications_enabled is
--    PRIVATE (owner reads it via my_profile() RPC only).
--    Re-issue the full grant lists from harden_profile_reads.sql
--    plus the new public columns.
-- ------------------------------------------------------------
-- The users column grant is issued once, by the composed profile block in the
-- entitlement stage, without display_phone.

-- profiles_public is created by the composed profile block in the entitlement
-- stage.


-- my_profile() is created by the composed profile block in the entitlement
-- stage.


-- 3. user_blocks is created in the base stage ('identity, base tables and
--    resilience'): the messages policies in the product-flow stage filter on it.


-- ------------------------------------------------------------
-- 4. BLOCK ENFORCEMENT at the DB boundary: a blocked user cannot
--    message you, and you cannot message them (either direction).
--    Replaces messages_insert_own_sender from remediation_bundle.
-- ------------------------------------------------------------
-- 4. messages_insert_own_sender is NOT defined here: product_flow_bundle (1.6)
--    replaced it with the version that also honours locked/unmatched
--    conversations, and that is the definition this chain keeps.

-- ------------------------------------------------------------
-- 5. Verified once via audit: users/section1 answers stay
--    owner-only; matching functions read via service role and
--    now filter paused profiles + blocked pairs in their queries.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 6. Delete account — SECURITY DEFINER RPC (uid server-derived).
--    ACTIVE -> PENDING_DELETION immediately:
--      * profile_status = 'pending_deletion' (excluded from matching
--        by the match-generator query; matches are weekly so no
--        existing pair is affected mid-week).
--      * notifications off, contact fields cleared, prompts cleared.
--      * photos rows deleted (bucket objects need the storage
--        dashboard/cleanup task — service-side object removal is
--        handled by the on-delete cascade of the rows only).
--    Messages SENT to others are anonymized to "Deleted User"
--    rather than removed (the other side's chat history stays
--    coherent); messages received are deleted.
--    auth.users row is deleted => FK ON DELETE CASCADE removes
--    user_responses, weekly_matches, match_history, blocks,
--    intents, progress rows automatically.
--    GRACE PERIOD: this MVP deletes immediately. If a grace period
--    is added later, gate the auth-user delete on
--    requested_at + interval and keep 'pending_deletion' status.
-- ------------------------------------------------------------
create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- hide from discovery immediately (everything else in the row is
  -- deleted below within the same transaction, so no scrub needed;
  -- these two matter if a grace period is added later)
  perform public.set_entitlement_context(
    'profile_status_pending_deletion',
    'the signed-in user requested deletion of their own account',
    'auth.users',
    uid::text);

  update public.users set
    profile_status = 'pending_deletion',
    notifications_enabled = false
  where id = uid;

  -- own photo rows (storage objects cleaned separately)
  delete from public.photos where user_id = uid;

  -- anonymize messages I SENT (other party keeps coherent history),
  -- delete messages I RECEIVED
  update public.messages set content = '[deleted]' where sender_id = uid;
  delete from public.messages where recipient_id = uid;

  -- remove the profile row first (cascades product tables whose FKs
  -- reference public.users), then the auth user (cascades the rest:
  -- user_responses, match_history, blocks, intents via auth FKs)
  delete from public.users where id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.request_account_deletion() from anon, public;
grant execute on function public.request_account_deletion() to authenticated;

-- ------------------------------------------------------------
-- The public profile surface, defined ONCE (was: three copies).
--   * the base-table column grant is the union of what the three original
--     files granted, MINUS display_phone: ProfileSetup fills that column with
--     the user's "email to share with match", so it must never be
--     world-readable. The revoke below converges databases that were built
--     with the wider grant.
--   * the view keeps profile_prompts/looking_for and never display_phone;
--     contact data is reachable only through get_unlocked_contacts() or the
--     owner's own row.
-- ------------------------------------------------------------
-- E1: the live project's grants on public.users are TABLE-WIDE (F4), which
-- is what made a column-scoped read impossible to express: a table grant that
-- survives alongside a column grant is the wider of the two. Both blanket
-- grants are therefore revoked here, immediately before the column grant that
-- replaces them, and the write grants are reissued per column below — on the
-- columns src/ actually inserts and updates, never on an entitlement.
revoke all on table public.users from anon;
revoke all on table public.users from authenticated;

grant select (
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, profile_status,
  section1_complete, section1_progress, section1_last_edited,
  section2_unlocked, section2_free_expires_at, created_at,
  profile_prompts, looking_for
) on public.users to anon, authenticated;

-- E1b: the write grants the app needs, by column. app-written INSERT columns:
-- Signup.jsx:48 (id, email, created_at) and ProfileSetup.jsx:81 (id, email,
-- full_name, age, gender, campus_id, residence_type, bio, phone,
-- whatsapp_number, display_phone, social_*). No entitlement column is granted:
-- section2_unlocked and section2_free_expires_at are absent below, so a client
-- cannot write them by any route, and RLS cannot help — RLS is row-scoped.
grant insert (
  id, email, created_at, full_name, age, gender, campus_id, residence_type,
  bio, phone, whatsapp_number, display_phone,
  social_instagram, social_x, social_tiktok
) on public.users to authenticated;

-- app-written UPDATE columns: Settings.jsx:59 (profile_status),
-- Settings.jsx:70 (notifications_enabled), Section1.jsx:103 (section1_*),
-- Interests.jsx:71 (interests), Profile.jsx:173 (bio, residence_type,
-- looking_for, interests, profile_prompts), Profile.jsx:207 (share_*,
-- social_*), supabaseClient.js:14 (onesignal_player_id), plus the columns the
-- two upserts update on conflict.
grant update (
  id, email, full_name, age, gender, campus_id, residence_type, bio,
  phone, whatsapp_number, display_phone,
  social_instagram, social_x, social_tiktok,
  profile_status, notifications_enabled,
  section1_progress, section1_complete, section1_last_edited,
  interests, looking_for, profile_prompts,
  share_phone, share_whatsapp, share_email,
  share_social_instagram, share_social_x, share_social_tiktok,
  onesignal_player_id
) on public.users to authenticated;

create or replace view public.profiles_public
with (security_invoker = on) as
select
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, profile_status,
  section1_complete, section2_unlocked, section2_free_expires_at,
  created_at, profile_prompts, looking_for
from public.users;

grant select on public.profiles_public to anon, authenticated;

revoke select (display_phone) on public.users from anon, authenticated;

-- my_profile() — your own row, full columns, server-derived uid.
create or replace function public.my_profile()
returns setof public.users
language sql
security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;
grant execute on function public.my_profile() to authenticated;

-- ---------- folded from supabase/sql/superseded/20261014120000_clamp_section2_entitlements.sql ----------

-- ============================================================
-- CLAMP SECTION 2 ENTITLEMENTS  (audit fix: entitlement forgery)
--
-- FINDING
--   Two entitlement columns were writable from the browser:
--     1. src/pages/Section2.jsx set `users.section2_unlocked = true`
--        when a user finished the Section 2 questionnaire. Section 2 is
--        now answered for free (product spec §2: no paywall in
--        onboarding), but the payment callback, the guided-chat paywall
--        (Chat.jsx) and get_match_contact() all treat that column as
--        "paid". So finishing a free questionnaire granted the KSh 200
--        unlock — and the paid chat past the 4 free questions — for
--        nothing.
--     2. src/pages/ProfileSetup.jsx computed
--        `section2_free_expires_at` (now + 14 days) in the browser, so
--        the trial window was client-controlled too.
--
-- ROOT CAUSE
--   The `users_update_own` RLS policy (supabase/sql/superseded/fix_rls.sql) lets a
--   user update their own row, and RLS cannot restrict *columns*. The
--   trigger created below is the column-level guard — it is the
--   `clamp_user_protected_columns` trigger that an earlier migration's
--   comment already assumed existed but which was never defined.
--
-- AFTER THIS MIGRATION
--   * `section2_unlocked` and `section2_free_expires_at` are
--     server-owned. A client write is silently DISCARDDED (the caller's
--     existing value is preserved), so no client gets an error and no
--     entitlement can be forged.
--   * The same clamp also covers the server-owned columns no client path
--     writes: `reg_number`, `reputation_score`, `status` and
--     `section2_responses`. (Verified against src/: no screen writes any of
--     them. `profile_status`, `section1_*`, `share_*`, `social_*`,
--     `display_phone`, `onesignal_player_id` and `notifications_enabled`
--     remain client-writable because the app does write them.)
--   * The 14-day trial is granted once, server-side, when the profile
--     row is created for a new auth user (handle_new_user).
--   * Verified payments still unlock, because payment-callback uses the
--     service role and therefore bypasses the clamp.
--
-- COMPANION CODE CHANGE (already applied in src/)
--   Section2.jsx no longer writes section2_unlocked; ProfileSetup.jsx no
--   longer writes section2_free_expires_at.
--
-- IDEMPOTENT: columns use if-not-exists, functions use create-or-replace,
-- and the trigger is dropped before creation. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1b. The columns the clamp reads must exist before it writes them.
--     reg_number, reputation_score, users.status and section2_responses
--     are part of the deployed users table (schema dump), but no earlier
--     stage of this chain converges them: a plpgsql assignment to a
--     missing column fails the entire write with 42703, which would make
--     every client profile update fail on a database built from this
--     chain's preconditions alone. Same pattern as the columns above —
--     add-if-not-exists, defaults matching the deployed table.
-- ------------------------------------------------------------
alter table public.users
  add column if not exists reg_number text,
  add column if not exists reputation_score integer default 100,
  add column if not exists status text default 'active',
  add column if not exists section2_responses integer[] default '{}'::integer[];

-- ------------------------------------------------------------
-- 2. Column-level entitlement clamp.
--    Fires on every write to public.users. It is a NO-OP for trusted
--    server paths — the service role, the SQL editor, and the
--    auth.users signup trigger none of which carry a user JWT — and for
--    anonymous writes (RLS already blocks those). It rewrites only the
--    server-owned columns — the two entitlements and the four legacy
--    server-owned fields — so every other column a client legitimately
--    edits (bio, interests, profile_status, section1_*, share_*,
--    social_*, display_phone, onesignal_player_id, notifications_enabled,
--    ...) is untouched.
-- ------------------------------------------------------------
create or replace function public.clamp_user_protected_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- PostgREST exposes the request's role as `request.jwt.claim.role`
  -- (legacy, per-claim) and inside the `request.jwt.claims` JSON.
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_is_client boolean;
begin
  -- A client write is one that carries a user JWT and is not the
  -- service role. Server code and internal triggers carry no user JWT
  -- (auth.uid() is null), so they pass through unchanged.
  v_is_client := auth.uid() is not null and v_role <> 'service_role';

  if not v_is_client then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A row created by a client never carries entitlement.
    new.section2_unlocked := false;
    new.section2_free_expires_at := null;
    -- Nor server-owned state: a row a client creates starts at the values
    -- the server would have given it, whatever the request asked for.
    new.reg_number := null;
    new.reputation_score := 100;
    new.status := 'active';
    new.section2_responses := '{}'::integer[];
  else
    -- Existing values are preserved verbatim; the client may not change
    -- them. Deliberately not an error: the client's write simply has no
    -- effect on these columns.
    new.section2_unlocked := old.section2_unlocked;
    new.section2_free_expires_at := old.section2_free_expires_at;
    new.reg_number := old.reg_number;
    new.reputation_score := old.reputation_score;
    new.status := old.status;
    new.section2_responses := old.section2_responses;
  end if;

  return new;
end;
$$;

drop trigger if exists clamp_user_protected_columns on public.users;
create trigger clamp_user_protected_columns
  before insert or update on public.users
  for each row
  execute function public.clamp_user_protected_columns();

-- ------------------------------------------------------------
-- 3. Server-side trial grant.
--    Replaces the handle_new_user() from
--    supabase/sql/superseded/fix_rls.sql (which carries the same change,
--    so a re-run cannot undo this). The
--    14-day Section 2 trial is now written by the server when the
--    profile row is created, instead of being calculated by the browser.
--    `on conflict do nothing` keeps it once-only per user.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The trial is a grant like any other, so it says why: it is the product's
  -- own offer, granted server-side at signup, not a decision anyone made for
  -- this user. The recorder turns that into a ledger row whose expiry is
  -- checkable against created_at + 14 days.
  perform public.set_entitlement_context(
    'section2_trial_14d',
    'the product 14-day Section 2 trial, granted server-side when the account row is created',
    'auth.users',
    new.id::text);

  insert into public.users (id, email, section2_unlocked, section2_free_expires_at)
  values (new.id, new.email, false, now() + interval '14 days')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4. VERIFY after applying (read-only).
--
--  a) The clamp exists exactly once:
--       select tgname from pg_trigger
--        where tgrelid = 'public.users'::regclass
--          and tgname = 'clamp_user_protected_columns';   -- 1 row
--
--  b) A client write is discarded. Signed in as an ordinary (non-paying)
--     user, from the browser console:
--       await supabase.from('users')
--         .update({ section2_unlocked: true })
--         .eq('id', <myId>);
--       await supabase.from('users')
--         .select('section2_unlocked').eq('id', <myId>).single();
--       -- expect section2_unlocked STILL false
--
--  c) A verified payment still unlocks: complete an M-Pesa KSh 200
--     payment, then
--       select section2_unlocked from public.users where id = <myId>;
--       -- expect true (the callback writes with the service role, which
--       -- the clamp lets through)
--
--  d) The trial is granted on signup: create a throwaway account, then
--       select section2_free_expires_at from public.users
--        where id = '<new-user-uuid>';   -- ≈ now() + 14 days
--
--  NOTE: this migration only stops FUTURE client writes. It does not
--  reset existing rows, so no current user loses access. Any account that
--  already forged section2_unlocked=true keeps it until corrected
--  deliberately (see the audit report for the reconciliation query).
-- ------------------------------------------------------------


-- ============================================================
-- STAGE 4 — payment lifecycle and callback evidence
-- the expiry window, the single expiry verdict every caller asks, the
-- terminal sweep, the audit view an operator reads, and the scheduled tick
-- that expires dead pushes, raises alerts on stuck unlocks and delivers
-- them to a chat webhook.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/payment_intent_lifecycle.sql ----------

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
-- F. Terminal transition for abandoned pushes. Called by the scheduled tick
--    in section I below — public.payment_ops_tick(), every five minutes. (This
--    section used to end with "nothing calls this today; wire it to pg_cron":
--    the tick is that wire, so do NOT add a second schedule for this function
--    — two schedules would just sweep the same rows twice.) The callback also
--    refuses expired intents on its own, so safety never depends on the sweep
--    running.
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


-- ------------------------------------------------------------
-- I. The scheduled ops tick — a stuck unlock must reach someone, not wait
--    for someone to remember to run a query.
--
--    One pg_cron job, every five minutes, calls public.payment_ops_tick():
--      1. expire_stale_payment_intents() — abandoned M-Pesa pushes become
--         'expired' instead of sitting 'pending' forever. Until now that
--         sweep existed but NOTHING called it: the only trace was a
--         commented-out cron.schedule example.
--      2. raise_payment_anomaly_alerts() — each row the audit view classifies
--         paid_but_not_unlocked becomes an alert, exactly once.
--      3. raise_entitlement_anomaly_alerts() — the same treatment for every
--         OTHER grant in the schema, from the stage-6 ledger and verdict: an
--         entitlement that is on but whose evidence does not support it.
--         Defined in stage 6, called from here — plpgsql resolves the name at
--         call time, so a forward reference is fine and keeps the alerting
--         path (expire, raise, raise, dispatch) readable in one function.
--      4. dispatch_ops_alerts() — hands those alerts to a chat webhook and
--         then confirms the webhook accepted them.
--
--    The channel is a Vault secret, never a URL in this file:
--      select vault.create_secret('https://hooks.slack.com/services/…',
--                                 'OPS_ALERT_WEBHOOK_URL');
--    Slack, Discord and Telegram all work with that one body: it carries the
--    message under 'text' (Slack, Telegram's sendMessage) and 'content'
--    (Discord), and each ignores the keys it does not know. A Telegram URL
--    must carry ?chat_id=<id> in its query string.
--
--    Without the secret nothing is lost and nothing breaks: the alert is still
--    recorded in public.ops_alerts, the row says why it could not be
--    delivered, and supabase/sql/inspect_state.sql reports the undelivered
--    count. Same for a project where pg_net or pg_cron is not enabled — the
--    chain says so and skips, it does not fail.
-- ------------------------------------------------------------

create table if not exists public.ops_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- One alert per underlying problem. This is the column that makes the job
  -- idempotent: a stuck intent alerts once, not once every five minutes.
  dedupe_key text not null,
  severity text not null default 'critical' check (severity in ('critical','warning')),
  subject text not null,
  body text not null,
  -- The anomaly row as it looked when the alert was raised. The view stays
  -- the live truth; this is the evidence for what was sent.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  dispatch_attempts integer not null default 0,
  -- pg_net's request id: the handle for asking what the webhook answered.
  net_request_id bigint,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  http_status integer,
  delivery_error text,
  unique (dedupe_key)
);

-- The dispatcher only ever scans undelivered rows, so the index covers only
-- those: without the predicate this index would grow with every alert ever
-- raised and be read for almost none of them.
create index if not exists ops_alerts_undelivered_idx
  on public.ops_alerts (created_at)
  where delivered_at is null;

alter table public.ops_alerts enable row level security;

-- No policies, deliberately — server-only, exactly like payment_intents and
-- processed_payment_callbacks. The tick is SECURITY DEFINER, so it writes
-- without needing a policy, and no client can read another operator's alerts.
revoke all on public.ops_alerts from anon, authenticated;
grant select on public.ops_alerts to service_role;

-- ------------------------------------------------------------
-- 1. Classify. Reads the audit view rather than re-deriving the anomaly, so
--    "paid but not unlocked" keeps exactly one definition.
-- ------------------------------------------------------------
create or replace function public.raise_payment_anomaly_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- One rule today, and one place to add the next: an insert per anomaly kind
  -- into the same table, with a dedupe_key that names the thing that is wrong.
  --
  -- The ten-minute grace period matters: a callback that is still in flight is
  -- not a stuck unlock, and alerting on it would page the operator for the
  -- normal case. Only a succeeded payment (so the callback verified it) whose
  -- unlock has not applied by then is an anomaly.
  insert into public.ops_alerts (kind, dedupe_key, severity, subject, body, detail)
  select
    'paid_but_not_unlocked',
    'paid_but_not_unlocked:' || a.id::text,
    'critical',
    'Paid but not unlocked: ' || a.id::text,
    'MingleMate — a payment was taken and the unlock never applied' || E'\n'
      || 'intent: ' || a.id::text || E'\n'
      || 'amount: KSh ' || to_char(a.amount, 'FM9999999990.00') || E'\n'
      || 'payer: ' || coalesce(a.phone, '(no number on the intent)') || E'\n'
      || 'paid: ' || to_char(a.created_at, 'YYYY-MM-DD HH24:MI')
      || ' (' || floor(extract(epoch from now() - a.created_at) / 60)::integer || ' minutes ago)' || E'\n'
      || 'status / unlock / verification: ' || a.status || ' / '
      || coalesce(a.unlock_state, 'null') || ' / '
      || coalesce(a.verification_state, 'null') || E'\n'
      || case when a.mpesa_transaction_id is null then ''
              else 'mpesa txn: ' || a.mpesa_transaction_id || E'\n' end
      || case when a.unlock_error is null then ''
              else 'unlock error: ' || a.unlock_error end,
    to_jsonb(a)
  from public.payment_intent_anomalies a
  where a.anomaly = 'paid_but_not_unlocked'
    and a.created_at < now() - interval '10 minutes'
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.raise_payment_anomaly_alerts() from anon, authenticated, public;
grant execute on function public.raise_payment_anomaly_alerts() to service_role;

-- ------------------------------------------------------------
-- 2. Deliver. Two jobs, and the second one is the point: pg_net is
--    fire-and-forget — net.http_post returns a request id and the webhook's
--    answer lands in net._http_response later — so without reconciling that
--    answer a webhook returning 404 would look exactly like one returning
--    200, and the alert would be silently lost. That is the same failure this
--    whole section exists to remove, one layer down.
-- ------------------------------------------------------------
create or replace function public.dispatch_ops_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_url text;
  v_request bigint;
  v_sent integer := 0;
begin
  -- 2a. Collect the answers to what previous runs sent.
  --
  --     net_request_id IS the in-flight handle, and this is what it is for:
  --     it is set when a request goes out and cleared here when its answer
  --     arrives. That is how the loop below tells "waiting on the webhook"
  --     from "ready to try again" — without it, the next tick would re-POST an
  --     alert whose first POST had not been answered yet, so a five-minute
  --     schedule would send five copies of the same alert to the channel.
  --
  --     delivery_error is deliberately NOT cleared here on failure: it is the
  --     last thing the webhook said, and that is exactly the line the operator
  --     needs when the alerts are not arriving.
  if to_regclass('net._http_response') is not null then
    update public.ops_alerts a
       set http_status = x.status_code,
           delivered_at = case when x.status_code between 200 and 299 then now() end,
           delivery_error = case
             when x.status_code between 200 and 299 then null
             when x.error_msg is not null then 'webhook request failed: ' || x.error_msg
             else 'webhook rejected the alert: HTTP ' || coalesce(x.status_code::text, '?')
                  || ' ' || left(coalesce(x.content, ''), 200)
           end,
           net_request_id = null
      from net._http_response x
     where a.net_request_id = x.id
       and a.net_request_id is not null
       and a.delivered_at is null;
  end if;

  -- 2b. The channel, read from Vault. A missing secret is not an error: the
  --     alerts stay recorded with the reason, and the operator sees the count
  --     in inspect_state.sql rather than wondering why nothing arrived.
  if to_regclass('vault.decrypted_secrets') is not null then
    select s.decrypted_secret into v_url
      from vault.decrypted_secrets s
     where s.name = 'OPS_ALERT_WEBHOOK_URL'
     limit 1;
  end if;

  -- net_request_id is null: nothing is in flight for this alert, so this run
  -- is either the first attempt or a retry after an answered failure.
  for r in
    select * from public.ops_alerts
     where delivered_at is null
       and net_request_id is null
       and dispatch_attempts < 5
     order by created_at
     limit 20
  loop
    if v_url is null or v_url = '' then
      -- Re-stated only when it would change, so a quiet database does not
      -- rewrite the same row every five minutes.
      update public.ops_alerts
         set delivery_error = 'no channel configured: create the Vault secret OPS_ALERT_WEBHOOK_URL (see DEPLOYMENT-CHECKLIST.md)'
       where id = r.id
         and delivery_error is distinct from 'no channel configured: create the Vault secret OPS_ALERT_WEBHOOK_URL (see DEPLOYMENT-CHECKLIST.md)';
      continue;
    end if;

    if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
      update public.ops_alerts
         set delivery_error = 'pg_net is not installed, so nothing can be sent: enable the pg_net extension'
       where id = r.id
         and delivery_error is distinct from 'pg_net is not installed, so nothing can be sent: enable the pg_net extension';
      continue;
    end if;

    -- One body for every channel: Slack and Telegram read 'text', Discord
    -- reads 'content', and each ignores what it does not know. The structured
    -- fields ride along for anything that wants them later.
    execute 'select net.http_post($1, $2, $3::jsonb, $4::jsonb, $5)'
       into v_request
      using v_url,
            jsonb_build_object(
              'text', r.body,
              'content', r.body,
              'message', r.body,
              'subject', r.subject,
              'kind', r.kind,
              'severity', r.severity,
              'intent_id', r.detail ->> 'id'
            ),
            '{}'::jsonb,
            jsonb_build_object('Content-Type', 'application/json'),
            10000;

    update public.ops_alerts
       set dispatch_attempts = r.dispatch_attempts + 1,
           net_request_id = v_request,
           dispatched_at = now()
     where id = r.id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.dispatch_ops_alerts() from anon, authenticated, public;
grant execute on function public.dispatch_ops_alerts() to service_role;

-- ------------------------------------------------------------
-- 3. The tick itself: one entry point for the schedule, so the order is
--    written down once. Expire first (an abandoned push the payer never paid
--    is not a stuck unlock), then raise, then deliver.
-- ------------------------------------------------------------
create or replace function public.payment_ops_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
  v_raised integer := 0;
  v_entitlement_raised integer := 0;
  v_dispatched integer := 0;
begin
  v_expired := public.expire_stale_payment_intents();
  v_raised := public.raise_payment_anomaly_alerts();
  v_entitlement_raised := public.raise_entitlement_anomaly_alerts();
  v_dispatched := public.dispatch_ops_alerts();

  return jsonb_build_object(
    'expired', v_expired,
    'raised', v_raised,
    'entitlement_raised', v_entitlement_raised,
    'dispatched', v_dispatched
  );
end;
$$;

revoke all on function public.payment_ops_tick() from anon, authenticated, public;
grant execute on function public.payment_ops_tick() to service_role;

-- ------------------------------------------------------------
-- 4. The schedule. Every five minutes: fast enough that a stuck unlock pages
--    the operator while the payer is still reachable, slow enough to be
--    nothing on a small project. Idempotent — re-running the chain replaces
--    the job rather than piling up a second one under the same name.
--
--    pg_cron not installed is a notice, not a failure: the chain still
--    applies, and this block prints the exact statement to run afterwards.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron is not installed, so the payment-ops-tick schedule was NOT created. Enable pg_cron (Dashboard -> Database -> Extensions), then run: select cron.schedule(''payment-ops-tick'', ''*/5 * * * *'', ''select public.payment_ops_tick()'');';
  else
    if exists (select 1 from cron.job where jobname = 'payment-ops-tick') then
      perform cron.unschedule('payment-ops-tick');
    end if;
    perform cron.schedule('payment-ops-tick', '*/5 * * * *', 'select public.payment_ops_tick()');
  end if;
end $$;


-- ============================================================
-- STAGE 5 — admin, settings and storage
-- the admin surface last: its RPCs read users, matches, reports and
-- app_settings, all of which the stages above create.
-- ============================================================

-- ---------- folded from supabase/sql/superseded/admin_role.sql ----------

-- ============================================================
-- ADMIN ROLE v2: server-side admin gating for Admin.jsx
--
-- v2 changes (Admin remediation):
--   * admin_add_campus / admin_set_campus_active /
--     admin_set_campus_matching now verify is_admin() INTERNALLY
--     (previously guarded only by GRANT — any authenticated user
--     could call them directly). Authorization happens inside the
--     privileged operation, not in the UI.
--   * admin_overview payments now read payment_intents (current
--     Force Connect / Connect / Section-2 payments). Legacy
--     token_purchases rows are merged in, marked 'legacy', so old
--     history stays visible. The legacy write path is preserved.
--   * New: admin user directory, user detail (audit-logged for
--     sensitive categories), and match-records views.
--
-- Idempotent: safe to re-run (if not exists / create or replace).
--
-- AFTER RUNNING, insert yourself as admin (SQL editor):
--   insert into public.admin_users (user_id)
--   values ('YOUR-AUTH-USER-UUID');
-- ============================================================

-- 1. Admin membership table. RLS on, NO client policies:
--    clients can neither read nor write it. Only the SQL
--    editor / service role manage membership.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- 1b. Audit log for admin access to sensitive user data.
--     RLS on, no client policies (admin-only, via definer fns).
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users(user_id) on delete cascade,
  target_user_id uuid,
  category text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- 2. Membership check used inside definer functions
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- 3. Client gate for the UI (returns your membership only)
create or replace function public.am_i_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

grant execute on function public.am_i_admin() to authenticated;

-- 4. One RPC for the admin dashboard (campuses + stats + payments)
create or replace function public.admin_overview()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select json_build_object(
    'campuses', (
      select coalesce(json_agg(c order by c.created_at), '[]'::json)
      from public.campuses c
    ),
    'stats', (
      select json_build_object(
        'totalUsers', (select count(*) from public.users),
        'activeUsers', (select count(*) from public.users where profile_status = 'active'),
        'section1Complete', (select count(*) from public.users where section1_complete),
        'section2Unlocked', (select count(*) from public.users where section2_unlocked),
        'totalMessages', (select count(*) from public.messages),
        'totalMatches', (select count(*) from public.matches),
        'pendingPayments', (
          select count(*) from public.payment_intents where status = 'pending'
        ),
        'openReports', (select count(*) from public.reports)
      )
    ),
    -- Current payment system: payment_intents (Force Connect KSh 80,
    -- Connect KSh 70/50, Section-2 KSh 200). Last 100 by recency.
    -- Completed intents are matched to their matching row so the
    -- admin sees who paid whom, without exposing contact data.
    'transactions', (
      select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      from (
        select
          pi.id,
          pi.user_id,
          u.full_name as user_name,
          pi.purpose,
          pi.amount,
          pi.status,
          pi.created_at,
          pi.mpesa_transaction_id,   -- was pi.mpesa_receipt: no such column
          null::text as legacy_marker
        from public.payment_intents pi
        left join public.users u on u.id = pi.user_id
        order by pi.created_at desc
        limit 100
      ) t
    ),
    'legacy_transactions', (
      select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      from (
        select
          tp.id,
          tp.user_id,
          u.full_name as user_name,
          'section2_unlock'::text as purpose,
          tp.amount,
          tp.status,
          tp.created_at,
          tp.mpesa_transaction_id,
          'legacy'::text as legacy_marker
        from public.token_purchases tp
        left join public.users u on u.id = tp.user_id
        order by tp.created_at desc
        limit 100
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_overview() to authenticated;

-- 5. Campus mutations — authorization INSIDE the operation.
create or replace function public.admin_add_campus(p_name text, p_email_domain text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public.set_entitlement_context(
    'campus_added',
    'admin added a campus: every student on this domain becomes signup-eligible',
    'auth.users',
    auth.uid()::text);

  insert into public.campuses (name, email_domain)
  values (p_name, lower(trim(p_email_domain)));
end;
$$;

create or replace function public.admin_set_campus_active(p_campus_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public.set_entitlement_context(
    'campus_flag_changed',
    'admin set is_active on a campus: this admits or blocks every student on its domain',
    'auth.users',
    auth.uid()::text);

  update public.campuses set is_active = p_value where id = p_campus_id;
end;
$$;

create or replace function public.admin_set_campus_matching(p_campus_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public.set_entitlement_context(
    'campus_flag_changed',
    'admin set matching_enabled on a campus: this decides whether its students are matched',
    'auth.users',
    auth.uid()::text);

  update public.campuses set matching_enabled = p_value where id = p_campus_id;
end;
$$;

grant execute on function
  public.admin_add_campus(text, text),
  public.admin_set_campus_active(uuid, boolean),
  public.admin_set_campus_matching(uuid, boolean)
to authenticated;

-- ============================================================
-- 6. ADMIN USER DIRECTORY
--    Paged, searchable list of registered users. Contains only
--    non-sensitive fields (no phone/whatsapp/contacts/photos).
--    p_q matches name/email; p_status filters profile_status
--    ('all' = no filter); p_sort: created|name;
--    p_asc: ascending when true. p_page is 0-based, 25 rows.
-- ============================================================
create or replace function public.admin_users_list(
  p_q text default null,
  p_status text default 'all',
  p_sort text default 'created',
  p_asc boolean default false,
  p_page integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  v_offset integer;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_offset := greatest(coalesce(p_page, 0), 0) * 25;

  select json_build_object(
    'total', (
      select count(*)
      from public.users ur
      where (coalesce(p_status, 'all') = 'all' or ur.profile_status = p_status)
        and (p_q is null or p_q = ''
             or ur.full_name ilike '%' || p_q || '%'
             or ur.email ilike '%' || p_q || '%')
    ),
    'users', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select
          ur.id,
          ur.full_name,
          ur.email,
          ur.gender,
          ur.age,
          ur.campus_id,
          c.name as campus_name,
          ur.profile_status,
          ur.section1_complete,
          ur.section2_unlocked,
          -- derived from profile_status: there is no users.is_active column
          (coalesce(ur.profile_status, '') = 'active') as is_active,
          -- profile_status is multi-valued ('incomplete' | 'active' | 'paused'
          -- | 'pending_deletion'), so the raw state is emitted alongside the
          -- boolean: a two-state chip cannot tell paused from pending deletion.
          coalesce(ur.profile_status, 'active') as status,
          ur.created_at
        from public.users ur
        left join public.campuses c on c.id = ur.campus_id
        where (coalesce(p_status, 'all') = 'all' or ur.profile_status = p_status)
          and (p_q is null or p_q = ''
               or ur.full_name ilike '%' || p_q || '%'
               or ur.email ilike '%' || p_q || '%')
        order by
          case when p_sort = 'name' and coalesce(p_asc, false)
               then lower(ur.full_name) end asc nulls last,
          case when p_sort = 'name' and not coalesce(p_asc, false)
               then lower(ur.full_name) end desc nulls last,
          case when coalesce(p_sort, 'created') <> 'name' and coalesce(p_asc, false)
               then ur.created_at end asc nulls last,
          case when coalesce(p_sort, 'created') <> 'name' and not coalesce(p_asc, false)
               then ur.created_at end desc nulls last,
          ur.id
        limit 25
        offset v_offset
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_users_list(text, text, text, boolean, integer) to authenticated;

-- ============================================================
-- 7. ADMIN USER DETAIL (audit-logged)
--    Server-authorized deep view of one user. Section 1: admin
--    always needs no reason. Sensitive categories (contacts,
--    questionnaire answers) require p_reason and are recorded in
--    admin_audit_log (admin id, target, category, reason, time).
--    p_categories: array subset of
--      'profile','status','questionnaire','contacts','matches'
-- ============================================================
create or replace function public.admin_user_detail(
  p_user_id uuid,
  p_categories text[] default array['profile','status'],
  p_reason text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  result json;
  v_sensitive boolean := false;
begin
  select au.user_id into v_admin
  from public.admin_users au
  where au.user_id = auth.uid();
  if v_admin is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if 'contacts' = any (p_categories) or 'questionnaire' = any (p_categories) then
    v_sensitive := true;
  end if;

  if v_sensitive and (p_reason is null or length(trim(p_reason)) < 4) then
    raise exception 'A reason (min 4 characters) is required to access contacts or questionnaire answers';
  end if;

  select json_build_object(
    'profile', (
      select row_to_json(t)
      from (
        select
          ur.id, ur.full_name, ur.email, ur.gender, ur.age, ur.bio,
          ur.created_at, ur.campus_id, c.name as campus_name
        from public.users ur
        left join public.campuses c on c.id = ur.campus_id
        where ur.id = p_user_id
      ) t
    ),
    'status', (
      -- Every key here names a column public.users actually has. There is
      -- no users.is_active, so 'active' state is derived from
      -- profile_status, the column that really carries
      -- 'active' | 'paused' | 'pending_deletion'; there is no
      -- users.share_social, so that flag is the OR of the three real
      -- share_social_* columns. The key names are kept as-is because
      -- Admin.jsx renders them (both as booleans).
      select json_build_object(
        'profile_status', ur.profile_status,
        -- multi-valued (see admin_users_list): raw state for the UI
        'status', coalesce(ur.profile_status, 'active'),
        'section1_complete', ur.section1_complete,
        'section2_unlocked', ur.section2_unlocked,
        'is_active', (coalesce(ur.profile_status, '') = 'active'),
        'interests', ur.interests,
        'share_phone', ur.share_phone,
        'share_whatsapp', ur.share_whatsapp,
        'share_social', (coalesce(ur.share_social_instagram, false)
                         or coalesce(ur.share_social_x, false)
                         or coalesce(ur.share_social_tiktok, false))
      )
      from public.users ur where ur.id = p_user_id
    ),
    'photos', (
      select coalesce(json_agg(row_to_json(p) order by p.display_order), '[]'::json)
      from public.photos p
      where p.user_id = p_user_id and p.photo_type in ('facial','full_body')
    ),
    -- user_responses is one row per user: responses_array holds the
    -- 50 answers by index (Postgres array, 1-based). Emit
    -- {question_number, responses_array} per question so the UI can
    -- map index -> option text.
    'questionnaire', case
      when 'questionnaire' = any (p_categories) then (
        select coalesce(
          json_agg(
            json_build_object(
              'question_number', qn.qn,
              'responses_array', ur2.responses_array[qn.qn]
            )
            order by qn.qn
          ),
          '[]'::json
        )
        from generate_series(1, 50) as qn(qn)
        join public.user_responses ur2 on ur2.user_id = p_user_id
      )
      else null
    end,
    'contacts', case
      when 'contacts' = any (p_categories) then (
        select json_build_object(
          'phone', ur.phone,
          'whatsapp_number', ur.whatsapp_number,
          -- There is no users.social_handles column: the handles live in
          -- three separate columns. Emitted as one text string because
          -- Admin.jsx renders it straight into JSX
          -- (`detail.contacts.social_handles || '—'`) and React refuses an
          -- object child. Empty (and so falsy) when no handle is set.
          'social_handles', concat_ws(' · ',
            nullif(ur.social_instagram, ''),
            nullif(ur.social_x, ''),
            nullif(ur.social_tiktok, ''))
        )
        from public.users ur where ur.id = p_user_id
      )
      else null
    end,
    'matches', case
      when 'matches' = any (p_categories) then (
        select coalesce(json_agg(row_to_json(m)), '[]'::json)
        from (
          select
            ma.id, ma.tier, ma.compatibility_score, ma.created_at,
            case when ma.user_a_id = p_user_id
                 then ma.user_b_id else ma.user_a_id end as partner_id,
            pu.full_name as partner_name
          from public.matches ma
          join public.users pu
            on pu.id = case when ma.user_a_id = p_user_id
                            then ma.user_b_id else ma.user_a_id end
          where ma.user_a_id = p_user_id or ma.user_b_id = p_user_id
          order by ma.created_at desc
          limit 50
        ) m
      )
      else null
    end
  ) into result
  from (select 1) x;

  if v_sensitive then
    insert into public.admin_audit_log (admin_id, target_user_id, category, details)
    values (
      v_admin, p_user_id,
      case
        when 'contacts' = any (p_categories) and 'questionnaire' = any (p_categories)
          then 'contacts+questionnaire'
        when 'contacts' = any (p_categories) then 'contacts'
        else 'questionnaire'
      end,
      json_build_object('reason', p_reason)
    );
  end if;

  return result;
end;
$$;

grant execute on function public.admin_user_detail(uuid, text[], text) to authenticated;

-- ============================================================
-- 8. ADMIN MATCH RECORDS
--    All match activity across all three types (tier1, tier2,
--    qrashe) plus the weekly delivery history. Read-only.
--    p_filter: 'all' | 'tier1' | 'tier2' | 'qrashe'
-- ============================================================
create or replace function public.admin_matches_list(
  p_filter text default 'all',
  p_page integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  v_offset integer;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_offset := greatest(coalesce(p_page, 0), 0) * 25;

  select json_build_object(
    'total', (
      select count(*)
      from public.matches ma
      where coalesce(p_filter, 'all') = 'all' or ma.tier = p_filter
    ),
    'matches', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select
          ma.id,
          ma.tier,
          ma.compatibility_score,
          ma.created_at,
          ma.user_a_id,
          ua.full_name as user_a_name,
          ma.user_b_id,
          ub.full_name as user_b_name,
          (exists (
            -- conversations has no match_id: it is keyed by the ordered
            -- user pair (unique (user_a_id, user_b_id)), so this match's
            -- conversation is the row carrying the same two users, in
            -- either order.
            select 1 from public.conversations cv
            where (cv.user_a_id = ma.user_a_id and cv.user_b_id = ma.user_b_id)
               or (cv.user_a_id = ma.user_b_id and cv.user_b_id = ma.user_a_id)
          )) as has_conversation
        from public.matches ma
        left join public.users ua on ua.id = ma.user_a_id
        left join public.users ub on ub.id = ma.user_b_id
        where coalesce(p_filter, 'all') = 'all' or ma.tier = p_filter
        order by ma.created_at desc
        limit 25
        offset v_offset
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_matches_list(text, integer) to authenticated;

-- ============================================================
-- NOTE: campuses table itself should also get RLS if it has
-- none (clients currently write it directly). Suggested:
--   alter table public.campuses enable row level security;
--   create policy campuses_read_all on public.campuses
--     for select to authenticated using (true);
-- (all writes then go through the admin_* functions above)
-- ============================================================

-- ---------- folded from supabase/sql/superseded/storage_rls.sql ----------

-- ============================================================
-- STORAGE RLS: profile_photos bucket (A01 — the one access-control
-- gap not closed by the earlier remediation commits)
--
-- Confirmed risk: Photos.jsx uploads to `${userId}/${slot}_....ext`
-- and deletes old objects at paths parsed from existing URLs —
-- the client TRUSTS the path. Without storage policies, any
-- authenticated user could overwrite or delete another user's
-- photos (BOLA on storage objects), and upload into another
-- user's folder.
--
-- Minimal fix: bucket stays PUBLIC READ (profile photos are the
-- product), but writes/deletes are path-scoped to the owner.
-- Idempotent; run in Supabase SQL Editor.
-- ============================================================

-- 1. Ensure the bucket exists with public read (no change if present)
insert into storage.buckets (id, name, public)
values ('profile_photos', 'profile_photos', true)
on conflict (id) do nothing;

-- 2. Read: public (profile photos are meant to be viewable)
drop policy if exists "profile_photos_public_read" on storage.objects;
create policy "profile_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'profile_photos');

-- 3. Insert: authenticated users may only write into THEIR OWN folder
drop policy if exists "profile_photos_owner_insert" on storage.objects;
create policy "profile_photos_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Update: owner only
drop policy if exists "profile_photos_owner_update" on storage.objects;
create policy "profile_photos_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Delete: owner only (blocks the Photos.jsx "cleanup" path from
--    being pointed at other users' objects)
drop policy if exists "profile_photos_owner_delete" on storage.objects;
create policy "profile_photos_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- VERIFY after running:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'profile_photos%';
--   → expect 4 rows (select/insert/update/delete)
-- ============================================================

-- ---------- D-2i: the bucket the app actually writes ----------

-- ============================================================
-- STORAGE RLS: user-photos bucket (D-2i — the app uploads here)
--
-- Every policy above names `profile_photos`. The app does not use
-- that bucket: PhotoUpload.jsx and Photos.jsx upload to
-- `${userId}/${slot...}.jpg` in `user-photos` (the userId is the
-- first path segment, and the public URL comes from getPublicUrl,
-- so the bucket stays public read). Without this block the bucket
-- that is actually written carries no storage policy at all, which
-- is the same BOLA gap A01 closed for `profile_photos`.
--
-- Identical shape, bucket name swapped: public read; insert,
-- update and delete restricted to the object's owner folder.
-- The profile_photos policies above are untouched.
-- Idempotent; run in Supabase SQL Editor.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('user-photos', 'user-photos', true)
on conflict (id) do nothing;

drop policy if exists "profile_photos_public_read_user_photos" on storage.objects;
create policy "profile_photos_public_read_user_photos"
  on storage.objects for select
  using (bucket_id = 'user-photos');

drop policy if exists "profile_photos_owner_insert_user_photos" on storage.objects;
create policy "profile_photos_owner_insert_user_photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_photos_owner_update_user_photos" on storage.objects;
create policy "profile_photos_owner_update_user_photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "profile_photos_owner_delete_user_photos" on storage.objects;
create policy "profile_photos_owner_delete_user_photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- VERIFY after running:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   and policyname like '%_user_photos';
--   → expect 4 rows (select/insert/update/delete)
-- ============================================================


-- ============================================================
-- STAGE 6 — entitlement evidence
--
-- The payment path already answers "why does this user have this?" from the
-- row itself: an intent carries its ticket, its verification, its unlock
-- outcome, and an audit view that classifies the rows where the story does not
-- add up. Every OTHER server-side grant in this schema now works the same way.
--
-- The grants this covers, and nothing else — the rest of a user row (bio,
-- interests, share_*, ...) is user content, not an entitlement, and must not
-- fill a ledger:
--   1. users.section2_free_expires_at    the 14-day trial, granted at signup
--   2. users.section2_unlocked           the paid Section 2 unlock
--   3. users.profile_status              pause / resume / pending deletion
--   4. section2_chat_progress.contacts_unlocked   the free 14-question reveal
--   5. connect_unlocks (insert)          the paid contact snapshot
--   6. matches (insert)                  the paid Qrashe pair
--   7. admin_users (insert/delete)       the admin role itself
--   8. campuses.is_active / matching_enabled / new campus
--   9. app_settings.maintenance_message  the banner every user sees
--
-- Three pieces, in the same shape as the payment one:
--   * a ledger — public.entitlement_grants — append-only, one row per change,
--     with the new state, the previous state, who did it, how, WHY, and a
--     pointer to the evidence. It has no cascade delete on purpose: the record
--     has to outlive the row it describes, or an account deletion erases its
--     own proof.
--   * one recorder trigger on the nine paths above. Grant paths do not insert
--     into the ledger themselves: they declare their reason with
--     public.set_entitlement_context(...) and the trigger writes the row. A
--     writer that declares nothing still gets recorded — with the reason
--     'no explicit reason recorded' and no evidence — because the point is that
--     no path can change an entitlement unrecorded, not that every path is
--     polite. The ledger is therefore a complete history, and the NEXT piece
--     decides which rows are acceptable.
--   * a verdict — public.entitlement_evidence_anomalies — re-derived from first
--     principles (is there a succeeded intent behind this unlock? does the trial
--     expiry match signup + 14 days, or was a different grant recorded?), the
--     same way payment_intent_anomalies re-derives the payment story instead of
--     trusting the columns. raise_entitlement_anomaly_alerts() feeds the rows it
--     finds into public.ops_alerts, so they arrive on the same channel and at
--     the same five-minute tick as a stuck payment.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The ledger.
-- ------------------------------------------------------------
create table if not exists public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subject_table text not null,
  -- uuid::text for rows keyed by uuid, '1' for app_settings; text because a
  -- ledger that only holds uuids cannot describe the whole schema.
  subject_id text not null,
  new_state jsonb not null,
  previous_state jsonb,
  reason text not null,
  -- Where the reason came from, so nothing has to string-match prose:
  -- 'declared' = the writer said why, 'evidence' = the writer said nothing but
  -- the recorder found the row that justifies it, 'none' = neither. A grant with
  -- 'none' is recorded (that is the point of the ledger) and unexplained (which
  -- is what the verdict and the report are for).
  reason_source text not null
    check (reason_source in ('declared', 'evidence', 'none')),
  evidence_table text,
  evidence_id text,
  actor uuid,
  -- Which role was behind the write, or the database role when no person was
  -- (service_role from an edge function, postgres from the SQL editor).
  actor_role text not null,
  route text not null,
  created_at timestamptz not null default now()
);

create index if not exists entitlement_grants_subject_idx
  on public.entitlement_grants (subject_table, subject_id, created_at desc);

-- The verdict scans for the newest grant of a paid kind per subject; without
-- this it would sort the whole ledger on every tick.
create index if not exists entitlement_grants_kind_idx
  on public.entitlement_grants (kind, subject_id, created_at desc);

alter table public.entitlement_grants enable row level security;

-- No policies: an append-only record that only the server writes. Clients read
-- their own entitlements from users/profiles_public, never from the audit trail.
revoke all on public.entitlement_grants from anon, authenticated;
grant select on public.entitlement_grants to service_role;

-- ------------------------------------------------------------
-- 2. The registry: the closed list of grants and the rule that justifies each.
--    A ledger row whose kind is not here is reported as a grant nobody
--    reviewed — the registry is what makes "we covered every grant" checkable
--    instead of a claim in a comment.
-- ------------------------------------------------------------
create table if not exists public.entitlement_grant_kinds (
  kind text primary key,
  subject_table text not null,
  what_changes text not null,
  evidence_rule text not null
);

insert into public.entitlement_grant_kinds (kind, subject_table, what_changes, evidence_rule) values
  ('section2_trial_14d', 'public.users',
   'section2_free_expires_at set to signup + 14 days',
   'expires_at is created_at + 14 days (within a 5-minute tolerance), or a different grant for the same value is recorded in the ledger'),
  ('section2_unlock_paid', 'public.users',
   'section2_unlocked becomes true — the payment callback applying the unlock, or a row created already unlocked',
   'a succeeded payment_intents row for that user, purpose section2, unlock_state applied; the trigger records that intent as the evidence even when the writer (payment-callback) declares none, so an unlock with no intent behind it is a finding'),
  ('connection_unlock_paid', 'public.connect_unlocks',
   'a paid contact snapshot row',
   'the row carries payment_intent_id and that intent is succeeded'),
  ('qrashe_match_paid', 'public.matches',
   'a Qrashe pair created for a paid Force Connect',
   'a succeeded intent for the paid connect of that pair, recorded as the evidence by the caller that holds the intent id'),
  ('chat_contacts_unlocked', 'public.section2_chat_progress',
   'contacts_unlocked false -> true after 14 questions',
   'the same row shows questions_discussed >= 14 (enforce_contacts_unlocked computes it, so the two cannot disagree)'),
  ('profile_status_pending_deletion', 'public.users',
   'profile_status -> pending_deletion',
   'the signed-in user requested it: actor = the row owner'),
  ('profile_status_paused', 'public.users',
   'profile_status -> paused: the profile leaves discovery',
   'the row owner paused their own profile (Settings.jsx updates their own row); actor = that user'),
  ('profile_status_resumed', 'public.users',
   'profile_status -> active: the profile returns to discovery',
   'the row owner resumed their own profile; actor = that user'),
  ('admin_role_granted', 'public.admin_users',
   'a user gains the admin role',
   'a ledger row exists for that user — granted by an admin through a function, or by a human with database credentials, in which case the record is the whole point'),
  ('admin_role_revoked', 'public.admin_users',
   'a user loses the admin role',
   'a ledger row exists for that user'),
  ('campus_added', 'public.campuses',
   'a campus exists',
   'a ledger row exists, naming the admin or the SQL editor'),
  ('campus_flag_changed', 'public.campuses',
   'is_active or matching_enabled changed',
   'a ledger row exists with the previous and new value, so an accidental flip is visible after the fact'),
  ('maintenance_message_changed', 'public.app_settings',
   'the maintenance banner every user sees',
   'a ledger row exists, plus app_settings.updated_by'),
  ('user_entitlement_changed', 'public.users',
   'an entitlement column changed in a way the recorder could not classify',
   'always reported: this kind means a path wrote an entitlement without a shape the registry knows')
on conflict (kind) do update
  set subject_table = excluded.subject_table,
      what_changes = excluded.what_changes,
      evidence_rule = excluded.evidence_rule;

revoke all on public.entitlement_grant_kinds from anon, authenticated;
grant select on public.entitlement_grant_kinds to service_role;

-- ------------------------------------------------------------
-- 3. Declaring a reason. Transaction-local, so it cannot leak into another
--    write, and cleared by the recorder the moment it is used — one context
--    describes one grant.
-- ------------------------------------------------------------
create or replace function public.set_entitlement_context(
  p_kind text,
  p_reason text,
  p_evidence_table text default null,
  p_evidence_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.entitlement_kind', coalesce(p_kind, ''), true);
  perform set_config('app.entitlement_reason', coalesce(p_reason, ''), true);
  perform set_config('app.entitlement_evidence_table', coalesce(p_evidence_table, ''), true);
  perform set_config('app.entitlement_evidence_id', coalesce(p_evidence_id, ''), true);
end;
$$;

revoke all on function public.set_entitlement_context(text, text, text, text) from anon, authenticated, public;
grant execute on function public.set_entitlement_context(text, text, text, text) to service_role;

-- ------------------------------------------------------------
-- 4. The recorder. One function, attached to the nine paths — so a path cannot
--    forget to record, only forget to explain.
-- ------------------------------------------------------------
create or replace function public.record_entitlement_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := nullif(current_setting('app.entitlement_kind', true), '');
  v_reason text := nullif(current_setting('app.entitlement_reason', true), '');
  v_evidence_table text := nullif(current_setting('app.entitlement_evidence_table', true), '');
  v_evidence_id text := nullif(current_setting('app.entitlement_evidence_id', true), '');
  v_role text;
  v_new jsonb := '{}'::jsonb;
  v_old jsonb;
  v_subject_id text;
  v_final_kind text;
  v_reason_source text;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    session_user
  );

  if tg_table_name = 'users' then
    v_subject_id := new.id::text;
    if tg_op = 'INSERT' then
      v_new := jsonb_strip_nulls(jsonb_build_object(
        'section2_unlocked', new.section2_unlocked,
        'section2_free_expires_at', new.section2_free_expires_at,
        'profile_status', new.profile_status));
      -- A row that starts with the trial is the standard signup; one that starts
      -- already unlocked is an unlock however it was created (which the evidence
      -- lookup below then has to justify); one that starts with neither means
      -- signup granted nothing, a shape the registry does not know and the
      -- verdict should say so about.
      v_final_kind := coalesce(v_kind,
        case when new.section2_unlocked then 'section2_unlock_paid'
             when new.section2_free_expires_at is not null then 'section2_trial_14d'
             else 'user_entitlement_changed' end);
    else
      if new.section2_unlocked is distinct from old.section2_unlocked then
        v_new := v_new || jsonb_build_object('section2_unlocked', new.section2_unlocked);
        v_old := coalesce(v_old, '{}'::jsonb) || jsonb_build_object('section2_unlocked', old.section2_unlocked);
      end if;
      if new.section2_free_expires_at is distinct from old.section2_free_expires_at then
        v_new := v_new || jsonb_build_object('section2_free_expires_at', new.section2_free_expires_at);
        v_old := coalesce(v_old, '{}'::jsonb) || jsonb_build_object('section2_free_expires_at', old.section2_free_expires_at);
      end if;
      if new.profile_status is distinct from old.profile_status then
        v_new := v_new || jsonb_build_object('profile_status', new.profile_status);
        v_old := coalesce(v_old, '{}'::jsonb) || jsonb_build_object('profile_status', old.profile_status);
      end if;
      -- Nothing entitlement-related moved: this is a bio edit or a settings
      -- toggle, and the ledger stays out of it.
      if v_new = '{}'::jsonb then
        return null;
      end if;
    end if;

  elsif tg_table_name = 'section2_chat_progress' then
    v_subject_id := coalesce(new.id, old.id)::text;
    -- The entitlement is the reveal, not the row: a pair that has answered three
    -- questions has a progress row and no grant, so an insert that leaves the
    -- contacts locked is not something to record. A flip in either direction is.
    if tg_op = 'UPDATE' and new.contacts_unlocked is not distinct from old.contacts_unlocked then
      return null;
    end if;
    if tg_op = 'INSERT' and not coalesce(new.contacts_unlocked, false) then
      return null;
    end if;
    v_new := jsonb_build_object(
      'contacts_unlocked', coalesce(new.contacts_unlocked, false),
      'questions_discussed', new.questions_discussed);
    v_old := case when tg_op = 'UPDATE' then jsonb_build_object('contacts_unlocked', old.contacts_unlocked) end;

  elsif tg_table_name = 'connect_unlocks' then
    v_subject_id := new.id::text;
    v_new := jsonb_build_object(
      'buyer_id', new.buyer_id, 'seller_id', new.seller_id,
      'tier', new.tier, 'amount', new.amount);
    if v_evidence_id is null and new.payment_intent_id is not null then
      v_evidence_table := 'public.payment_intents';
      v_evidence_id := new.payment_intent_id::text;
    end if;

  elsif tg_table_name = 'matches' then
    v_subject_id := new.id::text;
    v_new := jsonb_build_object(
      'user_a_id', new.user_a_id, 'user_b_id', new.user_b_id, 'status', new.status);

  elsif tg_table_name = 'admin_users' then
    if tg_op = 'DELETE' then
      v_subject_id := old.user_id::text;
      v_new := jsonb_build_object('user_id', old.user_id);
      v_old := jsonb_build_object('user_id', old.user_id);
      v_final_kind := coalesce(v_kind, 'admin_role_revoked');
    else
      v_subject_id := new.user_id::text;
      v_new := jsonb_build_object('user_id', new.user_id, 'granted_at', new.created_at);
      v_final_kind := coalesce(v_kind, 'admin_role_granted');
    end if;

  elsif tg_table_name = 'campuses' then
    v_subject_id := coalesce(new.id, old.id)::text;
    if tg_op = 'INSERT' then
      v_new := jsonb_build_object('name', new.name, 'is_active', new.is_active, 'matching_enabled', new.matching_enabled);
      v_final_kind := coalesce(v_kind, 'campus_added');
    else
      if new.is_active is distinct from old.is_active then
        v_new := v_new || jsonb_build_object('is_active', new.is_active);
        v_old := coalesce(v_old, '{}'::jsonb) || jsonb_build_object('is_active', old.is_active);
      end if;
      if new.matching_enabled is distinct from old.matching_enabled then
        v_new := v_new || jsonb_build_object('matching_enabled', new.matching_enabled);
        v_old := coalesce(v_old, '{}'::jsonb) || jsonb_build_object('matching_enabled', old.matching_enabled);
      end if;
      if v_new = '{}'::jsonb then
        return null;
      end if;
      v_final_kind := coalesce(v_kind, 'campus_flag_changed');
    end if;

  elsif tg_table_name = 'app_settings' then
    v_subject_id := coalesce(new.id, old.id)::text;
    if tg_op = 'UPDATE' and new.maintenance_message is not distinct from old.maintenance_message then
      return null;
    end if;
    v_new := jsonb_build_object('maintenance_message', new.maintenance_message);
    v_old := case when tg_op = 'UPDATE' then jsonb_build_object('maintenance_message', old.maintenance_message) end;

  else
    return null;
  end if;

  -- Classify when the path did not. 'user_entitlement_changed' is deliberately
  -- a reported kind: it means something wrote an entitlement in a shape the
  -- registry does not know, which is a finding, not a fallback.
  if v_final_kind is null then
    v_final_kind := case
      when v_new ? 'section2_free_expires_at' and (v_new ->> 'section2_free_expires_at') is not null
        then 'section2_trial_14d'
      when v_new ->> 'section2_unlocked' = 'true'
        then 'section2_unlock_paid'
      when v_new ? 'profile_status' and tg_table_name = 'users'
        then case v_new ->> 'profile_status'
                  when 'pending_deletion' then 'profile_status_pending_deletion'
                  when 'paused' then 'profile_status_paused'
                  when 'active' then 'profile_status_resumed'
                  else 'user_entitlement_changed' end
      when tg_table_name = 'section2_chat_progress'
        then 'chat_contacts_unlocked'
      when tg_table_name = 'connect_unlocks'
        then 'connection_unlock_paid'
      when tg_table_name = 'matches'
        then 'qrashe_match_paid'
      when tg_table_name = 'app_settings'
        then 'maintenance_message_changed'
      else 'user_entitlement_changed'
    end;
  end if;

  -- A paid unlock with no declared evidence is justified the same way the
  -- payment path justifies itself — by the intent that paid for it. The writer
  -- is an edge function holding the service role key, so the row is the proof;
  -- demanding a reason in prose from it would only produce a prose reason.
  if v_evidence_id is null and v_final_kind = 'section2_unlock_paid' then
    select 'public.payment_intents', pi.id::text
      into v_evidence_table, v_evidence_id
      from public.payment_intents pi
     where pi.user_id = new.id
       and pi.status = 'succeeded'
       and pi.purpose = 'section2'
       and coalesce(pi.unlock_state, '') = 'applied'
     order by pi.created_at desc
     limit 1;
  end if;

  -- A row either states why, or names the evidence that says why, or says
  -- plainly that it has neither. 'none' is therefore a precise statement —
  -- worth an operator's eye — and not a shrug.
  if v_reason is not null then
    v_reason_source := 'declared';
  elsif v_evidence_id is not null then
    v_reason_source := 'evidence';
    v_reason := 'no prose reason declared; the recorded evidence is '
      || v_evidence_table || ' ' || v_evidence_id;
  else
    v_reason_source := 'none';
    v_reason := 'no explicit reason recorded';
  end if;

  insert into public.entitlement_grants (
    kind, subject_table, subject_id, new_state, previous_state,
    reason, reason_source, evidence_table, evidence_id, actor, actor_role, route)
  values (
    v_final_kind,
    'public.' || tg_table_name,
    v_subject_id,
    v_new,
    v_old,
    v_reason,
    v_reason_source,
    v_evidence_table,
    v_evidence_id,
    auth.uid(),
    v_role,
    tg_table_name || ' ' || lower(tg_op) || ' (recorder trigger)');

  -- Consumed: one declared context describes one grant, never the next write in
  -- the same transaction.
  perform set_config('app.entitlement_kind', '', true);
  perform set_config('app.entitlement_reason', '', true);
  perform set_config('app.entitlement_evidence_table', '', true);
  perform set_config('app.entitlement_evidence_id', '', true);

  return null;
end;
$$;

-- ------------------------------------------------------------
-- 5. Attach it to the nine paths. IF NOT EXISTS on the trigger name keeps a
--    re-run from stacking a second copy of the recorder.
-- ------------------------------------------------------------
drop trigger if exists entitlement_evidence_users on public.users;
create trigger entitlement_evidence_users
  after insert or update on public.users
  for each row execute function public.record_entitlement_evidence();

drop trigger if exists entitlement_evidence_section2_chat_progress on public.section2_chat_progress;
create trigger entitlement_evidence_section2_chat_progress
  after insert or update on public.section2_chat_progress
  for each row execute function public.record_entitlement_evidence();

drop trigger if exists entitlement_evidence_connect_unlocks on public.connect_unlocks;
create trigger entitlement_evidence_connect_unlocks
  after insert on public.connect_unlocks
  for each row execute function public.record_entitlement_evidence();

drop trigger if exists entitlement_evidence_matches on public.matches;
create trigger entitlement_evidence_matches
  after insert on public.matches
  for each row execute function public.record_entitlement_evidence();

-- Grant and revoke are two directions of the same entitlement, so both are
-- recorded: a role that disappears silently is as unreviewable as one that
-- appears silently.
drop trigger if exists entitlement_evidence_admin_users on public.admin_users;
create trigger entitlement_evidence_admin_users
  after insert or delete on public.admin_users
  for each row execute function public.record_entitlement_evidence();

-- public.campuses is a PRECONDITION of this chain, not something it creates: the
-- header says so, the admin RPCs above call it, and nothing here defines it. A
-- plain `create trigger ... on public.campuses` would therefore turn an apply
-- that works on a project without campuses into one that fails, so the recorder
-- is installed only when the table is there. When it is not, the notice says so
-- and inspect_state.sql reports the campus paths as uncovered rather than
-- pretending they are guarded.
do $campus_recorder$
begin
  if to_regclass('public.campuses') is null then
    raise notice 'public.campuses does not exist (it is a precondition, not created here): the campus grant recorder is NOT installed. Re-run this chain after the campus DDL exists.';
  else
    execute 'drop trigger if exists entitlement_evidence_campuses on public.campuses';
    execute 'create trigger entitlement_evidence_campuses'
         || ' after insert or update on public.campuses'
         || ' for each row execute function public.record_entitlement_evidence()';
  end if;
end
$campus_recorder$;

-- app_settings is created by this chain (stage 1), so this one is unconditional.
drop trigger if exists entitlement_evidence_app_settings on public.app_settings;
create trigger entitlement_evidence_app_settings
  after insert or update on public.app_settings
  for each row execute function public.record_entitlement_evidence();

-- ------------------------------------------------------------
-- 6. The verdict. Same shape as payment_intent_anomalies: re-derive what should
--    be true, and report the rows where it is not.
-- ------------------------------------------------------------
create or replace view public.entitlement_evidence_anomalies
with (security_invoker = true) as
select *
from (
  -- A paid unlock with nothing that paid for it. The trial is excluded because
  -- a live trial is its own justification, checked by the next case.
  select
    'paid_unlock_without_evidence'::text as anomaly,
    'public.users'::text as subject_table,
    u.id::text as subject_id,
    jsonb_build_object(
      'section2_unlocked', u.section2_unlocked,
      'section2_free_expires_at', u.section2_free_expires_at,
      'granted_at', (select max(g.created_at) from public.entitlement_grants g
                      where g.subject_table = 'public.users' and g.subject_id = u.id::text
                        and g.kind = 'section2_unlock_paid'),
      'detail', 'section2_unlocked is true, the free trial is over, and no succeeded section2 intent with unlock_state=applied exists for this user'
    ) as detail
  from public.users u
  where u.section2_unlocked
    and (u.section2_free_expires_at is null or u.section2_free_expires_at <= now())
    and not exists (
      select 1 from public.payment_intents pi
       where pi.user_id = u.id and pi.status = 'succeeded' and pi.purpose = 'section2'
         and coalesce(pi.unlock_state, '') = 'applied'
    )

  union all
  -- A trial expiry that is neither signup + 14 days nor a grant somebody could
  -- explain. Recorded is not the same as reasoned: a hand-extended trial is
  -- recorded with reason_source 'none' (or only an evidence pointer), and it is
  -- exactly the comped entitlement that should be visible on the channel.
  select
    'trial_unexplained', 'public.users', u.id::text,
    jsonb_build_object(
      'section2_free_expires_at', u.section2_free_expires_at,
      'expected', u.created_at + interval '14 days',
      'explained', exists (select 1 from public.entitlement_grants g
                            where g.subject_table = 'public.users' and g.subject_id = u.id::text
                              and g.new_state ->> 'section2_free_expires_at' = u.section2_free_expires_at::text
                              and g.reason_source = 'declared'),
      'detail', 'section2_free_expires_at is not signup + 14 days and no grant states a reason for that exact value')
  from public.users u
  where u.section2_free_expires_at is not null
    and abs(extract(epoch from (u.section2_free_expires_at - (u.created_at + interval '14 days')))) > 300
    and not exists (select 1 from public.entitlement_grants g
                     where g.subject_table = 'public.users' and g.subject_id = u.id::text
                       and g.new_state ->> 'section2_free_expires_at' = u.section2_free_expires_at::text
                       and g.reason_source = 'declared')

  union all
  -- A paid grant recorded without the evidence that makes it paid.
  select
    'paid_grant_without_evidence', g.subject_table, g.subject_id,
    jsonb_build_object('kind', g.kind, 'grant_id', g.id, 'created_at', g.created_at,
      'detail', 'a paid grant was recorded with no evidence pointer')
  from public.entitlement_grants g
  where g.kind in ('section2_unlock_paid', 'connection_unlock_paid', 'qrashe_match_paid')
    and g.evidence_id is null

  union all
  -- ... or pointing at an intent that does not check out.
  select
    'grant_evidence_unresolvable', g.subject_table, g.subject_id,
    jsonb_build_object('kind', g.kind, 'grant_id', g.id, 'evidence_id', g.evidence_id,
      'detail', case when pi.id is null then 'the evidence intent no longer exists'
                     when pi.status <> 'succeeded' then 'the evidence intent is not succeeded (' || pi.status || ')'
                     else 'the evidence intent succeeded but its unlock never applied' end)
  from public.entitlement_grants g
  left join public.payment_intents pi on pi.id = g.evidence_id::uuid
  where g.evidence_table = 'public.payment_intents'
    and g.evidence_id is not null
    and (pi.id is null or pi.status <> 'succeeded'
         or (g.kind = 'section2_unlock_paid' and coalesce(pi.unlock_state, '') <> 'applied'))

  union all
  -- The admin role itself: every row must have a record of how it got there.
  select
    'admin_role_unrecorded', 'public.admin_users', au.user_id::text,
    jsonb_build_object('granted_at', au.created_at,
      'detail', 'this user holds the admin role and no grant of it was recorded')
  from public.admin_users au
  where not exists (select 1 from public.entitlement_grants g
                     where g.subject_table = 'public.admin_users'
                       and g.subject_id = au.user_id::text
                       and g.kind = 'admin_role_granted')

  union all
  -- The free reveal cannot disagree with the question count that grants it.
  select
    'chat_unlock_without_questions', 'public.section2_chat_progress', p.id::text,
    jsonb_build_object('questions_discussed', p.questions_discussed, 'contacts_unlocked', p.contacts_unlocked,
      'detail', 'contacts are unlocked while fewer than 14 questions were discussed')
  from public.section2_chat_progress p
  where p.contacts_unlocked and coalesce(p.questions_discussed, 0) < 14

  union all
  -- A grant in a shape nobody reviewed.
  select
    'grant_kind_unregistered', g.subject_table, g.subject_id,
    jsonb_build_object('kind', g.kind, 'grant_id', g.id,
      'detail', 'this grant kind is not in public.entitlement_grant_kinds, so nothing says what justifies it')
  from public.entitlement_grants g
  where not exists (select 1 from public.entitlement_grant_kinds k where k.kind = g.kind)

  union all
  -- Recorded, but the recorder could not tell what it was: a path wrote an
  -- entitlement in a shape the registry does not know. The change is on the
  -- record (which is the point of the ledger), and this says the shape needs a
  -- name before anyone can say what justifies it.
  select
    'grant_unclassified', g.subject_table, g.subject_id,
    jsonb_build_object('kind', g.kind, 'grant_id', g.id, 'new_state', g.new_state,
      'detail', 'an entitlement changed in a shape the recorder could not classify, so its reason is whatever the writer said')
  from public.entitlement_grants g
  where g.kind = 'user_entitlement_changed'
) a;

revoke all on public.entitlement_evidence_anomalies from anon, authenticated;
grant select on public.entitlement_evidence_anomalies to service_role;

-- ------------------------------------------------------------
-- 7. Alerting on the verdict, through the same channel and tick as a stuck
--    payment. A paid unlock with no evidence is critical; the rest is a
--    warning, because a hand-granted campus flag is a record to look at, not a
--    payment that went missing.
-- ------------------------------------------------------------
create or replace function public.raise_entitlement_anomaly_alerts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.ops_alerts (kind, dedupe_key, severity, subject, body, detail)
  select
    a.anomaly,
    a.anomaly || ':' || a.subject_table || ':' || a.subject_id,
    case when a.anomaly in ('paid_unlock_without_evidence', 'paid_grant_without_evidence',
                            'grant_evidence_unresolvable', 'chat_unlock_without_questions')
         then 'critical' else 'warning' end,
    'Entitlement without a checkable reason: ' || a.anomaly,
    'MingleMate — an entitlement is in a state its evidence does not support' || E'\n'
      || 'finding: ' || a.anomaly || E'\n'
      || 'subject: ' || a.subject_table || ' ' || a.subject_id || E'\n'
      || 'detail: ' || coalesce(a.detail ->> 'detail', a.detail::text),
    a.detail
  from public.entitlement_evidence_anomalies a
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.raise_entitlement_anomaly_alerts() from anon, authenticated, public;
grant execute on function public.raise_entitlement_anomaly_alerts() to service_role;

-- ============================================================
-- VERIFY after running:
--   -- the registry and the ledger should agree, and the verdict should be empty
--   -- on a schema whose grants are all paid for properly:
--   select * from public.entitlement_evidence_anomalies;
--   select kind, count(*) from public.entitlement_grants group by kind order by 1;
--   -- every grant the chain's own paths make should carry a reason:
--   select kind, reason, actor_role, route from public.entitlement_grants
--    where reason = 'no explicit reason recorded' order by created_at desc;
-- ============================================================

