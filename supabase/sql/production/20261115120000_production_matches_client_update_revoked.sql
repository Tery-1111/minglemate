-- D-2 (matches), applied to production 2026-11-15.
-- Problem: the policy "Users can update their own matches" let a participant update ANY column of their match row,
--   including user_a_id / user_b_id. Tested (rolled back): a participant re-pointed their match at an outsider and
--   thereby read the outsider's Section 2 answers and photos, and the outsider could read theirs.
-- The app never updates matches from the client (it only reads; unmatching goes through the unmatch_conversation RPC,
--   which is SECURITY DEFINER). Edge Functions use service_role.
-- Evidence: verified database-level (grants, policies, exploit now denied, own-match read works, direct insert still
--   blocked, unmatch RPC still runs). NOT verified: a real browser test of Matches / Messages / unmatch after this change.

begin;

drop policy if exists "Users can update their own matches" on public.matches;
revoke update on table public.matches from anon, authenticated;

do $a$
declare q text;
begin
  if has_table_privilege('anon','public.matches','UPDATE') or has_table_privilege('authenticated','public.matches','UPDATE') then
    raise exception 'matches: client UPDATE privilege still present';
  end if;
  if not has_table_privilege('service_role','public.matches','UPDATE') then
    raise exception 'matches: service_role lost UPDATE';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='matches' and cmd in ('UPDATE','ALL')) then
    raise exception 'matches: a client UPDATE policy still exists';
  end if;
  select qual into q from pg_policies
   where schemaname='public' and tablename='matches' and policyname='Users can view their own matches' and cmd='SELECT';
  if q is null then raise exception 'matches: the participant SELECT policy is missing'; end if;
  if position('auth.uid() = user_a_id' in q) = 0 or position('auth.uid() = user_b_id' in q) = 0 then
    raise exception 'matches: SELECT policy is not participant-only: %', q;
  end if;
end $a$;

commit;

-- ROLLBACK (restores the previous, exploitable behaviour; only for an emergency):
-- begin;
-- create policy "Users can update their own matches" on public.matches for update to public
--   using ((auth.uid() = user_a_id) or (auth.uid() = user_b_id));
-- grant update on public.matches to anon, authenticated;
-- commit;
