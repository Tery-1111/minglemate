-- ============================================================================
-- H-1 — public.users: constrain client UPDATE to the editable column set
-- ============================================================================
-- Problem (measured against the live staging project, 2026-11-13)
--   public.users carries a table-level UPDATE grant for both application roles,
--   so RLS alone decides which columns a client may write:
--
--     relacl = {postgres=arwdDxtm/postgres, anon=awdDxtm/postgres,
--               authenticated=awdDxtm/postgres, service_role=arwdDxtm/postgres}
--
--   has_table_privilege() confirms UPDATE on users for anon AND authenticated.
--   There is no column-level UPDATE grant and no column-level REVOKE in place,
--   so every column is writable by the row's owner, including the server-owned
--   and administrator-owned fields:
--
--     * reputation_score — must only move through the reputation triggers.
--     * status          — the administrator suspension flag. A suspended user
--                         can currently set status back to 'active' through
--                         PostgREST and un-suspend themselves.
--     * section2_unlocked / section2_free_expires_at — already clamped by
--                         clamp_user_protected_columns(), but clamping is a
--                         trigger, not a grant; they stay revoked here too so
--                         the protection does not depend on one trigger.
--     * section1_progress / section1_complete / section1_last_edited —
--                         server-owned questionnaire state, written only by the
--                         Section1 flow through the guarded RPC path.
--     * email           — flows from auth.users; a client write desynchronises
--                         the two identity records.
--     * created_at      — evidential.
--     * section2_responses — written by the Section 2 flow, not the profile.
--     * reg_number      — institutional identifier, never client-set.
--
--   Two UPDATE policies also exist: "Allow users to modify their own specific
--   profile rows" (roles = public, USING auth.uid() = id, no WITH CHECK) and
--   "Users can update own profile" (authenticated, USING only, no WITH CHECK)
--   plus users_update_own (authenticated, USING and WITH CHECK). The duplicate
--   public policy widens the caller set to unauthenticated requests.
--
-- Scope
--   1. Revoke the table-level UPDATE from anon and authenticated, then grant
--      UPDATE (column list) to authenticated only, for the columns the
--      application actually edits.
--   2. Drop the broad/public UPDATE policies; keep one authenticated own-row
--      policy with both USING and WITH CHECK.
--   3. Make profile_status validation null-safe and refuse the transition out
--      of an administrator suspension.
--   4. Make discover_candidates() refuse suspended/paused callers and exclude
--      suspended candidates.
--   5. Restrict the production-only legacy RPC public.admin_update_user_status
--      (uuid, text) to service_role; it had no authorization check and was
--      executable by PUBLIC/anon/authenticated. Conditional: skipped when the
--      routine is absent.
--   6. Leave clamp_user_protected_columns() and its trigger exactly as they are.
--
-- Why a WITH CHECK expression and not a column grant for profile_status
--   Pause/resume requires the client to write profile_status, so the column
--   must stay writable. "Cannot reactivate a suspended account" is therefore a
--   row-state rule, which is what WITH CHECK expresses: the NEW row may not
--   read 'active' when the OLD row was not 'active' because of a suspension.
--   WITH CHECK cannot see OLD, so the rule is enforced by the
--   before_users_update_guard() trigger below and the policy carries the
--   equivalent statement of intent for the uncontested transitions.
--
-- Null-safety
--   profile_status is nullable (default 'incomplete'). Every comparison uses
--   IS DISTINCT FROM / coalesce so a NULL never silently passes or blocks a
--   legitimate edit.
--
-- Explicitly NOT done
--   * No administrator authorization system is invented. The legacy RPC is
--     restricted, not repurposed; it is not made the admin suspension path.
--   * No FORCE ROW LEVEL SECURITY. The owner keeps bypassing RLS, preserving
--     service_role writes, the payment callback and definer-rights routines.
--   * No change to INSERT or DELETE privileges.
--   * No change to SELECT privileges (F-04 owns the read scope).
--   * No data migration; no row is read, written or removed.
--
-- Verification
--   Preconditions snapshot the live grant and policy shape and refuse to run
--   if it has drifted. Postconditions assert the exact resulting privilege set
--   and policy set, and fail the file if any of them is not as specified.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Preconditions — refuse to guess if the table does not look as captured.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'H-1 precondition failed: public.users does not exist';
  end if;

  -- The roles we are correcting must currently hold table-level UPDATE.
  if not has_table_privilege('authenticated', 'public.users', 'UPDATE') then
    raise exception
      'H-1 precondition failed: authenticated does not hold table UPDATE on public.users (shape drifted)';
  end if;

  -- The trigger we must not break has to be present.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.users'::regclass
       and tgname = 'trg_clamp_user_protected_cols'
       and not tgisinternal
  ) then
    raise exception
      'H-1 precondition failed: trg_clamp_user_protected_cols is missing; refusing to proceed';
  end if;

  -- Columns this migration names must exist, so the REVOKE list cannot be a
  -- typo that silently does nothing.
  if (
    select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'users'
       and column_name in (
         'id','email','full_name','age','gender','campus_id','residence_type',
         'bio','interests','profile_status','section1_progress',
         'section1_complete','section1_last_edited','section2_unlocked',
         'section2_free_expires_at','phone','onesignal_player_id','created_at',
         'reg_number','whatsapp_number','display_phone','section2_responses',
         'reputation_score','status','looking_for','profile_prompts',
         'notifications_enabled','share_phone','share_whatsapp','share_email',
         'social_instagram','social_x','social_tiktok',
         'share_social_instagram','share_social_x','share_social_tiktok'
       )
  ) <> 36 then
    raise exception
      'H-1 precondition failed: public.users does not have the 36 expected columns';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Privileges.
