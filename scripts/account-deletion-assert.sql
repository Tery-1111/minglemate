-- ============================================================
-- Scratch-fixture assertions for the account-deletion artifact.
-- Runs inside acct_del_scratch AFTER the artifact applied successfully.
-- Every SELECT must yield all-true rows. Throws on any failure via
-- procedures with zero tolerance (raise exception on any false).
-- ============================================================

-- Repeatable: clear any state from a previous run.
truncate table
  public.payment_prompts, public.gift_transactions, public.token_purchases,
  public.connect_unlocks, public.payments, public.payment_intents,
  public.reports, public.user_reputation, public.badges,
  public.question_engagement_metrics, public.engagement_metrics,
  public.compatibility_scores, public.match_signals, public.match_queue,
  public.match_interactions, public.match_behavior, public.match_history,
  public.matches, public.likes, public.user_blocks, public.conversations,
  public.notifications, public.messages, public.section2_chat_progress,
  public.section2_responses, public.section1_responses, public.user_responses,
  public.user_photos, public.photos, public.profiles,
  public.account_deletion_requests, public.users, auth.users
  restart identity cascade;

create or replace function scratch.assert(b boolean, name text)
returns void language plpgsql as $$
begin
  if not b then
    raise exception 'ASSERT FAILED: %', name;
  end if;
end $$;

-- ------------------------------------------------------------------
-- Key fixture rows (del + keep + unrelated) with realistic columns.
-- ------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000aa'),
  ('00000000-0000-0000-0000-0000000000bb');

insert into public.users (id, profile_status, notifications_enabled, onesignal_player_id, full_name)
values
  ('00000000-0000-0000-0000-0000000000aa', 'active', true,  'player-del',  'DeletedUser'),
  ('00000000-0000-0000-0000-0000000000bb', 'active', true,  'player-keep', 'OtherUser');

insert into public.payment_intents
  (id, user_id, recipient_user_id, phone, amount, status, callback_key, status_reason, verification_detail, unlock_error, purpose)
values
  -- del as payer, pending -> must expire + detach + redact
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', '254700000001', 50, 'pending', 'sec-1', null, null, null, 'connect_tier1'),
  -- del as recipient, pending -> must expire + detach recipient
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', '254700000002', 50, 'pending', 'sec-2', null, null, null, 'connect_tier1'),
  -- succeeded, del as payer -> untouched status; detach + redact phone
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', '254700000003', 50, 'succeeded', 'sec-3', null, null, null, 'connect_tier1'),
  -- unrelated -> untouched
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000bb', null, '254700000004', 10, 'pending', 'sec-4', null, null, null, 'connect_tier1');

insert into public.connect_unlocks
  (id, buyer_id, seller_id, tier, amount, payment_intent_id, phone, email)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 'tier1', 50, '10000000-0000-0000-0000-000000000003', '254700000003', 'del@x.test'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000bb', 'tier1', 50, '10000000-0000-0000-0000-000000000004', '254700000004', 'keep@x.test');

insert into public.messages (id, sender_id, recipient_id, content, has_contact_info, sender_id_allows_bot, is_bot)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 'hi', true, true, false),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', 'yo', true, false, false),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000bb', 'noop', false, false, false);

insert into public.notifications (id, user_id) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb');

insert into public.reports (id, reporter_id, reported_id, reason) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 'spam'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', 'other'),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000bb', null, 'keep');

insert into public.matches (id, user_a_id, user_b_id, status, is_visible, compatibility_score) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 'matched', true, 90),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000bb', 'pending', false, 10);

insert into public.match_history (id, user_id, tier1_match_id, tier2_match_id) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '60000000-0000-0000-0000-000000000001', null),
  ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '60000000-0000-0000-0000-000000000001', null);

insert into public.payments (id, user_id, phone_number, amount, status, match_id) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '254700000003', 50, 'succeeded', '60000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb', '254700000004', 10, 'succeeded', null);

insert into public.token_purchases (id, user_id, gifted_by, amount, status) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', null, 5, 'succeeded'),
  ('90000000-0000-0000-0000-000000000002', null, '00000000-0000-0000-0000-0000000000aa', 5, 'succeeded');

insert into public.gift_transactions (id, gifter_user_id, recipient_user_id, amount) values
  ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 1);

