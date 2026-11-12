-- ============================================================================
-- C1 — campuses: enable RLS and remove unnecessary write privileges
-- ============================================================================
-- Problem
--   public.campuses is a public reference table (campus names/labels) that the
--   application only ever reads. Two defects exist, differing per environment:
--
--     * Staging has RLS DISABLED on campuses (verified: relrowsecurity = false).
--     * Both environments are configured such that anon and authenticated hold
--       the full write set (INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER,
--       REFERENCES) in addition to SELECT.
--
--   With RLS off and write grants in place, any client holding the anon key can
--   rewrite or truncate the campus list through the REST API.
--
-- Scope
--   Enables RLS, preserves the existing public SELECT policy, and revokes the
--   write privileges from anon and authenticated. SELECT is deliberately kept on
--   both roles because the app reads campuses as part of discovery/profile flows.
--   service_role privileges are untouched.
--
-- Explicitly NOT done
--   * No FORCE ROW LEVEL SECURITY. The table owner (postgres) keeps bypassing RLS,
--     which preserves existing server-side/administrative behaviour and avoids
--     breaking any definer-rights routine that touches campuses.
--   * No new policy is invented; the existing read policy is preserved as-is.
--
-- Verification
--   The existing read policy is snapshotted BEFORE any alteration statement, and
--   the snapshot records its name, command, role set, PERMISSIVE/RESTRICTIVE
--   property and USING expression. Postconditions assert all five are unchanged,
--   that the policy is still PERMISSIVE, and that the six write privileges remain
--   revoked from anon and authenticated while SELECT survives on both.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy_count int;
  v_select_policy int;
  v_permissive text;
begin
  if to_regclass('public.campuses') is null then
    raise exception 'C1 precondition failed: table public.campuses does not exist';
  end if;

  -- Expected live state: exactly one policy, a permissive public SELECT.
  select count(*) into v_policy_count
    from pg_policies where schemaname = 'public' and tablename = 'campuses';

  if v_policy_count <> 1 then
    raise exception
      'C1 precondition failed: expected exactly 1 policy on campuses, found % (refusing to guess)', v_policy_count;
  end if;

  select count(*) into v_select_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'campuses'
     and cmd = 'SELECT' and 'public' = any(roles) and qual = 'true';

  if v_select_policy <> 1 then
    raise exception
      'C1 precondition failed: the expected public SELECT policy (roles=public, USING true) is not present';
  end if;

  -- The approved read policy must be PERMISSIVE. A RESTRICTIVE read policy would
  -- be ANDed with any other policy rather than ORed, so the premise that a single
  -- permissive SELECT grants the application its reads would not hold.
  select permissive into v_permissive
    from pg_policies
   where schemaname = 'public' and tablename = 'campuses';

  if v_permissive is distinct from 'PERMISSIVE' then
    raise exception
      'C1 precondition failed: the campuses SELECT policy is % (expected PERMISSIVE)',
      coalesce(v_permissive, 'null');
  end if;

  -- Both roles must currently hold SELECT; we are preserving, not introducing it.
  if not has_table_privilege('anon', 'public.campuses', 'SELECT') then
    raise exception 'C1 precondition failed: anon does not currently hold SELECT on campuses';
  end if;
  if not has_table_privilege('authenticated', 'public.campuses', 'SELECT') then
    raise exception 'C1 precondition failed: authenticated does not currently hold SELECT on campuses';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Capture the approved read policy BEFORE the change so postconditions can
-- prove it is preserved by identity, command, role, USING expression and the
-- PERMISSIVE/RESTRICTIVE property. The snapshot must be taken before any
-- alteration statement so it records genuine pre-change state.
-- ---------------------------------------------------------------------------
create temp table c1_policy_snapshot on commit drop as
select policyname                                          as policyname,
       cmd                                                 as cmd,
       array_to_string(roles, ',')                         as roles,
       permissive                                          as permissive,
       coalesce(qual, '-')                                 as using_expr
  from pg_policies
 where schemaname = 'public' and tablename = 'campuses';

-- ---------------------------------------------------------------------------
-- The correction.
-- ---------------------------------------------------------------------------
alter table public.campuses enable row level security;

revoke insert, update, delete, truncate, references, trigger
  on table public.campuses from anon, authenticated;

-- Keep read access explicit for both roles.
grant select on table public.campuses to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_write_grant     text;
  v_policy_count    int;
  v_snap            record;
  v_live            record;