--
--    Revoke the whole-table UPDATE first. Revoking a table-level privilege also
--    removes any column-level grants derived from it, but the explicit column
--    REVOKE is issued as well so the statement is correct against a database
--    where a column grant was issued independently.
-- ---------------------------------------------------------------------------
revoke update on table public.users from anon, authenticated;

revoke update (
  id, email, created_at,
  reputation_score, status,
  section1_progress, section1_complete, section1_last_edited,
  section2_unlocked, section2_free_expires_at, section2_responses,
  reg_number
) on table public.users from anon, authenticated;

-- grant: authenticated may write only the application-editable columns.
--   profile fields  : full_name, age, gender, campus_id, residence_type, bio,
--                     interests, looking_for, profile_prompts
--   contacts        : phone, whatsapp_number, display_phone, social_*
--   sharing choices : share_phone, share_whatsapp, share_email, share_social_*
--   preferences     : notifications_enabled, onesignal_player_id
--   account state   : profile_status (pause/resume; see the guard trigger)
grant update (
  full_name, age, gender, campus_id, residence_type, bio, interests,
  looking_for, profile_prompts,
  phone, whatsapp_number, display_phone,
  social_instagram, social_x, social_tiktok,
  share_phone, share_whatsapp, share_email,
  share_social_instagram, share_social_x, share_social_tiktok,
  notifications_enabled, onesignal_player_id,
  profile_status
) on table public.users to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies.
--
--    Every pre-existing UPDATE policy is dropped: the two that name themselves
--    own-row, plus the one that is scoped to PUBLIC (which is how an
--    unauthenticated request could reach the row at all). Exactly one
--    authenticated own-row policy is created, with USING and WITH CHECK.
-- ---------------------------------------------------------------------------
drop policy if exists "Allow users to modify their own specific profile rows" on public.users;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_update_own_row" on public.users;

create policy "users_update_own_row"
  on public.users
  for update
  to authenticated
  using (
    auth.uid() is not null
    and auth.uid() = id
  )
  with check (
    auth.uid() is not null
    and auth.uid() = id
    -- A client may hold 'incomplete', 'active' or 'paused'. It may not invent
    -- any other value, and it may not move a suspended account back to active
    -- (the suspension may be recorded in profile_status or in status; the
    -- trigger below sees OLD and enforces both).
    and coalesce(profile_status, 'incomplete') in ('incomplete', 'active', 'paused')
  );

