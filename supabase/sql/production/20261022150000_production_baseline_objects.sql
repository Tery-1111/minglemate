-- ============================================================
-- PRODUCTION BASELINE (1 of 2) — OBJECTS, CONSENT COLUMNS, READ PATHS
--
-- Target: project `minglemate`, ref mhdjnhiqahsllbczbzpk — the live
-- production database behind the Vercel production deployment.
--
-- WHY THIS IS NOT THE STAGING CHAIN
--   Staging (ifiewinipbxxfvzpzezd) was built from this repository's
--   migration chain, so 20261021120000 / 20261021130000 / 20261022130000
--   apply there as written. Production was never built from that chain.
--   A read-only capture on 2026-10-22 shows the legacy shape this file is
--   written against (full evidence: docs/PRODUCTION_SECTION2_MIGRATION.md):
--
--     * users has section2_unlocked / section2_free_expires_at, phone,
--       whatsapp_number, display_phone, email and a legacy
--       section2_responses array — but NO share_* flags and NO social
--       handle columns.
--     * matches is the legacy shape: user_a_id / user_b_id, status in
--       pending|interested|discarded|matched|ghosted, is_visible,
--       compatibility_score NOT NULL; pairs are 'matched', never 'active'.
--     * No user_blocks, connect_unlocks, payment_intents, conversations
--       or processed_payment_callbacks. No profiles_public, no
--       my_profile().
--     * No supabase_migrations schema: production carries no recorded
--       migration history.
--
--   Replaying the chain against this database is unsafe: its
--   matches-shape stage would reconcile a live table, and
--   20261022130000's complete_force_connect writes `conversations` before
--   it exists here. Production therefore gets its own compatible
--   migration, and its history records that adoption instead.
--
-- WHAT THIS FILE DOES
--   0. Refuses to run unless the captured production shape still holds.
--   1. Adds share_* consent columns (email defaults off, the rest on) and
--      social handle columns. No existing row is rewritten.
--   2. Creates user_blocks with participant RLS.
--   3. Creates payment_intents and processed_payment_callbacks as
--      server-only tables (RLS on, zero client policies, client
--      privileges revoked; the Edge Functions use service_role).
--   4. Creates connect_unlocks (one paid snapshot per buyer/seller, only
--      non-contact columns selectable by the buyer) and conversations.
--   5. Adds the read paths the client needs once direct contact access is
--      revoked in 20261022160000: profiles_public (public columns only,
--      security_invoker) and my_profile() (the caller's own row only).
--
-- WHAT IT DOES NOT DO
--   * No drop, no table/column removal, no row rewrite. The legacy
--     `payments` table is untouched and is not read as Connect evidence
--     (it has no purpose and no recipient, so a completed row cannot
--     prove a Connect purchase).
--   * No Section 2 policy or reveal change — that is the next file.
--
-- STATUS: APPLIED to minglemate (mhdjnhiqahsllbczbzpk) on 2026-10-22 —
--         recorded as version 20261022150000 in
--         supabase_migrations.schema_migrations.
--
-- NOT IN supabase/migrations/ ON PURPOSE. These files are production-only:
-- the chain-built databases (staging, local) already carry this shape, and
-- the matches-shape statements below target production's legacy matches
-- table. Keeping them out of the auto-applied folder means `supabase db
-- push` / `supabase start` can never replay them anywhere else.
-- 20260901000000_production_chain_replay_guard.sql aborts a push against
-- an adopted production database.
--
-- MUST RUN BEFORE 20261022160000_production_section2_contacts.sql
-- ============================================================

-- ------------------------------------------------------------
-- 0. Production shape preflight — abort before ANY change
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.users') is null then
    missing := array_append(missing, 'table public.users');
  end if;

  if to_regclass('public.section2_chat_progress') is null then
    missing := array_append(missing, 'table public.section2_chat_progress');
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'section2_chat_progress'
      and column_name in ('user_id_a', 'user_id_b', 'questions_discussed', 'contacts_unlocked')
    group by table_name having count(*) = 4
  ) then
    missing := array_append(missing, 'section2_chat_progress(user_id_a,user_id_b,questions_discussed,contacts_unlocked)');
  end if;

  if to_regclass('public.section2_responses') is null then
    missing := array_append(missing, 'table public.section2_responses');
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'section2_responses'
      and column_name in ('user_id', 'question_number', 'answer_text')
    group by table_name having count(*) = 3
  ) then
    missing := array_append(missing, 'section2_responses(user_id,question_number,answer_text)');
  end if;

  if to_regclass('public.match_history') is null then
    missing := array_append(missing, 'table public.match_history');
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'match_history'
      and column_name in ('user_id', 'tier1_match_id', 'tier2_match_id')
    group by table_name having count(*) = 3
  ) then
    missing := array_append(missing, 'match_history(user_id,tier1_match_id,tier2_match_id)');
  end if;

  if to_regclass('public.matches') is null then
    missing := array_append(missing, 'table public.matches');
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches'
      and column_name in ('user_a_id', 'user_b_id', 'status', 'is_visible', 'compatibility_score')
    group by table_name having count(*) = 5
  ) then
    missing := array_append(missing, 'matches(user_a_id,user_b_id,status,is_visible,compatibility_score)');
  end if;

  if to_regclass('public.messages') is null then
    missing := array_append(missing, 'table public.messages');
  end if;
  if to_regclass('public.notifications') is null then
    missing := array_append(missing, 'table public.notifications');
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    missing := array_append(missing, 'role authenticated');
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    missing := array_append(missing, 'role service_role');
  end if;
  if to_regprocedure('auth.uid()') is null then
    missing := array_append(missing, 'function auth.uid()');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'Production Section 2 compatibility assumptions are not met on this database: %. Nothing was changed.',
      array_to_string(missing, '; ');
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Contact consent + social handles
-- ------------------------------------------------------------
alter table public.users
  add column if not exists share_phone boolean not null default true,
  add column if not exists share_whatsapp boolean not null default true,
  add column if not exists share_email boolean not null default false,
  add column if not exists share_social_instagram boolean not null default true,
  add column if not exists share_social_x boolean not null default true,
  add column if not exists share_social_tiktok boolean not null default true,
  add column if not exists social_instagram text,
  add column if not exists social_x text,
  add column if not exists social_tiktok text;

