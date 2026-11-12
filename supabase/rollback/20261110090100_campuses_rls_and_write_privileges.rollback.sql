-- ============================================================================
-- ROLLBACK for C1 — 20261110090100_campuses_rls_and_write_privileges.sql
-- ============================================================================
-- WARNING: SECURITY-WEAKENING ROLLBACK, AND ENVIRONMENT-AMBIGUOUS.
--   This restores the pre-C1 privilege state, which means anon and authenticated
--   can again INSERT/UPDATE/DELETE/TRUNCATE campuses. Disabling RLS additionally
--   re-opens the staging defect outright.
--
--   The pre-C1 state DIFFERS by environment:
--     * Production: RLS was already ENABLED (writes were still over-granted).
--     * Staging:    RLS was DISABLED (writes over-granted).
--   A rollback that blindly disables RLS would make production WORSE than it was.
--   Therefore RLS rollback is commented out and must be chosen deliberately per
--   environment. The grant restoration is the part that faithfully returns both
--   environments to their previous privilege state.
--
-- This file is NOT a migration. It lives outside supabase/migrations/.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.campuses') is null then
    raise exception 'C1 rollback precondition failed: table public.campuses does not exist';
  end if;
end
$$;

-- Restore the pre-C1 grants (both environments held the full write set).
grant insert, update, delete, truncate, references, trigger
  on table public.campuses to anon, authenticated;

-- RLS rollback: UNCOMMENT ONLY FOR STAGING. Production had RLS ON before C1 and
-- must not have it disabled by a rollback.
-- alter table public.campuses disable row level security;

do $$
begin
  if has_table_privilege('anon','public.campuses','INSERT')
     and has_table_privilege('authenticated','public.campuses','INSERT') then
    raise notice 'C1 rolled back: write grants restored to anon + authenticated (SECURITY WEAKENED)';
  else
    raise exception 'C1 rollback failed: write grants were not restored';
  end if;

  if not has_table_privilege('anon','public.campuses','SELECT') then
    raise exception 'C1 rollback failed: anon lost SELECT on campuses';
  end if;
end
$$;

commit;