-- ---------------------------------------------------------------------------
-- 3. Row-state guard.
--
--    WITH CHECK cannot reference the OLD row, so the suspension rule needs a
--    BEFORE UPDATE trigger. It is separate from clamp_user_protected_columns()
--    so that existing function is left byte-for-byte unchanged.
--
--    Rules (each null-safe via IS DISTINCT FROM / coalesce):
--      a. profile_status may only hold 'incomplete' | 'active' | 'paused'.
--      b. If the stored account is suspended — either status is 'suspended' or
--         profile_status is 'suspended' — the client may not move
--         profile_status to 'active'.
--      c. status is server-owned; a client write that changes it is rejected.
--         (The column is also revoked in section 1; this is the second line.)
--      d. reputation_score is server-owned; a changing client write is rejected.
--
--    Client detection is by REQUEST JWT ROLE, not by current_user.
--
--    current_user is the wrong trust signal. A SECURITY DEFINER function owned
--    by postgres sets current_user = 'postgres' for the duration of the call,
--    so an authenticated caller that finds any definer-rights function updating
--    public.users would be treated as a trusted server writer and could flip
--    status / reputation_score / profile_status. That is a privilege-escalation
--    path, not a theoretical one: the trust boundary is the JWT, which the
--    caller cannot rewrite, and current_user, which a definer function rewrites
--    for them.
--
--    PostgREST publishes the verified role in request.jwt.claim.role (single
--    claim) and in request.jwt.claims (whole claims JSON). Both are read, with
--    current_user only as a last-resort fallback for non-PostgREST callers such
--    as a direct psql session or a migration.
--
--    The bypass is granted only when:
--      * auth.uid() is null  — no end-user identity on the request, i.e. the
--        caller is the database itself (migrations, triggers, cron), or
--      * v_jwt_role = 'service_role' — the verified server-side role.
--    An authenticated request therefore stays subject to every rule below even
--    when a SECURITY DEFINER function has raised current_user to postgres.
-- ---------------------------------------------------------------------------
create or replace function public.guard_users_client_update()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_next_profile_status text := coalesce(new.profile_status, 'incomplete');
  v_jwt_role             text;
  v_jwt_uid              uuid;
begin
  -- Trust boundary: the request JWT, never current_user alone.
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  );

  begin
    v_jwt_uid := auth.uid();
  exception when others then
    v_jwt_uid := null;  -- auth schema absent (bare database, migration runner)
  end;

  if v_jwt_uid is null or v_jwt_role = 'service_role' then
    return new;  -- server-side writer (payment callback, admin RPC, definer triggers)
  end if;

  -- a. Allowed profile_status vocabulary.
  if v_next_profile_status not in ('incomplete', 'active', 'paused') then
    raise exception
      'profile_status must be one of incomplete, active, paused (got %)',
      v_next_profile_status
      using errcode = 'check_violation';
  end if;

  -- b. No self-reactivation out of an administrator suspension.
  --    Suspension may be recorded on either axis: status = 'suspended' (set by
  --    the admin RPC) or profile_status = 'suspended' (legacy/defence in depth).
  --    EITHER one blocks a client TRANSITION of profile_status to 'active'.
  --
  --    The guard keys on a change of profile_status, not on its value. A
  --    suspended row often already reads profile_status='active' (the admin
  --    suspension lives in status), so testing the value alone would refuse an
  --    unrelated bio edit. Only an attempt to write 'active' over a different
  --    stored value is a reactivation attempt.
  if v_next_profile_status = 'active'
     and coalesce(old.profile_status, 'incomplete') is distinct from 'active'
     and (
          coalesce(old.status, 'active') is distinct from 'active'
       or coalesce(old.profile_status, 'incomplete') = 'suspended'
     )
  then
    raise exception
      'this account is suspended and cannot be reactivated from the client'
      using errcode = 'insufficient_privilege';
  end if;

  -- c. status is server-owned.
  if coalesce(new.status, 'active') is distinct from coalesce(old.status, 'active') then
    raise exception
      'status is server-owned and cannot be changed from the client'
      using errcode = 'insufficient_privilege';
  end if;

  -- d. reputation_score is server-owned.
  if coalesce(new.reputation_score, 0) is distinct from coalesce(old.reputation_score, 0) then
    raise exception
      'reputation_score is server-owned and cannot be changed from the client'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_users_client_update on public.users;

create trigger trg_guard_users_client_update
  before update on public.users
  for each row
  execute function public.guard_users_client_update();

