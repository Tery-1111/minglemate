-- ============================================================
-- PRODUCTION ACCOUNT DELETION — two-phase, retention-safe
-- ============================================================
--
-- WHY THIS FILE EXISTS
--   Production (project mhdjnhiqahsllbczbzpk) contains neither
--   public.request_account_deletion(), public.finalize_account_deletion(uuid)
--   nor public.account_deletion_requests. Settings.jsx called the missing
--   zero-arg RPC and the PostgREST schema cache answered
--   "Could not find the function public.request_account_deletion by
--   parameters". This file is the targeted production artifact that adds
--   them. It is NOT the consolidated migration chain: production adopted a
--   baseline and its replay guard (20260901000000_production_chain_replay_guard)
--   aborts any attempt to replay the chain. Run this file alone.
--
-- THE SHAPE OF THE FIX
--   Phase 1  request_account_deletion()  — authenticated, zero args, identity
--            from auth.uid(). Records the request, pauses the profile, stops
--            notifications. Deletes nothing.
--   Phase 2  finalize_account_deletion(uuid) — service_role only. Anonymises
--            and detaches, then removes public.users. The Edge Function then
--            removes Storage objects and finally the auth user.
--
--   The auth user is deleted LAST, by the Edge Function, so that a failure
--   anywhere earlier leaves a retryable, still-authenticated user.
--
-- RETENTION (Privacy Policy: payment + contact-unlock evidence retained for
-- legal/dispute handling)
--   The live FKs currently CASCADE from auth.users / users, which would
--   destroy that evidence the moment the auth row is deleted. Section 2
--   converts them to ON DELETE SET NULL on nullable columns so the evidence
--   survives with the person detached. Section 3 expires pending intents so
--   a late callback cannot mint a new unlock after deletion was requested.
--
-- IDEMPOTENCY
--   Every statement is re-runnable. The finalizer is guarded on the request
--   and on the presence of public.users, so a retry after a partial run
--   (including after the public row is already gone) is safe.
--
-- NOT RUN HERE. Owner applies it in a controlled release.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Deletion-request table
--    One row per auth user. No Data API path: RLS on with no
--    policies, and no grants to anon/authenticated. service_role
--    bypasses RLS; that is the only reader/writer.
-- ------------------------------------------------------------
create table if not exists public.account_deletion_requests (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'processing', 'db_finalized')),
  attempts        integer not null default 0 check (attempts >= 0),
  requested_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_error      text,
  db_finalized_at timestamptz
);

comment on table public.account_deletion_requests is
  'Two-phase account deletion state. Service-role only; never exposed through the Data API.';

alter table public.account_deletion_requests enable row level security;

revoke all on table public.account_deletion_requests from anon, authenticated;
grant select, insert, update, delete on table public.account_deletion_requests to service_role;

-- ------------------------------------------------------------
-- 2. Retention-safe foreign keys
--    Evidence must outlive the account. Columns become nullable and the
--    delete action becomes SET NULL rather than CASCADE.
-- ------------------------------------------------------------

-- payment_intents.user_id -> auth.users
alter table public.payment_intents
  alter column user_id drop not null;
alter table public.payment_intents
  drop constraint if exists payment_intents_user_id_fkey;
alter table public.payment_intents
  add constraint payment_intents_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- payment_intents.recipient_user_id -> users (was NO ACTION: it made
-- `delete from public.users` fail outright for a paid recipient)
alter table public.payment_intents
  alter column recipient_user_id drop not null;
alter table public.payment_intents
  drop constraint if exists payment_intents_recipient_user_id_fkey;
alter table public.payment_intents
  add constraint payment_intents_recipient_user_id_fkey
  foreign key (recipient_user_id) references public.users(id) on delete set null;

-- payments.user_id -> auth.users
alter table public.payments
  alter column user_id drop not null;
alter table public.payments
  drop constraint if exists payments_user_id_fkey;
alter table public.payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- connect_unlocks.buyer_id / seller_id -> users
alter table public.connect_unlocks
  alter column buyer_id drop not null;
alter table public.connect_unlocks
  alter column seller_id drop not null;
alter table public.connect_unlocks
  drop constraint if exists connect_unlocks_buyer_id_fkey;
