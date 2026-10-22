-- ============================================================
-- FORCE CONNECT AND PAIRING STATUS — match the live `matches` shape
--
-- STATUS: APPLIED to minglemate-staging on 2026-10-22 — version
--         20261022130000 recorded in supabase_migrations.schema_migrations.
--         This file is the repository record of the definitions now live;
--         it is not a pending change.
--
-- APPLIED ORDER: after 20261021130000. The functions below depend only on
-- the chain's objects (matches, match_history, conversations, messages,
-- notifications), not on the Section 2 migrations.
--
-- WHY THIS EXISTS
--   Two defects were reported by the Section 2 live capture
--   (docs/LIVE_SECTION2_SCHEMA.md) and fixed on the target before this
--   file was written:
--
--   1. users_are_paired() accepted only matches.status = 'active', a value
--      this schema cannot store (matches_status_check admits pending,
--      interested, discarded, matched, ghosted) and one no row uses. It also
--      treated NULLs and self-pairs as "paired". Every live pair is
--      'matched', so the function denied real pairs unless a match_history
--      row happened to cover them — which is exactly what Connect checks
--      (complete_connect_unlock) and the D3 reveal guard rely on.
--
--   2. complete_force_connect() inserted into matches(tier, created_by),
--      columns this matches table does not have, so every Force Connect
--      callback failed after a successful payment. It also keyed
--      idempotency on the matches row, which is 'pending' until the
--      insert succeeds.
--
-- WHAT THIS MIGRATION DOES
--   1. Replaces users_are_paired(uuid, uuid): match_history in either
--      direction, or a matches row in either direction whose status is
--      'active' or 'matched'; NULL arguments and a = b return false.
--      'interested' stays excluded — it is one-sided.
--   2. Replaces complete_force_connect(uuid): locks the intent row, keeps
--      the succeeded/force_connect/recipient checks, uses the live matches
--      shape (status, is_visible, compatibility_score), promotes an
--      existing pair instead of inserting a duplicate, and treats the
--      active Qrashe conversation as the idempotency marker so repeated
--      callbacks cannot double-write messages or notifications.
--   3. Re-asserts the function ACL captured live: PUBLIC and anon cannot
--      execute; authenticated and service_role can.
--
-- WHAT IT DOES NOT DO
--   * No table, column, row or payment record is touched.
--   * No other function is modified; complete_force_connect keeps the ACL
--     create-or-replace preserves (service_role only).
--   * It does not re-apply anything. The target already carries these
--     definitions; a fresh database gets them here.
--
-- SAFETY / IDEMPOTENCE
--   * create or replace keeps the same signatures and return types.
--   * Every role action is catalog-guarded, so a database without the
--     Supabase roles reports the gap instead of failing halfway.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Pairing: match_history either direction OR a matched pair
--
--    The NULL / self-pair guards are part of the live definition: without
--    them a NULL argument makes the EXISTS clauses unhelpfully true-ish
--    and a user is "paired" with themselves.
-- ------------------------------------------------------------
create or replace function public.users_are_paired(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select a is not null
     and b is not null
     and a <> b
     and (
       exists (
         select 1
         from public.match_history mh
         where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
            or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
       )
       or exists (
         select 1
         from public.matches m
         where m.status in ('active', 'matched')
           and ((m.user_a_id = a and m.user_b_id = b)
             or (m.user_a_id = b and m.user_b_id = a))
       )
     );
$$;

-- ------------------------------------------------------------
-- 2. Force Connect: the live matches shape, idempotent per pair
-- ------------------------------------------------------------
create or replace function public.complete_force_connect(intent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  it public.payment_intents;
  buyer public.users;
  target public.users;
  pair_a uuid;
  pair_b uuid;
  affected_rows integer;
BEGIN
  -- Serialize duplicate payment callbacks for this intent.
  SELECT pi.* INTO it
  FROM public.payment_intents pi
  WHERE pi.id = intent_id
  FOR UPDATE;

  IF it.id IS NULL
     OR it.purpose <> 'force_connect'
     OR it.recipient_user_id IS NULL
     OR it.status <> 'succeeded' THEN
    RETURN;
  END IF;

  SELECT u.* INTO buyer FROM public.users u WHERE u.id = it.user_id;
  SELECT u.* INTO target FROM public.users u WHERE u.id = it.recipient_user_id;

  IF buyer.id IS NULL OR target.id IS NULL OR buyer.id = target.id THEN
    RETURN;
  END IF;

  pair_a := least(buyer.id, target.id);
  pair_b := greatest(buyer.id, target.id);

  -- The active Qrashe conversation is the idempotency marker.
  -- The payment callback may be delivered repeatedly.
  IF EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.user_a_id = pair_a
      AND c.user_b_id = pair_b
      AND c.match_tier = 'qrashe'
      AND c.status = 'active'
  ) THEN
    RETURN;
  END IF;

  -- This schema stores pair identity/status in matches; it has no tier
  -- or created_by columns. Promote an existing pair or create one.
  UPDATE public.matches m
  SET status = 'matched',
      is_visible = true,
      last_interaction_at = now()
  WHERE (m.user_a_id = pair_a AND m.user_b_id = pair_b)
     OR (m.user_a_id = pair_b AND m.user_b_id = pair_a);

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows = 0 THEN
    INSERT INTO public.matches (
      user_a_id, user_b_id, status, is_visible, compatibility_score
    )
    VALUES (pair_a, pair_b, 'matched', true, 0);
  END IF;

  INSERT INTO public.conversations (
    user_a_id, user_b_id, match_tier, status, locked_at
  )
  VALUES (pair_a, pair_b, 'qrashe', 'active', NULL)
  ON CONFLICT (user_a_id, user_b_id) DO UPDATE
    SET status = 'active',
        locked_at = NULL,
        match_tier = 'qrashe';

  INSERT INTO public.messages (sender_id, recipient_id, content, is_bot)
  VALUES (
    buyer.id, target.id,
    '⚡ ' || buyer.full_name || ' sent you a Force Connect. You are now matched.',
    true
  );

  INSERT INTO public.notifications (user_id, message)
  VALUES (
    target.id,
    '⚡ Force Connect: ' || buyer.full_name || ' connected with you.'
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. ACL: PUBLIC and anon cannot execute; signed-in users can
--
--    Captured live ACL on users_are_paired is
--    {postgres=X, authenticated=X, service_role=X} — no PUBLIC entry, no
--    anon. Re-asserted here so a fresh database matches.
-- ------------------------------------------------------------
revoke all on function public.users_are_paired(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.users_are_paired(uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.users_are_paired(uuid, uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.users_are_paired(uuid, uuid) to service_role';
  end if;
end $$;
