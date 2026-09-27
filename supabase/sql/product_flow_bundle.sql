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
-- 3. matches — Qrashe pairs created ONLY by the verified KSh 80
--    Force Connect payment (complete_force_connect RPC). Tier 1/2
--    keep living in match_history (weekly engine untouched).
--    Pair stored ordered: user_a_id = least(id), user_b_id = greatest(id).
-- ------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references public.users(id) on delete cascade,
  user_b_id uuid not null references public.users(id) on delete cascade,
  tier text not null default 'qrashe' check (tier = 'qrashe'),
  created_by uuid references public.users(id),
  status text not null default 'active' check (status in ('active','unmatched')),
  created_at timestamptz not null default now(),
  unique (user_a_id, user_b_id)
);

alter table public.matches enable row level security;

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());
-- No client insert/update/delete: creation happens only inside
-- complete_force_connect (security definer, server-verified payment).

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

alter table public.conversations enable row level security;

drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());
-- Status changes (lock/unmatch) happen via security-definer RPCs only.

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

-- 8d. Paid Connect completion — called by payment-callback. Snapshots
--     the seller's currently-shared contacts (settings changes AFTER
--     payment never revoke this access), locks the conversation, and
--     posts the "[Name] connected with you." system message.
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

-- 8f. Contact reveal — paid snapshot first (immutable), then the
--     legacy free path (14-question guided unlock), which applies the
--     owner's CURRENT sharing flags live. Replaces get_match_contact.
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
  seller public.users;
begin
  if me is null or other_user_id is null then
    return;
  end if;

  -- 1) Paid snapshot: exactly what was enabled when they paid.
  select * into unlocked from public.connect_unlocks cu
  where cu.buyer_id = me and cu.seller_id = other_user_id;
  if found then
    return query select unlocked.phone, unlocked.whatsapp_number, unlocked.email,
      unlocked.social_instagram, unlocked.social_x, unlocked.social_tiktok;
    return;
  end if;

  -- 2) Legacy free path: guided conversation reached 14 questions and
  --    we are paired. Sharing flags applied live.
  if exists (
    select 1 from public.section2_chat_progress p
    where ((p.user_id_a = me and p.user_id_b = other_user_id)
        or (p.user_id_a = other_user_id and p.user_id_b = me))
      and p.contacts_unlocked = true
  ) and public.users_are_paired(me, other_user_id) then
    select * into seller from public.users where id = other_user_id;
    return query select
      case when seller.share_phone then seller.phone end,
      case when seller.share_whatsapp then seller.whatsapp_number end,
      case when seller.share_email then seller.email end,
      case when seller.share_social_instagram then seller.social_instagram end,
      case when seller.share_social_x then seller.social_x end,
      case when seller.share_social_tiktok then seller.social_tiktok end;
  end if;
end;
$$;
revoke all on function public.get_unlocked_contacts(uuid) from anon, public;
grant execute on function public.get_unlocked_contacts(uuid) to authenticated;

-- ------------------------------------------------------------
-- 9. PRIVACY FIX (reconciliation pass): profiles_public previously
--    exposed display_phone — which ProfileSetup actually fills with
--    the user's "email to share with match". It must never be
--    world-readable. Recreate the view WITHOUT it; contact data is
--    revealed exclusively via get_unlocked_contacts(). Grants on the
--    view object persist across create-or-replace.
-- ------------------------------------------------------------
create or replace view public.profiles_public
with (security_invoker = on) as
select
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, profile_status,
  section1_complete, section2_unlocked, section2_free_expires_at,
  created_at, profile_prompts, looking_for
from public.users;

-- harden_profile_reads granted display_phone directly on the base
-- table; the view fix alone would leave it readable there. Revoke
-- the column grant so this field is unreachable outside
-- get_unlocked_contacts / the owner's own row.
revoke select (display_phone) on public.users from anon, authenticated;

-- ------------------------------------------------------------
-- 10. Verify: connect_unlocks + matches + conversations + reports have
--     their policies; get_unlocked_contacts/discover_candidates exist.
-- ------------------------------------------------------------
