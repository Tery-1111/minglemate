-- ============================================================================
-- C2 — unmatch_conversation: canonical definition + execution privilege repair
-- ============================================================================
-- Problem
--   1. The staging definition diverges from the verified production definition.
--      Staging grants EXECUTE to PUBLIC (shown as "=X") and to anon, so an
--      unauthenticated caller can invoke a SECURITY DEFINER function that writes
--      conversations and matches rows. The function's own auth.uid() check
--      rejects the write, but the grant is still an unnecessary attack surface
--      and an inconsistency with production (anon = false).
--   2. This migration pins the exact approved body so both environments converge
--      on one definition.
--
-- Scope
--   Replaces exactly one function and tightens its EXECUTE grants. No table,
--   column, policy, trigger or row is modified.
--
-- Preserved semantics (approved specification)
--   * Authenticated caller required (auth.uid() not null).
--   * Null and self-pair rejection.
--   * Pairing verification via public.users_are_paired.
--   * Refuse unmatch after Connect (connect_unlocks present either direction).
--   * Canonical pair ordering (least/greatest).
--   * Conversation status set to 'unmatched'.
--   * matches transition 'matched' -> 'discarded' with discarded_at.
--   * service_role execution preserved.
--
-- Qrashe semantics are NOT redesigned here: the tier expression is carried over
-- verbatim from the verified definition (tier2 detected from match_history,
-- otherwise tier1). Repeated-unmatch behaviour is likewise unchanged: the
-- ON CONFLICT clause only rewrites a row whose status is currently 'active', so
-- a second call leaves an already-'unmatched' conversation untouched.
--
-- Safety
--   Preconditions assert every referenced column exists, so the migration fails
--   closed on a database whose schema does not match expectations rather than
--   creating a function that errors at call time.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preconditions: dependencies referenced by the function body.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  if to_regprocedure('public.unmatch_conversation(uuid)') is null then
    raise exception
      'C2 precondition failed: function public.unmatch_conversation(uuid) does not exist';
  end if;

  -- Helper the function delegates pairing to.
  if to_regprocedure('public.users_are_paired(uuid,uuid)') is null then
    raise exception
      'C2 precondition failed: helper public.users_are_paired(uuid,uuid) does not exist';
  end if;

  -- Every column the body reads or writes must exist.
  select string_agg(req.tbl_col, ', ') into missing
    from (values
      ('connect_unlocks.buyer_id'),
      ('connect_unlocks.seller_id'),
      ('conversations.user_a_id'),
      ('conversations.user_b_id'),
      ('conversations.match_tier'),
      ('conversations.status'),
      ('match_history.user_id'),
      ('match_history.tier2_match_id'),
      ('matches.status'),
      ('matches.discarded_at'),
      ('matches.user_a_id'),
      ('matches.user_b_id')
    ) as req(tbl_col)
   where not exists (
     select 1
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name  = split_part(req.tbl_col, '.', 1)
        and c.column_name = split_part(req.tbl_col, '.', 2)
   );

  if missing is not null then
    raise exception 'C2 precondition failed: missing column(s): %', missing;
  end if;

  -- The ON CONFLICT target must exist, otherwise the upsert cannot run.
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.conversations'::regclass
       and contype  = 'u'
       and pg_get_constraintdef(oid) like '%(user_a_id, user_b_id)%'
  ) then
    raise exception
      'C2 precondition failed: conversations has no UNIQUE(user_a_id, user_b_id) constraint';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The correction.
