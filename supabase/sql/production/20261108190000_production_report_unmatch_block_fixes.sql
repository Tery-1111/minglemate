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

-- ---------------------------------------------------------------------------
-- 4. REPORT ABUSE RULES (applied 2026-11-08, after fixes 1-3 above).
--    A report is accepted only if the reported person has sent the reporter at
--    least one real (non-bot) message, or one of them bought a Connect with the
--    other. Self-reports and spoofed reporters are refused. One report per
--    reporter per reported person. One duplicate test report was removed first
--    (id de1f79a8-ca12-410e-91d6-e046e5801909).
delete from public.reports where id = 'de1f79a8-ca12-410e-91d6-e046e5801909';
create unique index if not exists reports_one_per_pair on public.reports (reporter_id, reported_id);
drop policy if exists "Users can report" on public.reports;
drop policy if exists "reports_insert_after_contact" on public.reports;
create policy "reports_insert_after_contact" on public.reports for insert to authenticated
with check (
  reporter_id = auth.uid() and reported_id <> auth.uid()
  and (
    exists (select 1 from public.messages m
            where m.sender_id = reported_id and m.recipient_id = auth.uid() and m.is_bot = false)
    or exists (select 1 from public.connect_unlocks cu
               where (cu.buyer_id = auth.uid() and cu.seller_id = reported_id)
                  or (cu.buyer_id = reported_id and cu.seller_id = auth.uid()))
  )
);

-- 5. UNMATCH HIDES SECTION 2 ANSWERS (applied 2026-11-08).
--    Weekly matches are paired through match_history, which unmatch does not
--    change (match_history is the weekly delivery record). So the Section 2
--    visibility rule itself now refuses a pair whose conversation is unmatched.
--    Only public.is_section2_partner changes. users_are_paired is NOT touched:
--    it is shared with Connect, Force Connect and contact reveal.
create or replace function public.is_section2_partner(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select a is not null and b is not null and a <> b
    and not exists (select 1 from public.user_blocks ub
                    where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a))
    and not exists (select 1 from public.conversations c
                    where c.status = 'unmatched'
                      and ((c.user_a_id = a and c.user_b_id = b) or (c.user_a_id = b and c.user_b_id = a)))
    and (
      exists (select 1 from public.match_history mh
              where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
                 or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a)))
      or exists (select 1 from public.matches m
                 where m.status in ('active','matched')
                   and ((m.user_a_id = a and m.user_b_id = b) or (m.user_a_id = b and m.user_b_id = a)))
    ); $f$;

-- 6. CHAT TRIGGER trg_auto_bot_question (decision log, 2026-11-10).
--    The trigger runs on every human message and reads
--    section2_chat_progress.match_week_id, a column that does not exist, so a human
--    text message fails with: column "match_week_id" does not exist.
--    It was dropped on 2026-11-10 after a rolled-back test, then RESTORED the same
--    day on the owner's instruction (no free-text messages allowed). Production
--    therefore still has it. Guided bot questions (is_bot = true) are unaffected.
--    Effect to be aware of: no human text message can be sent, so nobody can meet
--    the 'reported person has messaged you' rule in section 4 through chat; only a
--    Connect satisfies it. Restoring command, if dropped again:
--      create trigger trg_auto_bot_question after insert on public.messages
--      for each row execute function handle_bot_question_trigger();

-- 7. BLOCK HIDES ALREADY-UNLOCKED CONTACTS (applied 2026-11-10, owner decision).
--    get_unlocked_contacts now returns nothing when either person has blocked the
--    other. Unblocking brings the contact back (the paid snapshot is untouched).
--    Only one statement was added, right after the users_are_paired check:
--      if exists (select 1 from public.user_blocks ub
--                 where (ub.blocker_id = me and ub.blocked_id = other_user_id)
--                    or (ub.blocker_id = other_user_id and ub.blocked_id = me)) then return; end if;
create or replace function public.get_unlocked_contacts(other_user_id uuid) returns table(phone text, whatsapp_number text, email text, social_instagram text, social_x text, social_tiktok text)
language plpgsql security definer set search_path to 'public' as $f$
declare me uuid := auth.uid(); paid public.connect_unlocks; contact_owner public.users;
begin
  if me is null or other_user_id is null or me = other_user_id then return; end if;
  if not public.users_are_paired(me, other_user_id) then return; end if;
  if exists (select 1 from public.user_blocks ub where (ub.blocker_id = me and ub.blocked_id = other_user_id) or (ub.blocker_id = other_user_id and ub.blocked_id = me)) then return; end if;
  select cu.* into paid from public.connect_unlocks cu where cu.buyer_id = me and cu.seller_id = other_user_id order by cu.created_at desc limit 1;
  if not found then return; end if;
  select u.* into contact_owner from public.users u where u.id = other_user_id;
  if not found then return; end if;
  return query select
    case when contact_owner.share_phone then paid.phone end,
    case when contact_owner.share_whatsapp then paid.whatsapp_number end,
    case when contact_owner.share_email then paid.email end,
    case when contact_owner.share_social_instagram then paid.social_instagram end,
    case when contact_owner.share_social_x then paid.social_x end,
    case when contact_owner.share_social_tiktok then paid.social_tiktok end;
end; $f$;

-- 8. PRIVATE PHOTOS WITH AUTHORIZED ACCESS (applied 2026-11-13, owner decision).
--    Both storage buckets were private in production while every stored photo_url
--    is a public-style address, so every photo showed as a broken image (HTTP 400).
--    Decision: keep the bucket private; a photo may be viewed only by its owner,
--    by a matched person (weekly Tier 1/2 or Qrashe, no block, not unmatched), or
--    by a user to whom Discover currently shows that person.
--    8a. public.discover_candidates() was MISSING in production although the
--        Discover screen calls it (the repo chain version never ran there).
--        Created unchanged from the repo (consolidated chain, section 8a), then
--        execute revoked from public/anon and granted to authenticated.
--    8b. public.can_view_user_photos(owner_text text): security definer; returns
--        false for a null caller, a malformed folder name, or anyone not allowed.
--    8c. storage.objects: the two public read policies on user-photos
--        ("Public can view photos", "user_photos_public_read") were dropped and
--        replaced by "user_photos_authorized_read". Owner insert/update/delete
--        policies are unchanged. The profile_photos bucket is not used by the app.
--    Tested with rolled-back checks: self, matched person, stranger, malformed
--    input, block, unblock, unmatch, Discover candidate; real storage table seen
--    as the owner (own files only) and as anon (nothing). Not covered here:
--    admin screens that show photos (they need their own rule).
--    discover_candidates() is the repo definition; re-create it from there.
create or replace function public.can_view_user_photos(owner_text text) returns boolean
language plpgsql stable security definer set search_path = public as $f$
declare me uuid := auth.uid(); owner uuid;
begin
  if me is null or owner_text is null
     or owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  owner := owner_text::uuid;
  if owner = me then return true; end if;
  if public.is_section2_partner(me, owner) then return true; end if;
  if exists (select 1 from public.discover_candidates() c where c.id = owner) then return true; end if;
  return false;
end; $f$;
revoke all on function public.can_view_user_photos(text) from public, anon;
grant execute on function public.can_view_user_photos(text) to authenticated;

drop policy if exists "Public can view photos" on storage.objects;
drop policy if exists "user_photos_public_read" on storage.objects;
drop policy if exists "user_photos_authorized_read" on storage.objects;
create policy "user_photos_authorized_read" on storage.objects for select to authenticated
using (bucket_id = 'user-photos' and public.can_view_user_photos((storage.foldername(name))[1]));
