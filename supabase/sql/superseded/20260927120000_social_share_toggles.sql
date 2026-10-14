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
-- 8f. Contact reveal — legacy free path now applies the per-handle
--     toggles live (paid snapshot above already bakes them in).
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
