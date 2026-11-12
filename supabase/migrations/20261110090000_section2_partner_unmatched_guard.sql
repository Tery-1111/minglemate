-- ============================================================================
-- C4 — Section 2 authorization: is_section2_partner unmatched-conversation guard
-- ============================================================================
-- Problem
--   The repository replay of is_section2_partner omits an unmatched-conversation
--   guard that exists in the production definition. Without it, a pair whose
--   conversation has been explicitly unmatched could still read each other's
--   Section 2 answers, because the match_history branch of the predicate remains
--   true after an unmatch. The guard makes unmatch final for Section 2 access.
--
-- Scope
--   Replaces exactly one function. No table, column, policy, grant or trigger is
--   touched. No application data is read, written or deleted.
--
-- Safety
--   * Preconditions below stop the transaction if any dependent object is absent
--     or has an unexpected shape, instead of overwriting something unknown.
--   * SECURITY DEFINER, STABLE and the fixed search_path are preserved verbatim
--     from the verified production definition.
--   * Existing EXECUTE grants (authenticated, service_role) are not modified.
--
-- Note on idempotency
--   CREATE OR REPLACE FUNCTION is inherently idempotent: re-running this file on
--   an already-correct database replaces the body with an identical body. The
--   postconditions therefore assert the semantics (presence of every predicate
--   clause), not a byte comparison against a recorded body.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preconditions: every object the function body references must exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.is_section2_partner(uuid,uuid)') is null then
    raise exception
      'C4 precondition failed: function public.is_section2_partner(uuid,uuid) does not exist';
  end if;

  if to_regclass('public.user_blocks') is null then
    raise exception 'C4 precondition failed: table public.user_blocks does not exist';
  end if;

  if to_regclass('public.conversations') is null then
    raise exception 'C4 precondition failed: table public.conversations does not exist';
  end if;

  if to_regclass('public.match_history') is null then
    raise exception 'C4 precondition failed: table public.match_history does not exist';
  end if;

  if to_regclass('public.matches') is null then
    raise exception 'C4 precondition failed: table public.matches does not exist';
  end if;

  -- Guard against silently overwriting a differently-shaped unrelated overload.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'is_section2_partner'
       and p.pronargs = 2
       and p.prorettype = 'boolean'::regtype
  ) then
    raise exception
      'C4 precondition failed: is_section2_partner is not a 2-argument function returning boolean';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The correction.
-- ---------------------------------------------------------------------------
create or replace function public.is_section2_partner(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b
    and not exists (select 1 from public.user_blocks ub where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a))
    and not exists (select 1 from public.conversations c where c.status = 'unmatched' and ((c.user_a_id = a and c.user_b_id = b) or (c.user_a_id = b and c.user_b_id = a)))
    and (
      exists (select 1 from public.match_history mh where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b)) or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
      or exists (select 1 from public.matches m where m.status in ('active','matched') and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
    ); $function$;

-- ---------------------------------------------------------------------------
-- Postconditions: verify the semantics actually landed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def        text;
  v_rec        record;
  -- Digest of the approved production definition body, computed as
  --   md5(regexp_replace(split_part(pg_get_functiondef(oid),'$function$',2),'\s+',' ','g'))
  -- against the verified live production function. Any change to the SQL body --
  -- an added or removed predicate, a flipped comparison, changed table or column
  -- names -- alters this digest and aborts the migration.
  v_approved_body_md5 text := 'ccd675d898adf1457ee868e0bb73872d';
  v_body_md5   text;
