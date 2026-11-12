-- ============================================================================
-- ROLLBACK for C4 — 20261110090000_section2_partner_unmatched_guard.sql
-- ============================================================================
-- WARNING: SECURITY-WEAKENING ROLLBACK.
--   Restoring this body REMOVES the unmatched-conversation guard, re-opening the
--   ability for an explicitly unmatched pair to read each other's Section 2
--   answers via the match_history branch of the predicate. Only run this if C4 is
--   proven to be functionally wrong.
--
-- This file is NOT a migration. It lives outside supabase/migrations/ so it can
-- never be picked up by db push / db reset.
--
-- Restores the exact pre-C4 (repository) definition, i.e. the production body
-- minus the unmatched-conversation guard. Security attributes are unchanged.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.is_section2_partner(uuid,uuid)') is null then
    raise exception 'C4 rollback precondition failed: is_section2_partner does not exist';
  end if;
end
$$;

create or replace function public.is_section2_partner(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a is not null and b is not null and a <> b
    and not exists (select 1 from public.user_blocks ub where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a))
    and (
      exists (select 1 from public.match_history mh where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b)) or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
      or exists (select 1 from public.matches m where m.status in ('active','matched') and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
    ); $function$;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_section2_partner';

  if position('unmatched' in v_def) <> 0 then
    raise exception 'C4 rollback failed: unmatched guard is still present';
  end if;

  raise notice 'C4 rolled back: unmatched-conversation guard removed (SECURITY WEAKENED)';
end
$$;

commit;
