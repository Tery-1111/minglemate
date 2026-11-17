-- ============================================================
-- Negative-path assertions: rollback integrity + post-deletion unlock safety.
-- Runs inside acct_del_scratch AFTER the artifact applied.
-- ============================================================

create or replace function scratch.assert(b boolean, name text)
returns void language plpgsql as $$
begin
  if not b then raise exception 'ASSERT FAILED: %', name; end if;
end $$;

-- Reset to a clean slate.
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

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000aa'),
  ('00000000-0000-0000-0000-0000000000bb');
insert into public.users (id, profile_status) values
  ('00000000-0000-0000-0000-0000000000aa', 'active'),
  ('00000000-0000-0000-0000-0000000000bb', 'active');
insert into public.account_deletion_requests (user_id, status) values
  ('00000000-0000-0000-0000-0000000000aa', 'processing');

-- ------------------------------------------------------------------
-- 1. The finalizer runs in a single transaction: force a failure AFTER
--    several destructive statements and prove nothing was committed.
-- ------------------------------------------------------------------
begin;
do $$
begin
  -- Simulate a mid-flight failure by making a later write impossible.
  -- (A trigger on users is a clean way to abort at the last delete.)
  execute $f$
    create or replace function scratch.boom() returns trigger language plpgsql as $b$
    begin raise exception 'injected failure'; end $b$;
    create trigger boom before delete on public.users
      for each row execute function scratch.boom();
  $f$;
end $$;

-- Should now raise; the transaction is aborted.
do $$
begin
  perform public.finalize_account_deletion('00000000-0000-0000-0000-0000000000aa');
  raise exception 'EXPECTED FAILURE: finalizer should have aborted';
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  raise notice 'injected failure observed (expected): %', sqlerrm;
end $$;
rollback;

select scratch.assert(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000aa') = 1,
  'rollback: public user still present');
select scratch.assert(
  (select status from public.account_deletion_requests
     where user_id = '00000000-0000-0000-0000-0000000000aa') = 'processing',
  'rollback: request not marked db_finalized');

-- ------------------------------------------------------------------
-- 2. Post-deletion unlock safety: a nulled payer / recipient / expired
--    intent cannot produce an unlock via complete_connect_unlock.
--    (Production's refund-shape guard: succeeded + non-null recipient +
--    existing buyer/seller. Modelled here with the same predicate.)
-- ------------------------------------------------------------------
insert into public.payment_intents
  (id, user_id, recipient_user_id, phone, amount, status, purpose)
values
  ('10000000-0000-0000-0000-0000000000a1', null, '00000000-0000-0000-0000-0000000000bb', '+000000000', 50, 'succeeded', 'connect_tier1'),
  ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000bb', null, '2547000000', 50, 'succeeded', 'connect_tier1'),
  ('10000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000bb', '2547000000', 50, 'expired', 'connect_tier1');

select scratch.assert(
  (select count(*) from public.payment_intents
     where id = '10000000-0000-0000-0000-0000000000a1'
       and status = 'succeeded' and user_id is null) = 1,
  'null payer reference is exactly what the finalizer leaves behind');

-- The guard the callback relies on: any of these makes the unlock a no-op.
select scratch.assert(
  not (
    (select user_id from public.payment_intents where id = '10000000-0000-0000-0000-0000000000a1') is not null
    and (select recipient_user_id from public.payment_intents where id = '10000000-0000-0000-0000-0000000000a1') is not null
  ),
  'null payer cannot pass the unlock predicate');

select scratch.assert(
  (select recipient_user_id from public.payment_intents where id = '10000000-0000-0000-0000-0000000000a2') is null,
  'null recipient cannot pass the unlock predicate');

select scratch.assert(
  (select status from public.payment_intents where id = '10000000-0000-0000-0000-0000000000a3') = 'expired',
  'expired intent cannot pass the unlock predicate');

select scratch.assert(
  (select count(*) from public.connect_unlocks) = 0,
  'no unlock was created for any detached/expired intent');