alter table public.connect_unlocks
  add constraint connect_unlocks_buyer_id_fkey
  foreign key (buyer_id) references public.users(id) on delete set null;
alter table public.connect_unlocks
  drop constraint if exists connect_unlocks_seller_id_fkey;
alter table public.connect_unlocks
  add constraint connect_unlocks_seller_id_fkey
  foreign key (seller_id) references public.users(id) on delete set null;

-- The unlock snapshot is retained but must not stay readable to a
-- remaining participant: get_unlocked_contacts() filters on buyer_id.
create index if not exists connect_unlocks_buyer_id_idx
  on public.connect_unlocks (buyer_id);
create index if not exists connect_unlocks_seller_id_idx
  on public.connect_unlocks (seller_id);
create index if not exists payment_intents_user_id_idx
  on public.payment_intents (user_id);
create index if not exists payment_intents_recipient_user_id_idx
  on public.payment_intents (recipient_user_id);

-- ------------------------------------------------------------
-- 3. Phase 1 — authenticated request RPC (supersedes the chain's
--    immediate-delete version; same zero-arg name, new
--    responsibility: initiate, do not delete).
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
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- 1. Record/refresh the request. Idempotent: a retry increments attempts
  --    and keeps db_finalized if it is already there.
  insert into public.account_deletion_requests (user_id, status, attempts)
  values (uid, 'processing', 1)
  on conflict (user_id) do update set
    status     = case when public.account_deletion_requests.status = 'db_finalized'
                      then 'db_finalized' else 'processing' end,
    attempts   = public.account_deletion_requests.attempts + 1,
    updated_at = now();

  -- 2. Stop discovery + notifications. profiles.onesignal_player_id is a
  --    separate mirrored copy in production and must be cleared too.
  update public.users set
    profile_status = 'paused',
    notifications_enabled = false,
    onesignal_player_id = null
  where id = uid;

  update public.profiles set
    onesignal_player_id = null
  where id = uid;

  return;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

