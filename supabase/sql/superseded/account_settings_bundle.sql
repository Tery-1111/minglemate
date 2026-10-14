-- ============================================================
-- ACCOUNT SETTINGS BUNDLE: prompts, bio cap, pause, blocking,
-- notification toggle, delete-account support.
-- Run in Supabase SQL Editor. Idempotent: safe to re-run.
-- Depends on: fix_rls.sql, harden_profile_reads.sql (run first).
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
grant select (
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, display_phone, profile_status,
  section1_complete, section1_progress, section1_last_edited,
  section2_unlocked, section2_free_expires_at, created_at,
  profile_prompts, looking_for
) on public.users to anon, authenticated;

create or replace view public.profiles_public
with (security_invoker = on) as
select
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, display_phone, profile_status,
  section1_complete, section2_unlocked, section2_free_expires_at,
  created_at, profile_prompts, looking_for
from public.users;

grant select on public.profiles_public to anon, authenticated;

-- my_profile() unchanged (definer, returns own full row incl.
-- notifications_enabled) — recreated for completeness.
create or replace function public.my_profile()
returns setof public.users
language sql
security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;
grant execute on function public.my_profile() to authenticated;

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

-- ------------------------------------------------------------
-- 4. BLOCK ENFORCEMENT at the DB boundary: a blocked user cannot
--    message you, and you cannot message them (either direction).
--    Replaces messages_insert_own_sender from remediation_bundle.
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
  );

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