begin
  -- ---- 1. RLS is enabled. -------------------------------------------------
  if not exists (select 1 from pg_class where oid = 'public.campuses'::regclass and relrowsecurity) then
    raise exception 'C1 postcondition failed: RLS is not enabled on campuses';
  end if;

  -- ---- 2. FORCE RLS is disabled. -----------------------------------------
  if exists (select 1 from pg_class where oid = 'public.campuses'::regclass and relforcerowsecurity) then
    raise exception 'C1 postcondition failed: FORCE ROW LEVEL SECURITY was set but must not be';
  end if;

  -- ---- 3. Exactly one policy remains. ------------------------------------
  select count(*) into v_policy_count
    from pg_policies where schemaname = 'public' and tablename = 'campuses';

  if v_policy_count <> 1 then
    raise exception
      'C1 postcondition failed: expected exactly 1 policy on campuses, found %', v_policy_count;
  end if;

  -- ---- 4. Identity, command, role, USING expression and permissiveness
  --         are all unchanged. --------------------------------------------
  select policyname, cmd, array_to_string(roles, ',') as roles, permissive,
         coalesce(qual, '-') as using_expr
    into v_live
    from pg_policies where schemaname = 'public' and tablename = 'campuses';

  select * into v_snap from c1_policy_snapshot limit 1;

  if v_snap.policyname is null then
    raise exception 'C1 postcondition failed: no pre-change policy snapshot was captured';
  end if;

  if v_live.policyname <> v_snap.policyname then
    raise exception
      'C1 postcondition failed: policy name changed from "%" to "%"',
      v_snap.policyname, v_live.policyname;
  end if;

  if v_live.cmd <> v_snap.cmd then
    raise exception
      'C1 postcondition failed: policy command changed from % to %', v_snap.cmd, v_live.cmd;
  end if;

  if v_live.roles <> v_snap.roles then
    raise exception
      'C1 postcondition failed: policy roles changed from [%] to [%]', v_snap.roles, v_live.roles;
  end if;

  -- Permissiveness must be identical to the captured pre-change value.
  if v_live.permissive is distinct from v_snap.permissive then
    raise exception
      'C1 postcondition failed: policy permissiveness changed from % to %',
      coalesce(v_snap.permissive, 'null'), coalesce(v_live.permissive, 'null');
  end if;

  if v_live.using_expr <> v_snap.using_expr then
    raise exception
      'C1 postcondition failed: policy USING expression changed from "%" to "%"',
      v_snap.using_expr, v_live.using_expr;
  end if;

  -- It must still be the approved shape: a permissive public SELECT with USING true.
  if v_live.cmd <> 'SELECT' then
    raise exception 'C1 postcondition failed: surviving policy is % (expected SELECT)', v_live.cmd;
  end if;
  if v_live.permissive <> 'PERMISSIVE' then
    raise exception
      'C1 postcondition failed: surviving policy is % (expected PERMISSIVE)', v_live.permissive;
  end if;
  if v_live.roles <> 'public' then
    raise exception 'C1 postcondition failed: surviving policy targets roles [%] (expected public)', v_live.roles;
  end if;
  if v_live.using_expr <> 'true' then
    raise exception 'C1 postcondition failed: surviving policy USING is "%" (expected true)', v_live.using_expr;
  end if;

  -- ---- 5. anon and authenticated retain SELECT. --------------------------
  if not has_table_privilege('anon', 'public.campuses', 'SELECT') then
    raise exception 'C1 postcondition failed: anon lost SELECT on campuses';
  end if;
  if not has_table_privilege('authenticated', 'public.campuses', 'SELECT') then
    raise exception 'C1 postcondition failed: authenticated lost SELECT on campuses';
  end if;

  -- ---- 6. Neither role retains any of the six write privileges. ----------
  select string_agg(role_name || ':' || priv, ', ') into v_write_grant
    from (
      select r.role_name, p.priv
        from (values ('anon'), ('authenticated')) as r(role_name)
       cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
       where has_table_privilege(r.role_name, 'public.campuses', p.priv)
    ) s;

  if v_write_grant is not null then
    raise exception 'C1 postcondition failed: write privileges still held on campuses: %', v_write_grant;
  end if;

  raise notice 'C1 applied: campuses RLS on, FORCE off, policy "%" preserved, write grants revoked', v_live.policyname;
end
$$;

commit;
