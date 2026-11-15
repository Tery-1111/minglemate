-- Section C (C-1 to C-3), applied to production 2026-11-15.
-- C-1: calculate_and_track_match is dead code (writes to match_success_log, which does not exist; no callers).
--      Executable by PUBLIC/anon before. Revoke from PUBLIC, anon, authenticated; service_role keeps it.
-- C-2/C-3: users_are_paired and is_section2_partner accepted ANY two user ids from a logged-in user, so
--      a user could probe whether two other people were matched. A caller with role 'authenticated' must now
--      be one of the two ids. service_role and backend calls are unchanged (initiate-payment,
--      complete_connect_unlock). Anon still has no execute.
-- Function properties are unchanged: users_are_paired stays VOLATILE (as before), is_section2_partner stays STABLE,
--      both SECURITY DEFINER with search_path=public, owner postgres.
--
-- EVIDENCE
--   Verified: assertions below; rolled-back behavioural tests on the live functions (pair true, outsider false,
--     anon and obsolete function denied, profile/Section 2/photo access preserved, complete_connect_unlock and
--     complete_force_connect work as service_role, paid contact retrieval works for the buyer only).
--   NOT verified: the Edge Function path with a real M-Pesa payment; the live app screens (checked separately).

begin;

create or replace function public.users_are_paired(a uuid, b uuid) returns boolean
language sql security definer set search_path to 'public' as $f$
  select a is not null and b is not null and a <> b
    and (auth.role() is distinct from 'authenticated' or auth.uid() = a or auth.uid() = b)
    and (
      exists (select 1 from public.match_history mh
        where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
           or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
      or exists (select 1 from public.matches m
        where m.status in ('active','matched')
          and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
    ); $f$;

create or replace function public.is_section2_partner(a uuid, b uuid) returns boolean
language sql stable security definer set search_path to 'public' as $f$
  select a is not null and b is not null and a <> b
    and (auth.role() is distinct from 'authenticated' or auth.uid() = a or auth.uid() = b)
    and not exists (select 1 from public.user_blocks ub where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a))
    and not exists (select 1 from public.conversations c where c.status = 'unmatched' and ((c.user_a_id = a and c.user_b_id = b) or (c.user_a_id = b and c.user_b_id = a)))
    and (
      exists (select 1 from public.match_history mh where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b)) or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
      or exists (select 1 from public.matches m where m.status in ('active','matched') and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
    ); $f$;

revoke execute on function public.calculate_and_track_match(uuid) from public, anon, authenticated;

do $a$
declare p record;
begin
  -- C-1
  if has_function_privilege('anon','public.calculate_and_track_match(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.calculate_and_track_match(uuid)','EXECUTE') then
    raise exception 'C-1 failed: obsolete function still executable';
  end if;
  if not has_function_privilege('service_role','public.calculate_and_track_match(uuid)','EXECUTE') then
    raise exception 'C-1 failed: service_role lost execute';
  end if;
  -- C-2/C-3: the actual caller condition is present in each function
  select * into p from pg_proc where oid = 'public.users_are_paired(uuid,uuid)'::regprocedure;
  if position('auth.uid() = a or auth.uid() = b' in p.prosrc) = 0 then raise exception 'C-2 failed: caller condition missing'; end if;
  if p.provolatile <> 'v' or not p.prosecdef or p.proconfig is distinct from array['search_path=public'] then
    raise exception 'C-2 failed: function properties changed';
  end if;
  select * into p from pg_proc where oid = 'public.is_section2_partner(uuid,uuid)'::regprocedure;
  if position('auth.uid() = a or auth.uid() = b' in p.prosrc) = 0 then raise exception 'C-3 failed: caller condition missing'; end if;
  if p.provolatile <> 's' or not p.prosecdef or p.proconfig is distinct from array['search_path=public'] then
    raise exception 'C-3 failed: function properties changed';
  end if;
  -- grants
  if has_function_privilege('anon','public.users_are_paired(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','public.is_section2_partner(uuid,uuid)','EXECUTE') then
    raise exception 'anon must not execute the pairing functions';
  end if;
  if not (has_function_privilege('authenticated','public.users_are_paired(uuid,uuid)','EXECUTE')
      and has_function_privilege('authenticated','public.is_section2_partner(uuid,uuid)','EXECUTE')
      and has_function_privilege('service_role','public.users_are_paired(uuid,uuid)','EXECUTE')
      and has_function_privilege('service_role','public.is_section2_partner(uuid,uuid)','EXECUTE')) then
    raise exception 'a required execute grant was lost';
  end if;
end $a$;

commit;

-- ROLLBACK: the exact production definitions from before this change. Run as one transaction.
--
-- begin;
--
-- create or replace function public.users_are_paired(a uuid, b uuid) returns boolean
-- language sql security definer set search_path to 'public' as $f$
--   select a is not null
--      and b is not null
--      and a <> b
--      and (
--        exists (
--          select 1 from public.match_history mh
--          where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
--             or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
--        )
--        or exists (
--          select 1 from public.matches m
--          where m.status in ('active', 'matched')
--            and ((m.user_a_id = a and m.user_b_id = b)
--              or (m.user_a_id = b and m.user_b_id = a))
--        )
--      );
-- $f$;
--
-- create or replace function public.is_section2_partner(a uuid, b uuid) returns boolean
-- language sql stable security definer set search_path to 'public' as $f$
--   select a is not null and b is not null and a <> b
--     and not exists (select 1 from public.user_blocks ub where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a))
--     and not exists (select 1 from public.conversations c where c.status = 'unmatched' and ((c.user_a_id = a and c.user_b_id = b) or (c.user_a_id = b and c.user_b_id = a)))
--     and (
--       exists (select 1 from public.match_history mh where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b)) or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
--       or exists (select 1 from public.matches m where m.status in ('active','matched') and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
--     );
-- $f$;
--
-- grant execute on function public.calculate_and_track_match(uuid) to public, anon, authenticated;
--
-- commit;