insert into public.payment_prompts (id, sender_user_id, recipient_user_id, amount) values
  ('92000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 1);

insert into public.section2_chat_progress (id, user_id_a, user_id_b) values
  ('93000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb');

insert into public.likes (id, user_id, target_user_id) values
  ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb');

insert into public.badges (id, user_id) values
  ('95000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa');

insert into public.user_reputation (id, user_id) values
  ('96000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa');

insert into public.engagement_metrics (id, user_id, value) values
  ('97000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 1);

insert into public.question_engagement_metrics (id, user_id, value) values
  ('98000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 1);

insert into public.match_behavior (id, user_id, date, value) values
  ('99000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '2026-11-16', 1);

insert into public.match_queue (id, user_id) values
  ('99100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa');

insert into public.match_signals (id, user_id) values
  ('99200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa');

insert into public.match_interactions (id, user_id) values
  ('99300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa');

insert into public.compatibility_scores (id, user_id_a, user_id_b, score) values
  ('99400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000bb', 42);


-- ------------------------------------------------------------------
-- Drive phase 1 (as the deleted user) and phase 2 (service role).
-- ------------------------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';
select public.request_account_deletion();
reset request.jwt.claim.sub;

select public.finalize_account_deletion('00000000-0000-0000-0000-0000000000aa');

-- ------------------------------------------------------------------
-- Behavior assertions (all must pass)
-- ------------------------------------------------------------------
select scratch.assert(pg_get_functiondef('public.finalize_account_deletion(uuid)'::regprocedure) like '%account_deletion_requests%', 'finalizer references request table');

select scratch.assert(
  (select count(*) from public.payment_intents where id = '10000000-0000-0000-0000-000000000001'
     and status = 'expired' and user_id is null and recipient_user_id = '00000000-0000-0000-0000-0000000000bb'
     and phone = '+000000000' and callback_key is null) = 1,
  'payer pending intent expired + detached + redacted');

select scratch.assert(
  (select count(*) from public.payment_intents where id = '10000000-0000-0000-0000-000000000002'
     and status = 'expired' and recipient_user_id is null) = 1,
  'recipient pending intent expired + recipient detached');

select scratch.assert(
  (select count(*) from public.payment_intents where id = '10000000-0000-0000-0000-000000000003'
     and status = 'succeeded' and user_id is null and phone = '+000000000') = 1,
  'succeeded intent evidence retained, person detached');

select scratch.assert(
  (select count(*) from public.payment_intents where id = '10000000-0000-0000-0000-000000000004'
     and status = 'pending' and user_id = '00000000-0000-0000-0000-0000000000bb') = 1,
  'unrelated pending intent untouched');

select scratch.assert(
  (select count(*) from public.connect_unlocks where id = '20000000-0000-0000-0000-000000000001'
     and buyer_id is null and seller_id is null and phone = '254700000003') = 1,
  'unlock snapshot retained and hidden (both sides null)');

select scratch.assert(
  (select count(*) from public.connect_unlocks where id = '20000000-0000-0000-0000-000000000002'
     and buyer_id = '00000000-0000-0000-0000-0000000000bb' and seller_id = '00000000-0000-0000-0000-0000000000bb') = 1,
  'unrelated unlock untouched');

select scratch.assert(
  (select count(*) from public.messages where id = '30000000-0000-0000-0000-000000000001'
     and sender_id is null and content = '[deleted]' and has_contact_info = false and sender_id_allows_bot = false) = 1,
  'sent message anonymised');

select scratch.assert(
  (select count(*) from public.messages where id = '30000000-0000-0000-0000-000000000002') = 0,
  'received message deleted');

select scratch.assert(
  (select count(*) from public.messages where id = '30000000-0000-0000-0000-000000000003'
     and sender_id = '00000000-0000-0000-0000-0000000000bb') = 1,
  'unrelated message untouched');

select scratch.assert((select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000aa') = 0, 'notifications deleted');

select scratch.assert(
  (select count(*) from public.reports where id = '50000000-0000-0000-0000-000000000001' and reporter_id is null and reported_id = '00000000-0000-0000-0000-0000000000bb') = 1
  and (select count(*) from public.reports where id = '50000000-0000-0000-0000-000000000002' and reporter_id = '00000000-0000-0000-0000-0000000000bb' and reported_id is null) = 1
  and (select count(*) from public.reports where id = '50000000-0000-0000-0000-000000000003' and reporter_id = '00000000-0000-0000-0000-0000000000bb' and reported_id is null) = 1,
  'reports retained, deleted-user refs detached');

select scratch.assert((select count(*) from public.matches where id = '60000000-0000-0000-0000-000000000001') = 0, 'match deleted');
select scratch.assert((select count(*) from public.matches where id = '60000000-0000-0000-0000-000000000002') = 1, 'unrelated match retained');

select scratch.assert(
  (select count(*) from public.match_history where id = '70000000-0000-0000-0000-000000000002'
     and tier1_match_id is null and user_id = '00000000-0000-0000-0000-0000000000bb') = 1,
  'other user history retained, dangling match ref cleared');

select scratch.assert((select count(*) from public.match_history where id = '70000000-0000-0000-0000-000000000001') = 0, 'own match history deleted');

select scratch.assert(
  (select count(*) from public.payments where id = '80000000-0000-0000-0000-000000000001'
     and user_id is null and phone_number = '+000000000' and match_id is null and status = 'succeeded') = 1,
  'payment evidence retained, user + match detached, phone redacted');

select scratch.assert((select count(*) from public.payments where id = '80000000-0000-0000-0000-000000000002' and user_id = '00000000-0000-0000-0000-0000000000bb') = 1, 'unrelated payment untouched');

select scratch.assert(
  (select count(*) from public.token_purchases where id = '90000000-0000-0000-0000-000000000001' and user_id is null) = 1
  and (select count(*) from public.token_purchases where id = '90000000-0000-0000-0000-000000000002' and gifted_by is null) = 1,
  'token purchases retained, refs detached');

select scratch.assert((select count(*) from public.gift_transactions where id = '91000000-0000-0000-0000-000000000001'
  and gifter_user_id is null and recipient_user_id = '00000000-0000-0000-0000-0000000000bb') = 1, 'gift evidence retained, gifter detached');

select scratch.assert((select count(*) from public.payment_prompts where id = '92000000-0000-0000-0000-000000000001') = 0, 'payment prompts deleted');

select scratch.assert((select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000aa') = 0, 'public user deleted');
select scratch.assert(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000bb' and profile_status = 'active') = 1,
  'unrelated user untouched');

select scratch.assert(
  (select count(*) from public.likes where id = '94000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.match_behavior where id = '99000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.match_queue where id = '99100000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.match_signals where id = '99200000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.match_interactions where id = '99300000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.compatibility_scores where id = '99400000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.badges where id = '95000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.user_reputation where id = '96000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.engagement_metrics where id = '97000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.question_engagement_metrics where id = '98000000-0000-0000-0000-000000000001') = 0
  and (select count(*) from public.section2_chat_progress where id = '93000000-0000-0000-0000-000000000001') = 0,
  'personal matching/engagement records deleted');

select scratch.assert(
  (select count(*) from public.account_deletion_requests where user_id = '00000000-0000-0000-0000-0000000000aa'
     and status = 'db_finalized' and db_finalized_at is not null) = 1,
  'request marked db_finalized');

-- The finalizer must be idempotent: run it twice (second is a no-op).
select public.finalize_account_deletion('00000000-0000-0000-0000-0000000000aa');
select scratch.assert(
  (select count(*) from public.account_deletion_requests where user_id = '00000000-0000-0000-0000-0000000000aa'
     and status = 'db_finalized') = 1,
  'finalizer idempotent on repeat');

-- request RPC path: pause + mute + clear player id + record request.
-- auth.uid() is derived from the session setting, so re-establish it here.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000aa';
select public.request_account_deletion();
select scratch.assert(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000aa') = 0,
  'request RPC on an already-finalized user does not recreate the public row');
reset request.jwt.claim.sub;
-- The request already reached db_finalized, and the RPC must not walk that
-- back; it may only bump attempts / updated_at.
select scratch.assert(
  (select count(*) from public.account_deletion_requests
     where user_id = '00000000-0000-0000-0000-0000000000aa'
       and status = 'db_finalized' and attempts >= 2) = 1,
  'request RPC preserved db_finalized and incremented attempts');
-- ------------------------------------------------------------------
-- Phone redaction is a non-routable sentinel, not a reusable number.
-- ------------------------------------------------------------------
select scratch.assert(
  (select phone from public.payment_intents
     where id = '10000000-0000-0000-0000-000000000003') = '+000000000',
  'redacted intent phone is the +000000000 sentinel');
select scratch.assert(
  (select phone_number from public.payments
     where id = '80000000-0000-0000-0000-000000000001') = '+000000000',
  'redacted payment phone_number is the sentinel');
-- The sentinel cannot pass the Kenyan phone validator the payment path uses,
-- so it can never be submitted as a real payer number.
select scratch.assert(
  '+000000000' !~ '^(?:\+?254|0)(?:7\d|1\d)\d{7}$',
  'sentinel cannot pass the Kenyan phone validator');
-- No unique index on either phone column: many redacted rows may coexist.
select scratch.assert(
  not exists (select 1 from pg_indexes
              where schemaname='public' and tablename in ('payment_intents','payments')
                and indexdef ilike '%unique%' and indexdef ilike '%phone%'),
  'no unique phone index exists, so redaction cannot collide');