-- ---------------------------------------------------------------------------
create or replace function public.unmatch_conversation(other_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me uuid := auth.uid(); pair_a uuid; pair_b uuid; tier text;
begin
  if me is null or other_user_id is null or me = other_user_id then raise exception 'Not authenticated'; end if;
  if not public.users_are_paired(me, other_user_id) then raise exception 'You are not matched with this person'; end if;
  if exists (select 1 from public.connect_unlocks cu where (cu.buyer_id = me and cu.seller_id = other_user_id) or (cu.buyer_id = other_user_id and cu.seller_id = me)) then raise exception 'Cannot unmatch after Connect'; end if;
  pair_a := least(me, other_user_id); pair_b := greatest(me, other_user_id);
  tier := case when exists (select 1 from public.match_history mh where (mh.user_id = me and mh.tier2_match_id = other_user_id) or (mh.user_id = other_user_id and mh.tier2_match_id = me)) then 'tier2' else 'tier1' end;
  insert into public.conversations (user_a_id, user_b_id, match_tier, status) values (pair_a, pair_b, tier, 'unmatched')
    on conflict (user_a_id, user_b_id) do update set status = 'unmatched' where public.conversations.status = 'active';
  update public.matches set status = 'discarded', discarded_at = now()
    where status = 'matched' and ((user_a_id = pair_a and user_b_id = pair_b) or (user_a_id = pair_b and user_b_id = pair_a));
end; $function$;

-- ---------------------------------------------------------------------------
-- Privilege repair: remove PUBLIC and anon EXECUTE, keep service_role.
-- Revoking PUBLIC also removes the implicit grant anon/authenticated inherit
-- from PUBLIC, so authenticated is re-granted explicitly to preserve app access.
-- ---------------------------------------------------------------------------
revoke all on function public.unmatch_conversation(uuid) from public;
revoke all on function public.unmatch_conversation(uuid) from anon;
grant execute on function public.unmatch_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_rec record;
begin
  select pg_get_functiondef(p.oid)                       as def,
         pg_get_function_identity_arguments(p.oid)       as args,
         p.prorettype::regtype::text                           as ret,
         p.prosecdef                                     as secdef,
         p.provolatile                                   as volatility,
         p.proconfig::text                               as cfg,
         r.rolname                                       as owner
    into v_rec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r     on r.oid = p.proowner
   where n.nspname = 'public' and p.proname = 'unmatch_conversation';

  if not found then
    raise exception 'C2 postcondition failed: unmatch_conversation does not exist after apply';
  end if;

  v_def := v_rec.def;

  -- ---- 1. Exact signature. ------------------------------------------------
  if v_rec.args <> 'other_user_id uuid' then
    raise exception
      'C2 postcondition failed: signature is (%) (expected other_user_id uuid)', v_rec.args;
  end if;

  if v_rec.ret <> 'void' then
    raise exception 'C2 postcondition failed: return type is % (expected void)', v_rec.ret;
  end if;

  -- ---- 2. Owner is postgres. ----------------------------------------------
  if v_rec.owner <> 'postgres' then
    raise exception
      'C2 postcondition failed: owner is % (expected postgres)', v_rec.owner;
  end if;

  -- ---- 3. SECURITY DEFINER enabled. --------------------------------------
  if v_rec.secdef is not true then
    raise exception 'C2 postcondition failed: SECURITY DEFINER is not enabled';
  end if;

  -- ---- 4. Volatility is VOLATILE. ----------------------------------------
  if v_rec.volatility <> 'v' then
    raise exception
      'C2 postcondition failed: volatility is % (expected VOLATILE=v)', v_rec.volatility;
  end if;

  -- ---- 5. search_path pinned to public. ----------------------------------
  if v_rec.cfg is null or v_rec.cfg not like '%search_path=public%' then
    raise exception
      'C2 postcondition failed: search_path not pinned to public (got %)', coalesce(v_rec.cfg,'null');
  end if;

  -- Approved guard clauses present.
  if position('users_are_paired' in v_def) = 0 then
    raise exception 'C2 postcondition failed: pairing verification missing';
  end if;
  if position('Cannot unmatch after Connect' in v_def) = 0 then
    raise exception 'C2 postcondition failed: post-Connect refusal missing';
  end if;
  if position('least(' in v_def) = 0 or position('greatest(' in v_def) = 0 then
    raise exception 'C2 postcondition failed: canonical pair ordering missing';
  end if;
  if position('unmatched' in v_def) = 0 then
    raise exception 'C2 postcondition failed: conversation status transition missing';
  end if;
  if position('discarded' in v_def) = 0 or position('discarded_at' in v_def) = 0 then
    raise exception 'C2 postcondition failed: matches status transition missing';
  end if;

  -- Privileges: anon/PUBLIC must be gone, authenticated and service_role kept.
  if has_function_privilege('anon', 'public.unmatch_conversation(uuid)', 'execute') then
    raise exception 'C2 postcondition failed: anon can still execute unmatch_conversation';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.unmatch_conversation(uuid)'::regprocedure
       and a.grantee = 0
  ) then
    raise exception 'C2 postcondition failed: PUBLIC still holds EXECUTE on unmatch_conversation';
  end if;
  if not has_function_privilege('authenticated', 'public.unmatch_conversation(uuid)', 'execute') then
    raise exception 'C2 postcondition failed: authenticated lost EXECUTE on unmatch_conversation';
  end if;
  if not has_function_privilege('service_role', 'public.unmatch_conversation(uuid)', 'execute') then
    raise exception 'C2 postcondition failed: service_role lost EXECUTE on unmatch_conversation';
  end if;

  raise notice 'C2 applied: unmatch_conversation pinned; anon/PUBLIC EXECUTE revoked';
end
$$;

commit;