-- ------------------------------------------------------------
-- 2. user_blocks — server-enforced blocking
-- ------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

drop policy if exists "blocks_select_involved" on public.user_blocks;
create policy "blocks_select_involved"
  on public.user_blocks for select
  to authenticated
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

drop policy if exists "blocks_insert_own" on public.user_blocks;
create policy "blocks_insert_own"
  on public.user_blocks for insert
  to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists "blocks_delete_own" on public.user_blocks;
create policy "blocks_delete_own"
  on public.user_blocks for delete
  to authenticated
  using (blocker_id = auth.uid());

revoke all on public.user_blocks from anon;
revoke insert, update on public.user_blocks from authenticated;
grant select, insert, delete on public.user_blocks to authenticated;

create index if not exists user_blocks_blocked_idx
  on public.user_blocks (blocked_id);

-- ------------------------------------------------------------
-- 3. payment_intents + processed_payment_callbacks (server-only)
-- ------------------------------------------------------------
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed')),
  checkout_request_id text unique,
  mpesa_transaction_id text unique,
  created_at timestamptz not null default now(),
  callback_key text,
  purpose text not null default 'section2'
    check (purpose in ('section2', 'connect_tier1', 'connect_tier2', 'connect_qrashe', 'force_connect')),
  recipient_user_id uuid references public.users(id)
);

alter table public.payment_intents enable row level security;

revoke all on public.payment_intents from anon;
revoke all on public.payment_intents from authenticated;
grant all on public.payment_intents to service_role;

create index if not exists payment_intents_user_created_idx
  on public.payment_intents (user_id, created_at desc);

create table if not exists public.processed_payment_callbacks (
  cache_key text primary key,
  created_at timestamptz not null default now()
);

alter table public.processed_payment_callbacks enable row level security;

revoke all on public.processed_payment_callbacks from anon;
revoke all on public.processed_payment_callbacks from authenticated;
grant all on public.processed_payment_callbacks to service_role;