-- ---------------------------------------------------------------------------
-- 4. discover_candidates(): suspension-aware, eligibility preserved.
--
--    Added, relative to the live definition:
--      * the caller must not be suspended, and must not be paused;
--      * candidates whose account is suspended are excluded.
--
--    Preserved verbatim from the live body:
--      * id <> auth.uid(), gender differ, campus equality with the explicit
--        null/null allowance, block exclusion in both directions, existing
--        match exclusion, existing match_history exclusion, ordering and the
--        limit 5.
--
--    The caller gate uses a single lookup against public.users, the same table
--    and the same auth.uid() the function already depends on.
-- ---------------------------------------------------------------------------
create or replace function public.discover_candidates()
returns table(id uuid, full_name text, age integer)
language sql
security definer
set search_path to 'public'
as $function$
  select u.id, u.full_name, u.age
  from public.users u
  cross join (select * from public.users me where me.id = auth.uid()) caller
  where caller.id is not null
    -- Caller gate: a suspended or paused account may not browse candidates.
    and coalesce(caller.status, 'active') = 'active'
    and coalesce(caller.profile_status, 'incomplete') <> 'suspended'
    and coalesce(caller.profile_status, 'incomplete') <> 'paused'

    and u.id <> caller.id
    and u.profile_status = 'active'
    -- Candidate gate: a suspended account is never surfaced.
    and coalesce(u.status, 'active') = 'active'
    and u.section1_complete = true
    and u.gender <> caller.gender
    -- GENERAL STUDENT PLATFORM: campus-verified users stay campus-scoped;
    -- unaffiliated users (campus_id is null — gmail/other institutions)
    -- discover across all campuses. null = null is never true, so an
    -- explicit or-arm is required for them to see anyone.
    and (
      u.campus_id = caller.campus_id
      or (u.campus_id is null and caller.campus_id is null)
    )
    and not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = caller.id and ub.blocked_id = u.id)
         or (ub.blocker_id = u.id and ub.blocked_id = caller.id)
    )
    and not exists (
      select 1 from public.matches m
      where (m.user_a_id = caller.id and m.user_b_id = u.id)
         or (m.user_b_id = caller.id and m.user_a_id = u.id)
    )
    and not exists (
      select 1 from public.match_history mh
      where (mh.user_id = caller.id and (mh.tier1_match_id = u.id or mh.tier2_match_id = u.id))
         or (mh.user_id = u.id and (mh.tier1_match_id = caller.id or mh.tier2_match_id = caller.id))
    )
  order by u.created_at
  limit 5;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Legacy admin RPC lockdown.
--
--    Production carries public.admin_update_user_status(uuid, text) with:
--      * no administrator authorization check inside the body;
--      * it writes profile_status (not the status suspension axis);
--      * EXECUTE granted to PUBLIC, anon and authenticated;
--      * no application caller anywhere in the inspected repository.
--
--    An unauthenticated or ordinary authenticated caller can therefore invoke
--    it and rewrite any user's profile_status. Until an administrator
--    authorization system exists (which this migration deliberately does not
--    invent), the correct posture is to make the routine unreachable from the
--    client roles and leave it callable only by service_role.
--
--    The block is conditional: the function is production-only and is absent
--    from this repository, so a fresh or test database must not fail here.
--
--    This does NOT make the legacy RPC the administrator suspension path. It
--    stays unused by the application; it is only de-fanged.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.admin_update_user_status(uuid, text)') is null then
    raise notice
      'H-1: public.admin_update_user_status(uuid,text) is absent; nothing to revoke';
  else
    revoke all on function public.admin_update_user_status(uuid, text) from public;
    -- Revoke from the two application roles explicitly as well: PUBLIC may
    -- have been the grant path, and a direct grant would survive the PUBLIC
    -- revoke otherwise.
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.admin_update_user_status(uuid, text) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.admin_update_user_status(uuid, text) from authenticated';
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant execute on function public.admin_update_user_status(uuid, text) to service_role;
    end if;

    raise notice
      'H-1: public.admin_update_user_status(uuid,text) restricted to service_role';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Postconditions — fail the file if the result is not as specified.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy_count int;
  v_col_ok       int;
