-- PRODUCTION FIX: Report, Unmatch and Block buttons on the match detail page.
-- Target: Supabase project mhdjnhiqahsllbczbzpk (production). Applied 2026-11-08 by direct SQL, not a migration.
-- Outside supabase/migrations on purpose: production never ran the consolidated chain.
-- Re-runnable: every statement is create-or-replace / drop-if-exists.
--
-- What was wrong and what this changes (three fixes, nothing else):
--
-- 1. REPORT. Two AFTER INSERT triggers on public.reports read NEW.reported_user_id.
--    The real column is reported_id, so every report insert failed with
--    'column "reported_user_id" does not exist'. Both functions now use reported_id.
--    They are also SECURITY DEFINER with a fixed search_path, because they write to
--    public.users (reputation_score) and public.system_alerts, and RLS lets an
--    ordinary user write neither. The trigger objects themselves are unchanged.
--
-- 2. UNMATCH. Chat.jsx and MatchDetail.jsx call rpc('unmatch_conversation'); it did
--    not exist in production. The repo's chain version cannot be used here: it writes
--    matches.status = 'unmatched' (not allowed by production's matches_status_check)
--    and reads matches.created_by (absent in production). This version:
--      - refuses unauthenticated calls, self-unmatch, and people you are not paired with
--        (public.users_are_paired);
--      - refuses after Connect (a connect_unlocks row in either direction);
--      - records conversations.status = 'unmatched' (upsert on the unique pair);
--      - sets the live matches row to 'discarded' with discarded_at.
--    It never touches matches.is_visible, payments, Qrashe or Force Connect.
--
-- 3. BLOCK / UNMATCH ENFORCEMENT. Production's two permissive INSERT policies on
--    public.messages only checked sender = auth.uid(), so a blocked or unmatched
--    person could still send. They are replaced by the repo's own
--    messages_insert_own_sender rule: sender must be the caller, no block in either
--    direction, and the conversation must not be locked or unmatched.

create or replace function public.update_reputation_on_report() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  update public.users set reputation_score = reputation_score - 10 where id = new.reported_id;
  return new;
end; $f$;

create or replace function public.notify_if_too_many_reports() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  if (select count(*) from public.reports where reported_id = new.reported_id) > 3 then
    insert into public.system_alerts (alert_type, message, severity)
    values ('DANGER', 'High volume of reports for user: ' || new.reported_id, 'HIGH');
  end if;
  return new;
end; $f$;

create or replace function public.unmatch_conversation(other_user_id uuid) returns void
language plpgsql security definer set search_path = public as $f$
declare me uuid := auth.uid(); pair_a uuid; pair_b uuid; tier text;
begin
  if me is null or other_user_id is null or me = other_user_id then
    raise exception 'Not authenticated';
  end if;
  if not public.users_are_paired(me, other_user_id) then
    raise exception 'You are not matched with this person';
  end if;
  if exists (select 1 from public.connect_unlocks cu
             where (cu.buyer_id = me and cu.seller_id = other_user_id)
                or (cu.buyer_id = other_user_id and cu.seller_id = me)) then
    raise exception 'Cannot unmatch after Connect';
  end if;
  pair_a := least(me, other_user_id);
  pair_b := greatest(me, other_user_id);
  tier := case when exists (select 1 from public.match_history mh
                            where (mh.user_id = me and mh.tier2_match_id = other_user_id)
                               or (mh.user_id = other_user_id and mh.tier2_match_id = me))
               then 'tier2' else 'tier1' end;
  insert into public.conversations (user_a_id, user_b_id, match_tier, status)
  values (pair_a, pair_b, tier, 'unmatched')
  on conflict (user_a_id, user_b_id)
  do update set status = 'unmatched' where public.conversations.status = 'active';
  update public.matches set status = 'discarded', discarded_at = now()
  where status = 'matched'
    and ((user_a_id = pair_a and user_b_id = pair_b) or (user_a_id = pair_b and user_b_id = pair_a));
end; $f$;
revoke all on function public.unmatch_conversation(uuid) from public, anon;
grant execute on function public.unmatch_conversation(uuid) to authenticated;

drop policy if exists "Users can send messages" on public.messages;
drop policy if exists "Allow users to send messages_v2" on public.messages;
drop policy if exists "messages_insert_own_sender" on public.messages;
create policy "messages_insert_own_sender" on public.messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and not exists (select 1 from public.user_blocks ub
                  where (ub.blocker_id = auth.uid() and ub.blocked_id = recipient_id)
                     or (ub.blocker_id = recipient_id and ub.blocked_id = auth.uid()))
  and not exists (select 1 from public.conversations c
                  where ((c.user_a_id = auth.uid() and c.user_b_id = recipient_id)
                      or (c.user_b_id = auth.uid() and c.user_a_id = recipient_id))
                    and c.status in ('locked', 'unmatched'))
);
