-- ============================================================
-- SECTION 2 — D3 CONTACT REVEAL (payment AND owner consent only)
--
-- Owner decision D3 (docs/OWNER_DECISIONS_SECTION2_CONTACTS.md):
--
--   Contact details are revealed only when BOTH conditions hold:
--     * A succeeded Connect payment covers that specific match,
--       represented by connect_unlocks or the paid Connect snapshot.
--     * The contact owner has enabled the corresponding share_* flag.
--   Section 2 progress, completion or payment must never reveal
--   contacts.
--
-- WHY THIS IS A SEPARATE MIGRATION
--   20261021120000_section2_free_access_and_contacts.sql deliberately
--   left public.get_unlocked_contacts(uuid) untouched (its stage 3b) so
--   that the reveal replacement could be reviewed on its own. This file
--   carries that replacement.
--
-- 2026-10-22 LIVE CAPTURE — WHAT IT SETTLES HERE
--
--   docs/LIVE_SECTION2_SCHEMA.md records a read-only capture of the
--   target (project ref ifiewinipbxxfvzpzezd, minglemate-staging). It
--   confirms every shape this file depends on:
--
--   * public.connect_unlocks exists with the columns Stage 0 asserts
--     (id, buyer_id, seller_id, tier, amount, payment_intent_id, phone,
--     whatsapp_number, email, social_instagram, social_x, social_tiktok,
--     created_at) and UNIQUE(buyer_id, seller_id).
--   * public.users carries share_phone, share_whatsapp, share_email and
--     the three share_social_* flags.
--   * public.get_unlocked_contacts(uuid) exists exactly once, returning
--     TABLE(phone, whatsapp_number, email, social_instagram, social_x,
--     social_tiktok) — the signature Stage 0 checks.
--   * public.users_are_paired(uuid, uuid) exists and is the pairing guard
--     kept below.
--   * public.payments also exists on this schema, but this repository
--     never creates it and it carries no purpose or recipient column. The
--     earlier "the paid pair may live on payments" reading came from the
--     other project (minglemate, mhdjnhiqahsllbczbzpk) and does not apply
--     here. Nothing below reads payments.
--
--   The live body was captured too, and it fails D3 twice: the paid branch
--   returns the snapshot WITHOUT consulting the owner's share_* flags, and
--   a legacy branch returns live contact values whenever the pair's
--   section2_chat_progress.contacts_unlocked is true and
--   users_are_paired() passes. That is why this file replaces the function
--   instead of leaving it in place.
--
--   The capture also shows the snapshot side channel is real: connect_unlocks
--   still grants SELECT on every column to anon and authenticated, so
--   stage 2b below is required, not defensive.
--
-- BODIES THIS REPLACES — THE LIVE BODY, PLUS TWO REPOSITORY REVISIONS
--
--   The live body is captured (docs/LIVE_SECTION2_SCHEMA.md) and is
--   summarised above. The two revisions below are what the repository
--   evidences and explain why each condition exists. The live body matches
--   neither exactly: it keeps revision A's free branch, and its paid branch
--   has neither revision B's pairing guard nor any share-flag check.
--
--   Revision A — the OLDER chain as materialized in the local Supabase
--   database dumped on 2026-10-15 (audit-out/verify-2026-10-15/dumps/
--   A.norm.sql lines 1879-1918; that dump is chain-derived and is NOT the
--   project database — see the provenance section of
--   docs/LIVE_SECTION2_SCHEMA.md). Two branches: the paid snapshot, and a
--   legacy free branch returning live contact values whenever
--   section2_chat_progress.contacts_unlocked was true (the 14-question
--   reveal).
--
--   Revision B — the CURRENT repository chain
--   (20261014150000_consolidated_schema_chain.sql, "8f. Contact reveal —
--   PAID ONLY (F1)"). The legacy branch is already gone and the caller
--   must still be paired, but the paid branch returns the snapshot
--   WITHOUT consulting the owner's current share_* choice.
--
--   Against A, D3 fails twice: a free reveal, and ignored consent. Against
--   B, only the consent condition fails. This file enforces D3 under
--   either revision and keeps B's pairing guard, so it never widens an
--   existing check. If the live function has a different return type,
--   Stage 0 aborts before any change rather than guessing.
--
-- WHAT THIS MIGRATION DOES
--   1. Stage 0 refuses to change anything unless the live shape this
--      body depends on is exactly as expected (tables, columns, return
--      type of the existing function, auth.uid(), roles). A drifted
--      database aborts with the missing facts named.
--   2. Replaces get_unlocked_contacts(uuid) with a body that:
--        * returns nothing unless the caller and the owner are still a
--          paired match (the guard the deployed chain already applies,
--          kept so the replacement cannot widen it);
--        * returns nothing unless a connect_unlocks row exists for
--          THIS caller as buyer and THIS user as seller (the paid
--          snapshot is the payment evidence; complete_connect_unlock
--          writes it only after a verified succeeded intent and a
--          server-side pairing check);
--        * applies the owner's live share_* flag to each channel of
--          that snapshot, so revoking consent hides the channel even
--          after payment;
--        * has no legacy branch: no question count, no progress row,
--          no entitlement, trial or expiry column is read.
--   3. Re-asserts the ACL: PUBLIC and anon cannot execute; authenticated
--      can (the client calls it); service_role keeps its existing grant
--      because the ACL is not revoked from it.
--   3b. Closes the snapshot side channel. The deployed table grants
--      SELECT on every connect_unlocks column to anon and authenticated
--      (with RLS policy unlock_select_buyer), so a buyer could read the
--      snapshot contacts directly and bypass D3's consent condition.
--      SELECT on the six contact columns is revoked from both roles;
--      authenticated keeps the non-contact columns the client reads
--      (id, buyer_id, seller_id, tier, created_at). Server code uses
--      service_role and is unaffected.
--   4. Post-checks the stored body (prosrc) and the resulting privileges,
--      so a silent no-op replacement fails the migration instead of
--      leaving D3 unenforced.
--
-- WHAT THIS FILE DOES NOT DO
--   * No table, column, row or payment record is touched. Refunds and
--     retirement of old purchases remain open owner decisions.
--   * No other function is modified. get_match_contact was already
--     dropped by 20261021120000; the reveal surface is this function.
--   * It does not make the earlier migration safe to apply by itself.
--     That file still owns its own Stage 0, its policy replacement and the
--     retirement of get_match_contact(), so this one is applied AFTER it.
--
-- STATUS: APPLIED to minglemate-staging on 2026-10-22 — version
-- 20261021130000 recorded in supabase_migrations.schema_migrations (one
-- transaction; Stage 0 and every stage-3 post-check passed on the target).
--
-- MUST RUN AFTER 20261014150000
--
-- 2026-10-22 FINDINGS A–F — SUPERSEDED BY THE CAPTURE
--
--   The earlier findings A–F described the organization's other project
--   (minglemate, ref mhdjnhiqahsllbczbzpk): no users.share_* columns, no
--   connect_unlocks / payment_intents / user_blocks / conversations, and a
--   legacy public.payments with match_id and unlock_status. The capture of
--   the target (minglemate-staging) shows the opposite: the chain's objects
--   and share columns are present, and users has NO table-level SELECT
--   grant (only column-scoped reads that exclude phone, email,
--   whatsapp_number and display_phone). docs/SECTION2_LIVE_RECONCILIATION.md
--   records the correction.
--
--   Two consequences for this file:
--   1. Stage 0 will pass on the target, so the migration is no longer
--      blocked by a missing object. It is blocked only on authorization
--      to apply DDL.
--   2. The target's matches.status vocabulary ('matched', not 'active') is
--      handled in 20261021120000's is_section2_partner(). This file's
--      pairing guard stays public.users_are_paired(), unchanged: a
--      connect_unlocks row can only exist where that guard already passed
--      (complete_connect_unlock checks it before writing), so keeping it
--      cannot deny a purchase and cannot widen a reveal.
--
-- SAFETY / IDEMPOTENCE
--   * create or replace keeps the same return type, so no dependent
--     object is invalidated; re-running is a no-op.
--   * Every role action is catalog-guarded, so a local database without
--     the Supabase roles reports the gap instead of failing halfway.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Live-schema preflight — abort before ANY change
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
  v_overloads int;
  v_signature_ok boolean := false;
begin
  if to_regclass('public.connect_unlocks') is null then
    missing := array_append(missing, 'table public.connect_unlocks');
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'connect_unlocks'
      and column_name in ('id', 'buyer_id', 'seller_id', 'tier', 'created_at',
                          'phone', 'whatsapp_number', 'email',
                          'social_instagram', 'social_x', 'social_tiktok')
    group by table_name
    having count(*) = 11
  ) then
    missing := array_append(
      missing,
      'connect_unlocks(id,buyer_id,seller_id,tier,created_at,phone,whatsapp_number,email,social_instagram,social_x,social_tiktok)');
  end if;

  if to_regclass('public.users') is null then
    missing := array_append(missing, 'table public.users');
  elsif not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name in ('id', 'share_phone', 'share_whatsapp', 'share_email',
                          'share_social_instagram', 'share_social_x', 'share_social_tiktok')
    group by table_name
    having count(*) = 7
  ) then
    missing := array_append(
      missing,
      'users(id,share_phone,share_whatsapp,share_email,share_social_instagram,share_social_x,share_social_tiktok)');
  end if;

  -- A second overload of the same name would be a reveal path this file
  -- does not replace, so it is a blocker rather than a tolerated extra.
  select count(*) into v_overloads
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_unlocked_contacts';

  if v_overloads > 1 then
    missing := array_append(
      missing,
      'exactly one public.get_unlocked_contacts overload (found ' || v_overloads || ')');
  elsif v_overloads = 1 then
    -- CREATE OR REPLACE cannot change the return type. Both evidenced
    -- revisions return the six contact columns as text; anything else
    -- needs a drop-and-create with its dependants reviewed, not this file.
    -- proargmodes/proargnames include the IN argument first ('i'), then
    -- the six TABLE columns ('t'); proallargtypes is uuid + 6 text.
    select
      p.prorettype = 'record'::regtype
      and p.proargmodes = array['i', 't', 't', 't', 't', 't', 't']::"char"[]
      and p.proargnames = array['other_user_id', 'phone', 'whatsapp_number', 'email',
                                'social_instagram', 'social_x', 'social_tiktok']
      and (select array_agg(x.type_name order by x.ord)
           from (
             select a::regtype::text as type_name, o.ord
             from unnest(p.proallargtypes) with ordinality as o(a, ord)
           ) x) = array['uuid', 'text', 'text', 'text', 'text', 'text', 'text']
      and pg_get_function_identity_arguments(p.oid) = 'other_user_id uuid'
    into v_signature_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_unlocked_contacts';

    if not coalesce(v_signature_ok, false) then
      missing := array_append(
        missing,
        'public.get_unlocked_contacts(uuid) returning TABLE(phone,whatsapp_number,email,social_instagram,social_x,social_tiktok) of text');
    end if;
  end if;

  -- The pairing guard the deployed body already applies is kept, so this
  -- replacement can only narrow the reveal, never widen it.
  if to_regprocedure('public.users_are_paired(uuid, uuid)') is null then
    missing := array_append(missing, 'function public.users_are_paired(uuid, uuid)');
  end if;
  if to_regprocedure('auth.uid()') is null then
    missing := array_append(missing, 'function auth.uid()');
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    missing := array_append(missing, 'role authenticated');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'D3 contact-reveal migration assumptions are not met on this database: %. Nothing was changed.',
      array_to_string(missing, '; ');
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. The reveal: a paid Connect row AND the owner's live consent
--
--    Both conditions are evaluated on the same call. There is no
--    fallback branch: without the paid row the function returns no
--    rows, whatever the guided-chat progress or purchase history says.
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
  paid public.connect_unlocks;
  contact_owner public.users;
