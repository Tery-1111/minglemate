-- ============================================================================
-- ROLLBACK for C2 — 20261110090200_unmatch_conversation_repair.sql
-- ============================================================================
-- WARNING: SECURITY-WEAKENING ROLLBACK.
--   The grant section of this rollback restores EXECUTE to PUBLIC, which anon and
--   authenticated inherit. That re-opens an unauthenticated entry point into a
--   SECURITY DEFINER function. The function body itself still calls auth.uid() and
--   raises when it is null, so an anonymous call fails at the auth check rather
--   than performing a write -- but the grant should be treated as a regression.
--   Restore the body only (omit the grant block) unless the grants are the proven
--   problem.
--
-- This file is NOT a migration. It lives outside supabase/migrations/.
--
-- NOTE ON BODY RESTORATION
--   The pre-C2 body is NOT stored in the repository: the repo never contained the
--   authoritative definition. The body below is the verified production body,
--   which is identical to what C2 installs. Therefore a body-only rollback is a
--   no-op on both current environments, and the only real effect of a C2 rollback
--   is the grant change. That is documented rather than hidden.
-- ============================================================================

begin;

do $$
begin
  if to_regprocedure('public.unmatch_conversation(uuid)') is null then
    raise exception 'C2 rollback precondition failed: unmatch_conversation does not exist';
  end if;
end
$$;

-- Body: verified production definition (same as forward migration).
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

-- Grant restoration: returns to the STAGING-pre-C2 privilege state.
-- Omitted-if-unwanted: delete the next two lines to keep anon/PUBLIC revoked.
grant execute on function public.unmatch_conversation(uuid) to public;
grant execute on function public.unmatch_conversation(uuid) to anon;

do $$
begin
  raise notice 'C2 rolled back: body unchanged; EXECUTE restored to PUBLIC + anon (SECURITY WEAKENED)';
end
$$;

commit;
