-- ============================================================================
-- D-1 — public.users: revoke DELETE, TRUNCATE, REFERENCES, TRIGGER
-- ============================================================================
-- Status
--   APPLIED TO PRODUCTION on 2026-11-15, manually, in the Supabase SQL editor.
--   This file records that statement verbatim and is the idempotent form of
--   the same change for any environment that has not received it. The file was
--   not the vehicle used to run the production change, and this repository
--   change does not run it anywhere.
--
-- SQL applied manually (verbatim)
--   REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
--   ON TABLE public.users
--   FROM anon, authenticated;
--
-- Post-execution verification on production (recorded as reported)
--   anon:          INSERT true   DELETE false   TRUNCATE false
--                  REFERENCES false            TRIGGER false
--   authenticated: INSERT true   DELETE false   TRUNCATE false
--                  REFERENCES false            TRIGGER false
--
-- Scope
--   Only the four destructive/DDL privileges above are removed. SELECT,
--   INSERT and UPDATE are deliberately untouched, because the application
--   needs them:
--     * signup / profile setup / profile edits write public.users;
--     * Home, Payment, Profile, Interests, Section 1 and Section 2 read it.
--   No policy, RLS flag, row or column is changed.
--
-- Why the application does not depend on the revoked privileges
--   * Signup: Signup.jsx calls supabase.auth.signUp() only. The public.users
--     row is created by on_auth_user_created -> public.handle_new_user(),
--     a SECURITY DEFINER function, so it inserts as the function owner.
--   * Profile editing: Profile.jsx, ProfileSetup.jsx, Settings.jsx,
--     Interests.jsx, Section1.jsx and Section2.jsx use UPDATE (and SELECT).
--     No client path deletes a public.users row.
--   * Account deletion: Settings.jsx calls public.request_account_deletion(),
--     a SECURITY DEFINER RPC. The DELETE inside it runs as the function owner,
--     not as the signed-in client.
--   * REFERENCES and TRIGGER are DDL-only privileges: creating a foreign key
--     or a trigger. No browser or Edge Function path issues DDL, and the
--     application's own FK/trigger maintenance runs as the table owner.
--
-- Explicitly NOT done
--   * No rollback file is provided. Restoring DELETE on public.users is the
--     defect this record closes; a future need must be met by a reviewed
--     grant of the specific privilege with a written reason, not by undoing
--     this hardening.
--   * No DML, no TRUNCATE, no table/column/RLS/policy alteration.
--
-- Verification
--   The postconditions below are part of the file, so an apply either ends
--   with the intended ACL or rolls back. The executable regression test is
--   scripts/verify-users-delete-family-revoked.mjs.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preconditions: the object and both roles must exist. The privileges being
-- revoked are allowed to be absent already, because this file is re-runnable
-- and because the repository's consolidated chain converges grants first.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'D-1 precondition failed: table public.users does not exist';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'D-1 precondition failed: role anon does not exist';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'D-1 precondition failed: role authenticated does not exist';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The change. Exactly the production statement, formatted across three lines
-- for readability; the text matches the statement recorded at the top of the
-- file.
-- ---------------------------------------------------------------------------
revoke delete, truncate, references, trigger
  on table public.users
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_missing text;
  v_definer boolean;
begin
  -- ---- 1. None of the four revoked privileges survives on either role. -----
  select string_agg(r.role_name || ':' || p.priv, ', ' order by r.role_name, p.priv)
    into v_bad
    from (values ('anon'), ('authenticated')) as r(role_name)
   cross join (values ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p(priv)
   where has_table_privilege(r.role_name, 'public.users', p.priv);

  if v_bad is not null then
    raise exception 'D-1 postcondition failed: privileges still held on public.users: %', v_bad;
  end if;

  -- ---- 2. The privileges the application does need are still present. -----
  --      has_column_privilege() sees both a column-level grant and a wider
  --      table-level grant, so this holds in production (table grants) and in
  --      a chain-converged database (column grants).
  select string_agg(x.requirement, ', ')
    into v_missing
    from (values
      ('authenticated INSERT (users.id)',      has_column_privilege('authenticated', 'public.users', 'id',  'INSERT')),
      ('authenticated SELECT (users.id)',      has_column_privilege('authenticated', 'public.users', 'id',  'SELECT')),
      ('authenticated UPDATE (users.bio)',     has_column_privilege('authenticated', 'public.users', 'bio', 'UPDATE')),
      ('anon SELECT (users.id)',               has_column_privilege('anon',          'public.users', 'id',  'SELECT'))
    ) as x(requirement, satisfied)
   where not x.satisfied;

  if v_missing is not null then
    raise exception 'D-1 postcondition failed: required client privilege missing: %', v_missing;
  end if;

  -- ---- 3. The two server-owned paths that replace direct DELETE/INSERT
  --         remain SECURITY DEFINER. Their absence is reported, not failed:
  --         the consolidated chain treats handle_new_user() as a live
  --         precondition, so a brand-new database can legitimately not have
  --         it until the base objects are applied.
  if to_regprocedure('public.request_account_deletion()') is not null then
    select prosecdef into v_definer
      from pg_proc where oid = 'public.request_account_deletion()'::regprocedure;
    if not coalesce(v_definer, false) then
      raise exception 'D-1 postcondition failed: request_account_deletion() is not SECURITY DEFINER';
    end if;
  else
    raise notice 'D-1: request_account_deletion() is absent; definer verification deferred';
  end if;

  if to_regprocedure('public.handle_new_user()') is not null then
    select prosecdef into v_definer
      from pg_proc where oid = 'public.handle_new_user()'::regprocedure;
    if not coalesce(v_definer, false) then
      raise exception 'D-1 postcondition failed: handle_new_user() is not SECURITY DEFINER';
    end if;
  else
    raise notice 'D-1: handle_new_user() is absent; definer verification deferred';
  end if;

  raise notice 'D-1 applied: DELETE, TRUNCATE, REFERENCES, TRIGGER revoked on public.users from anon, authenticated';
end
$$;

commit;