begin
  -- ---- 1. anon holds no UPDATE, at table or column level. ----------------
  if has_table_privilege('anon', 'public.users', 'UPDATE') then
    raise exception 'H-1 postcondition failed: anon still holds table UPDATE on public.users';
  end if;

  if exists (
    select 1 from information_schema.column_privileges
     where table_schema = 'public' and table_name = 'users'
       and grantee = 'anon' and privilege_type = 'UPDATE'
  ) then
    raise exception 'H-1 postcondition failed: anon still holds a column UPDATE grant on public.users';
  end if;

  -- ---- 2. authenticated holds no table-level UPDATE. --------------------
  if has_table_privilege('authenticated', 'public.users', 'UPDATE') then
    raise exception 'H-1 postcondition failed: authenticated still holds table UPDATE on public.users';
  end if;

  -- ---- 3. Each server-owned column is unreachable for UPDATE. -----------
  if has_column_privilege('authenticated', 'public.users', 'reputation_score', 'UPDATE') then
    raise exception 'H-1 postcondition failed: reputation_score remains client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'status', 'UPDATE') then
    raise exception 'H-1 postcondition failed: status remains client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'section2_unlocked', 'UPDATE') then
    raise exception 'H-1 postcondition failed: section2_unlocked remains client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'section2_free_expires_at', 'UPDATE') then
    raise exception 'H-1 postcondition failed: section2_free_expires_at remains client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.users', 'email', 'UPDATE') then
    raise exception 'H-1 postcondition failed: email remains client-writable';
  end if;

  -- ---- 4. Each legitimate column is still writable. ---------------------
  select count(*) into v_col_ok
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'users'
     and grantee = 'authenticated' and privilege_type = 'UPDATE'
     and column_name in (
       'full_name','age','gender','campus_id','residence_type','bio','interests',
       'looking_for','profile_prompts','phone','whatsapp_number','display_phone',
       'social_instagram','social_x','social_tiktok','share_phone','share_whatsapp',
       'share_email','share_social_instagram','share_social_x','share_social_tiktok',
       'notifications_enabled','onesignal_player_id','profile_status'
     );

  if v_col_ok <> 24 then
    raise exception
      'H-1 postcondition failed: expected 24 client-editable columns, found %', v_col_ok;
  end if;

  -- ---- 5. Exactly one UPDATE policy, authenticated, with WITH CHECK. ----
  select count(*) into v_policy_count
    from pg_policies
   where schemaname = 'public' and tablename = 'users' and cmd = 'UPDATE';

  if v_policy_count <> 1 then
    raise exception
      'H-1 postcondition failed: expected exactly 1 UPDATE policy on users, found %', v_policy_count;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'users' and cmd = 'UPDATE'
       and policyname = 'users_update_own_row'
       and 'authenticated' = any(roles)
       and qual is not null
       and with_check is not null
  ) then
    raise exception
      'H-1 postcondition failed: users_update_own_row is missing, not authenticated, or lacks USING/WITH CHECK';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'users' and cmd = 'UPDATE'
       and 'public' = any(roles)
  ) then
    raise exception 'H-1 postcondition failed: a PUBLIC-scoped UPDATE policy still exists on users';
  end if;

  -- ---- 7. The legacy admin RPC, when present, is service_role only. ---
  if to_regprocedure('public.admin_update_user_status(uuid, text)') is not null then
    if has_function_privilege('authenticated',
         'public.admin_update_user_status(uuid, text)', 'EXECUTE') then
      raise exception
        'H-1 postcondition failed: authenticated can still execute admin_update_user_status';
    end if;

    if exists (select 1 from pg_roles where rolname = 'anon')
       and has_function_privilege('anon',
             'public.admin_update_user_status(uuid, text)', 'EXECUTE') then
      raise exception
        'H-1 postcondition failed: anon can still execute admin_update_user_status';
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role')
       and not has_function_privilege('service_role',
             'public.admin_update_user_status(uuid, text)', 'EXECUTE') then
      raise exception
        'H-1 postcondition failed: service_role lost EXECUTE on admin_update_user_status';
    end if;
  end if;

  -- ---- 8. The pre-existing clamp trigger is untouched. ------------------
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.users'::regclass
       and tgname = 'trg_clamp_user_protected_cols'
       and not tgisinternal
  ) then
    raise exception 'H-1 postcondition failed: trg_clamp_user_protected_cols disappeared';
  end if;
end
$$;

commit;