begin
  select p.proname,
         pg_get_function_identity_arguments(p.oid)  as args,
         p.prorettype::regtype::text                     as ret,
         p.prosecdef                               as secdef,
         p.provolatile                             as volatility,
         p.proconfig::text                         as cfg,
         r.rolname                                 as owner,
         pg_get_functiondef(p.oid)                 as def
    into v_rec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r     on r.oid = p.proowner
   where n.nspname = 'public' and p.proname = 'is_section2_partner';

  if not found then
    raise exception 'C4 postcondition failed: is_section2_partner does not exist after apply';
  end if;

  v_def := v_rec.def;

  -- ---- 1. Exact signature and return type. --------------------------------
  if v_rec.args <> 'a uuid, b uuid' then
    raise exception
      'C4 postcondition failed: signature is (%) (expected a uuid, b uuid)', v_rec.args;
  end if;

  if v_rec.ret <> 'boolean' then
    raise exception
      'C4 postcondition failed: return type is % (expected boolean)', v_rec.ret;
  end if;

  -- ---- 2. Owner is postgres. ----------------------------------------------
  if v_rec.owner <> 'postgres' then
    raise exception
      'C4 postcondition failed: owner is % (expected postgres)', v_rec.owner;
  end if;

  -- ---- 3. SECURITY DEFINER. ----------------------------------------------
  if v_rec.secdef is not true then
    raise exception 'C4 postcondition failed: SECURITY DEFINER is not enabled';
  end if;

  -- ---- 4. Volatility is STABLE. ------------------------------------------
  if v_rec.volatility <> 's' then
    raise exception
      'C4 postcondition failed: volatility is % (expected STABLE=s)', v_rec.volatility;
  end if;

  -- ---- 5. search_path pinned to public. ----------------------------------
  if v_rec.cfg is null or v_rec.cfg not like '%search_path=public%' then
    raise exception
      'C4 postcondition failed: search_path not pinned to public (got %)', coalesce(v_rec.cfg,'null');
  end if;

  -- ---- 6. Actual body matches the approved production definition. ---------
  v_body_md5 := md5(regexp_replace(split_part(v_def, '$function$', 2), '\s+', ' ', 'g'));

  if v_body_md5 <> v_approved_body_md5 then
    raise exception
      'C4 postcondition failed: body digest % does not match approved production digest %',
      v_body_md5, v_approved_body_md5;
  end if;

  -- ---- 7. authenticated / service_role keep EXECUTE; anon/PUBLIC do not. --
  if not has_function_privilege('authenticated', 'public.is_section2_partner(uuid,uuid)', 'execute') then
    raise exception 'C4 postcondition failed: authenticated lost EXECUTE on is_section2_partner';
  end if;

  if not has_function_privilege('service_role', 'public.is_section2_partner(uuid,uuid)', 'execute') then
    raise exception 'C4 postcondition failed: service_role lost EXECUTE on is_section2_partner';
  end if;

  if has_function_privilege('anon', 'public.is_section2_partner(uuid,uuid)', 'execute') then
    raise exception 'C4 postcondition failed: anon gained EXECUTE on is_section2_partner';
  end if;

  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.is_section2_partner(uuid,uuid)'::regprocedure
       and a.grantee = 0
  ) then
    raise exception 'C4 postcondition failed: PUBLIC holds a direct EXECUTE grant on is_section2_partner';
  end if;

  -- Null + self check.
  if position('a is not null' in v_def) = 0 or position('a <> b' in v_def) = 0 then
    raise exception 'C4 postcondition failed: null/self checks missing';
  end if;

  -- Bidirectional block check.
  if position('user_blocks' in v_def) = 0 then
    raise exception 'C4 postcondition failed: block check missing';
  end if;

  -- THE unreversed-correction assertion: unmatched guard must be present.
  if position('unmatched' in v_def) = 0 then
    raise exception 'C4 postcondition failed: unmatched-conversation guard missing';
  end if;

  -- Tier 1 / Tier 2 match-history checks.
  if position('tier1_match_id' in v_def) = 0 or position('tier2_match_id' in v_def) = 0 then
    raise exception 'C4 postcondition failed: tier1/tier2 match-history checks missing';
  end if;

  -- Active/matched Qrashe checks.
  if position('active' in v_def) = 0 or position('matched' in v_def) = 0 then
    raise exception 'C4 postcondition failed: active/matched status checks missing';
  end if;

  raise notice 'C4 applied: is_section2_partner body matches approved production digest %', v_approved_body_md5;
end
$$;

commit;