-- ------------------------------------------------------------
-- 4. Phase 2 — service-role finalizer
--    Returns true when the database side is complete. Callable repeatedly.
-- ------------------------------------------------------------
create or replace function public.finalize_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.account_deletion_requests;
  v_redacted_phone constant text := '+000000000';
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22023';
  end if;

  select * into v_request
  from public.account_deletion_requests
  where user_id = p_user_id
  for update;

  if v_request is null then
    raise exception 'No account deletion request for %', p_user_id
      using errcode = 'P0002';
  end if;

  -- Already finalized: idempotent no-op (the auth user is deleted by the
  -- Edge Function afterwards, and a retry may land here again).
  if v_request.status = 'db_finalized' then
    return true;
  end if;

  -- ---------- Payment intents ----------
  -- Pending intents involving this user must never mint a new unlock.
  -- 'expired' is the only terminal value the live CHECK supports besides
  -- succeeded/failed. Succeeded rows are left untouched.
  update public.payment_intents
     set status = 'expired',
         status_reason = coalesce(status_reason, 'account_deleted'),
         callback_key = null,
         unlock_error = coalesce(unlock_error, 'account_deleted')
   where status = 'pending'
     and (user_id = p_user_id or recipient_user_id = p_user_id);

  -- Detach the person, keep the transaction evidence. The phone columns are
  -- NOT NULL, so redact with a non-routable placeholder rather than nulling.
  update public.payment_intents
     set user_id = null,
         phone = v_redacted_phone,
         callback_key = null,
         verification_detail = null
   where user_id = p_user_id;

  update public.payment_intents
     set recipient_user_id = null,
         callback_key = null
   where recipient_user_id = p_user_id;

  -- ---------- Payments ----------
  update public.payments
     set match_id = null
   where match_id in (select id from public.matches
                      where user_a_id = p_user_id or user_b_id = p_user_id);

  update public.payments
     set user_id = null,
         phone_number = v_redacted_phone
   where user_id = p_user_id;

  -- ---------- Contact-unlock snapshots (retained, detached) ----------
  -- Nulling BOTH sides removes the record from get_unlocked_contacts(),
  -- which filters on buyer_id, so a remaining participant can no longer
  -- read retained contact details.
  update public.connect_unlocks
     set buyer_id = null,
         seller_id = null
   where buyer_id = p_user_id or seller_id = p_user_id;

  -- ---------- Token purchases + gifts (evidence retained) ----------
  update public.token_purchases    set user_id = null    where user_id = p_user_id;
  update public.token_purchases    set gifted_by = null  where gifted_by = p_user_id;
  update public.gift_transactions  set gifter_user_id = null where gifter_user_id = p_user_id;
  update public.gift_transactions  set recipient_user_id = null where recipient_user_id = p_user_id;

  -- ---------- Payment prompts (not financial evidence) ----------
  delete from public.payment_prompts
   where sender_user_id = p_user_id or recipient_user_id = p_user_id;

  -- ---------- Messages ----------
  -- Sent: anonymise, keep the other side's thread coherent.
  update public.messages
     set content = '[deleted]',
         has_contact_info = false,
         sender_id_allows_bot = false,
         sender_id = null
   where sender_id = p_user_id;

  -- Received: remove.
  delete from public.messages where recipient_id = p_user_id;

  -- ---------- Notifications (before the auth row goes) ----------
  delete from public.notifications where user_id = p_user_id;

  -- ---------- Reports (safety evidence retained) ----------
  update public.reports set reporter_id = null where reporter_id = p_user_id;
  update public.reports set reported_id = null where reported_id = p_user_id;

  -- ---------- Matching / engagement ----------
  delete from public.likes        where user_id = p_user_id or target_user_id = p_user_id;
  delete from public.match_interactions where user_id = p_user_id;
  delete from public.match_queue  where user_id = p_user_id;
  delete from public.match_signals where user_id = p_user_id;
  delete from public.match_behavior where user_id = p_user_id
     or match_history_id in (select id from public.match_history where user_id = p_user_id);
  delete from public.compatibility_scores
   where user_id_a = p_user_id or user_id_b = p_user_id;
  delete from public.engagement_metrics where user_id = p_user_id;
  delete from public.question_engagement_metrics where user_id = p_user_id;
  delete from public.badges where user_id = p_user_id;
  delete from public.user_reputation where user_id = p_user_id;
  delete from public.section2_chat_progress
   where user_id_a = p_user_id or user_id_b = p_user_id;

  -- Other users' history keeps its rows; the dangling slot is cleared.
  update public.match_history set tier1_match_id = null
   where tier1_match_id in (select id from public.matches
                            where user_a_id = p_user_id or user_b_id = p_user_id);
  update public.match_history set tier2_match_id = null
   where tier2_match_id in (select id from public.matches
                            where user_a_id = p_user_id or user_b_id = p_user_id);

  delete from public.match_history where user_id = p_user_id;

  delete from public.matches
   where user_a_id = p_user_id or user_b_id = p_user_id;

  -- ---------- Photos / questionnaire / social graph ----------
  delete from public.photos           where user_id = p_user_id;
  delete from public.user_photos      where user_id = p_user_id;
  delete from public.user_responses   where user_id = p_user_id;
  delete from public.section1_responses where user_id = p_user_id;
  delete from public.section2_responses where user_id = p_user_id;
  delete from public.conversations    where user_a_id = p_user_id or user_b_id = p_user_id;
  delete from public.user_blocks      where blocker_id = p_user_id or blocked_id = p_user_id;

  -- ---------- Public user record ----------
  delete from public.users   where id = p_user_id;
  delete from public.profiles where id = p_user_id;

  -- ---------- Mark done (only now) ----------
  update public.account_deletion_requests
     set status = 'db_finalized',
         db_finalized_at = now(),
         updated_at = now(),
         last_error = null
   where user_id = p_user_id;

  return true;
end;
$$;

revoke all on function public.finalize_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;

-- ------------------------------------------------------------
-- 5. Record / report a failure without lying about progress.
-- ------------------------------------------------------------
create or replace function public.record_account_deletion_failure(
  p_user_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.account_deletion_requests
     set last_error = left(coalesce(p_error, 'unknown'), 500),
         status = case when status = 'db_finalized' then status else 'pending' end,
         updated_at = now()
   where user_id = p_user_id;
end;
$$;

revoke all on function public.record_account_deletion_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_account_deletion_failure(uuid, text)
  to service_role;

commit;