begin
  if me is null or other_user_id is null or me = other_user_id then
    return;
  end if;

  -- Pairing guard (kept from the deployed body): a paid pair cannot be
  -- unmatched, so this never revokes a reveal a payment already bought.
  if not public.users_are_paired(me, other_user_id) then
    return;
  end if;

  -- Condition 1: the Connect purchase for THIS buyer and THIS seller.
  -- The row is the paid snapshot complete_connect_unlock writes after a
  -- verified succeeded intent and a server-side pairing check, so its
  -- presence is the payment evidence. The latest row wins if history
  -- ever holds more than one for the pair.
  select cu.* into paid
  from public.connect_unlocks cu
  where cu.buyer_id = me
    and cu.seller_id = other_user_id
  order by cu.created_at desc
  limit 1;

  if not found then
    return;
  end if;

  -- Condition 2: the owner's consent as it stands now, per channel.
  -- A flag switched off after payment hides that channel; a value the
  -- snapshot never held stays null.
  select u.* into contact_owner
  from public.users u
  where u.id = other_user_id;

  if not found then
    return;
  end if;

  return query
    select
      case when contact_owner.share_phone then paid.phone end,
      case when contact_owner.share_whatsapp then paid.whatsapp_number end,
      case when contact_owner.share_email then paid.email end,
      case when contact_owner.share_social_instagram then paid.social_instagram end,
      case when contact_owner.share_social_x then paid.social_x end,
      case when contact_owner.share_social_tiktok then paid.social_tiktok end;