-- ------------------------------------------------------------
-- 4. connect_unlocks + conversations
--
--    The snapshot is written only by complete_connect_unlock(intent_id),
--    after a succeeded intent, and only for the channels the owner shared
--    at purchase time. The reveal re-checks the owner's CURRENT choice.
-- ------------------------------------------------------------
create table if not exists public.connect_unlocks (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.users(id) on delete cascade,
  seller_id uuid not null references public.users(id) on delete cascade,
  tier text not null check (tier in ('tier1', 'tier2', 'qrashe')),
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

revoke all on public.connect_unlocks from public;
revoke all on public.connect_unlocks from anon;
revoke all on public.connect_unlocks from authenticated;
-- Buyer-only identity columns; the snapshot itself is not selectable.
grant select (id, buyer_id, seller_id, tier, created_at)
  on public.connect_unlocks to authenticated;
grant all on public.connect_unlocks to service_role;

create index if not exists connect_unlocks_buyer_idx
  on public.connect_unlocks (buyer_id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  match_tier text check (match_tier in ('tier1', 'tier2', 'qrashe')),
  status text not null default 'active'
    check (status in ('active', 'locked', 'unmatched')),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  check (user_a_id <> user_b_id)
);

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

revoke insert, update, delete on public.conversations from anon;
revoke insert, update, delete on public.conversations from authenticated;
grant select on public.conversations to authenticated;

create index if not exists conversations_participant_idx
  on public.conversations (user_a_id, user_b_id);

-- ------------------------------------------------------------
-- 5. Read paths for the client
--
--    20261022160000 revokes direct SELECT on the users contact columns,
--    so the app keeps a safe public projection and a self-only full row.
-- ------------------------------------------------------------
create or replace view public.profiles_public
with (security_invoker = true) as
select
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, profile_status, section1_complete, created_at
from public.users;

revoke all on public.profiles_public from anon;
revoke all on public.profiles_public from authenticated;
grant select on public.profiles_public to authenticated;

create or replace function public.my_profile()
returns setof public.users
language sql
security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;

revoke all on function public.my_profile() from public;
revoke all on function public.my_profile() from anon;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.my_profile() to service_role;

-- ------------------------------------------------------------
-- 6. Baseline marker
--
--    Read by 20260901000000_production_chain_replay_guard.sql to refuse a
--    chain replay against this database. No client access.
-- ------------------------------------------------------------
create table if not exists public.production_schema_baseline (
  id text primary key,
  applied_at timestamptz not null default now(),
  note text not null
);

alter table public.production_schema_baseline enable row level security;
revoke all on public.production_schema_baseline from anon;
revoke all on public.production_schema_baseline from authenticated;

insert into public.production_schema_baseline (id, note)
values (
  '2026-10-22-section2-contacts',
  'Adopted production baseline: Section 2 free access, D3 contact reveal, production-schema Force Connect. Applied as 20261022150000/20261022160000 from supabase/sql/production. The repository chain must not be replayed here.'
)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 7. Post-conditions
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.user_blocks') is null then
    missing := array_append(missing, 'user_blocks');
  end if;
  if to_regclass('public.payment_intents') is null then
    missing := array_append(missing, 'payment_intents');
  end if;
  if to_regclass('public.connect_unlocks') is null then
    missing := array_append(missing, 'connect_unlocks');
  end if;
  if to_regclass('public.conversations') is null then
    missing := array_append(missing, 'conversations');
  end if;
  if to_regclass('public.processed_payment_callbacks') is null then
    missing := array_append(missing, 'processed_payment_callbacks');
  end if;
  if to_regclass('public.profiles_public') is null then
    missing := array_append(missing, 'profiles_public');
  end if;
  if to_regprocedure('public.my_profile()') is null then
    missing := array_append(missing, 'my_profile()');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('share_phone', 'share_whatsapp', 'share_email',
                          'share_social_instagram', 'share_social_x', 'share_social_tiktok')
    group by table_name having count(*) = 6
  ) then
    missing := array_append(missing, 'users share_* columns');
  end if;

  if has_table_privilege('authenticated', 'public.payment_intents', 'select')
     or has_table_privilege('anon', 'public.payment_intents', 'select') then
    missing := array_append(missing, 'payment_intents is readable by a client role');
  end if;

  if has_column_privilege('authenticated', 'public.connect_unlocks', 'phone', 'select') then
    missing := array_append(missing, 'connect_unlocks.phone is selectable by authenticated');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Production baseline did not take effect: %', array_to_string(missing, '; ');
  end if;
end $$;
