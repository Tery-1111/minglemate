-- ============================================================
-- RETIRE generate_tuesday_matches() — the TRUNCATE-based legacy
-- weekly engine.
--
-- WHY (confirmed 2026-10-19):
--   * The production cron job `calculate-weekly-matches`
--     (Tuesday 17:30 UTC) calls SELECT public.generate_tuesday_matches().
--   * Its body TRUNCATEs public.matches before regenerating the week.
--     public.matches is referenced by public.payments
--     (payments.match_id -> matches.id), so on the live database the
--     truncate aborts with 0A000 and the job fails every run — but on
--     a database without that FK it would silently wipe every paid
--     Qrashe pair, because the canonical rule is that a matches row
--     is created ONLY by complete_force_connect(), after a verified
--     Force Connect payment.
--   * The consolidated chain's matches-shape stage revokes EXECUTE
--     from public/anon/authenticated, but pg_cron runs as the job
--     owner, so that revoke does not stop the scheduled call.
--   * The canonical matches table has no week identifier (columns:
--     id, user_a_id, user_b_id, tier, created_by, status,
--     compatibility_score, created_at, plus retained legacy columns),
--     so no destructive or upsert regeneration can be scoped to
--     "this week's candidates" without inventing a lifecycle column —
--     and any row could equally be a paid pair. Guessing that scope
--     is unsafe, so regeneration is not reimplemented here.
--
-- WHAT THIS DOES:
--   Replaces the body with a retirement stub: no DML of any kind, and
--   a clear exception so the legacy cron fails VISIBLE and
--   self-explanatory until it is repointed or unscheduled (a
--   production schedule change, deliberately not made by this file).
--   Weekly candidate matching is the match-generator Edge Function,
--   which delivers Tier 1 / Tier 2 into match_history with campus,
--   gender and block eligibility:
--     supabase/functions/match-generator/index.ts
--     supabase/functions/_shared/matchingEligibility.ts
--
-- SAFETY:
--   * Idempotent: drop-if-exists + create. Re-running is a no-op.
--   * Touches no data: this file contains no INSERT, UPDATE, DELETE
--     or TRUNCATE against any table, including matches and payments.
--   * Preserves the chain's grant posture: EXECUTE is revoked from
--     public/anon/authenticated again after creation, so recreating
--     the function cannot re-open the hole the chain closed.
--   * NOT APPLIED to any database by existing in Git. Apply it
--     deliberately, through the normal migration flow, after review.
--
-- Regression coverage: scripts/verify-weekly-generation-safety.mjs
-- asserts (statically, per file) that this migration contains no DML,
-- keeps the visible-failure retirement, and that the legacy edge
-- engines stay absent from the repository.
-- ============================================================

drop function if exists public.generate_tuesday_matches();

create function public.generate_tuesday_matches()
returns void
language plpgsql
as $$
begin
  raise exception
    'generate_tuesday_matches() is retired. It truncated public.matches, which holds paid Qrashe pairs (payments.match_id -> matches.id) and is written only by complete_force_connect(). Weekly candidate matching is the match-generator Edge Function, which delivers Tier 1 / Tier 2 into match_history with campus, gender and block eligibility. Repoint or unschedule the calculate-weekly-matches cron job.';
end;
$$;

-- Keep the chain's hardening: re-creating the function must not
-- re-grant EXECUTE to client roles (PostgreSQL grants EXECUTE to
-- PUBLIC by default).
revoke all on function public.generate_tuesday_matches() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.generate_tuesday_matches() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.generate_tuesday_matches() from authenticated';
  end if;
end $$;