end;
$$;

comment on function public.get_unlocked_contacts(uuid) is
  'D3: returns a contact channel only when a Connect purchase for (auth.uid(), other_user_id) exists AND the owner currently shares that channel. Reads no Section 2 progress, entitlement, trial or expiry state.';

-- ------------------------------------------------------------
-- 2. Privileges: nobody but a signed-in user reaches the reveal
--
--    The ACL survives create or replace, so it is re-asserted here:
--    PUBLIC and anon lose EXECUTE, authenticated keeps it (the client
--    RPCs call it), service_role is left alone.
-- ------------------------------------------------------------
revoke all on function public.get_unlocked_contacts(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.get_unlocked_contacts(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.get_unlocked_contacts(uuid) to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2b. The snapshot is not a side channel
--
--     connect_unlocks carries the paid contact snapshot. With the
--     deployed GRANT ALL to anon/authenticated, a buyer (or anon, where
--     RLS is off) could select those columns directly and read a channel
--     the owner has since switched off, which is exactly what D3 forbids.
--     Column privileges are the only lever that hides a column under RLS.
-- ------------------------------------------------------------
revoke select on public.connect_unlocks from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke select on public.connect_unlocks from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke select on public.connect_unlocks from authenticated';
    execute 'grant select (id, buyer_id, seller_id, tier, created_at)
               on public.connect_unlocks to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Post-conditions — prove the replacement took effect
--
--    A body that still names the removed inputs, or an ACL that leaked
--    EXECUTE, fails the migration instead of leaving D3 silently
--    unenforced.
-- ------------------------------------------------------------
do $$
declare
  v_src text;
  v_secdef boolean;
  v_settings text[];
begin
  select p.prosrc, p.prosecdef, p.proconfig
  into v_src, v_secdef, v_settings
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_unlocked_contacts'
    and pg_get_function_identity_arguments(p.oid) = 'other_user_id uuid';

  if v_src is null then
    raise exception 'get_unlocked_contacts(uuid) is missing after replacement';
  end if;

  if v_src ~* '(section2_chat_progress|contacts_unlocked|section2_unlocked|section2_free_expires_at|questions_discussed|section2_responses)' then
    raise exception 'get_unlocked_contacts still reads Section 2 state (D3 violation)';
  end if;

  if v_src !~* 'connect_unlocks' or v_src !~* 'share_phone' then
    raise exception 'get_unlocked_contacts does not gate on both D3 conditions';
  end if;

  if v_src !~* 'users_are_paired' then
    raise exception 'get_unlocked_contacts dropped the deployed pairing guard';
  end if;

  if not v_secdef or v_settings is distinct from array['search_path=public'] then
    raise exception 'get_unlocked_contacts must stay SECURITY DEFINER with search_path=public (got secdef=%, settings=%)',
      v_secdef, v_settings;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.get_unlocked_contacts(uuid)', 'execute') then
    raise exception 'anon can still execute get_unlocked_contacts';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and not has_function_privilege('authenticated', 'public.get_unlocked_contacts(uuid)', 'execute') then
    raise exception 'authenticated lost EXECUTE on get_unlocked_contacts';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if has_column_privilege('authenticated', 'public.connect_unlocks', 'phone', 'select') then
      raise exception 'authenticated can still read connect_unlocks.phone directly (D3 side channel)';
    end if;
    if not has_column_privilege('authenticated', 'public.connect_unlocks', 'id', 'select') then
      raise exception 'authenticated lost SELECT on connect_unlocks.id; the Connect CTA reads it';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_column_privilege('anon', 'public.connect_unlocks', 'phone', 'select') then
    raise exception 'anon can still read connect_unlocks.phone directly (D3 side channel)';
  end if;
end $$;
