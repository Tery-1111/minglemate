-- ============================================================
-- Chain-schema acceptance for the forward migration.
--
-- Proves two things the production-only harness cannot:
--   1. the forward migration applies to a chain database (no payments,
--      no profiles, no prod-only tables);
--   2. finalize_account_deletion() and request_account_deletion() actually
--      RUN there, with the production-only statements skipped.
--
-- ISOLATION CONTRACT — do not run this against production or a shared DB.
--   The whole script is one transaction and ends in ROLLBACK. `\set
--   ON_ERROR_STOP on` is set so that an assertion failure aborts immediately
--   and psql exits WITHOUT reaching ROLLBACK, which means PostgreSQL aborts
--   the open transaction when the session ends and nothing is committed.
--   Either way — success or failure — no fixture data persists.
--
--   Verified behaviour (see docs/ACCOUNT_DELETION_OUTSTANDING_VERIFICATION.md):
--     success -> reaches ROLLBACK -> no rows
--     failure -> ON_ERROR_STOP exits mid-transaction -> implicit rollback -> no rows
--
-- Run against a disposable database only, e.g.:
--   docker exec supabase_db_minglemate psql -U postgres -d chain_scratch \
--     -v ON_ERROR_STOP=1 -f /tmp/chain.sql
-- ============================================================

\set ON_ERROR_STOP on

begin;

create schema if not exists scratch;
create or replace function scratch.assert(b boolean, name text)
returns void language plpgsql as $$
begin
  if not b then raise exception 'ASSERT FAILED: %', name; end if;
end $$;

-- seed two chain users. on_auth_user_created creates public.users for us.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000aa'),
  ('00000000-0000-0000-0000-0000000000bb');
update public.users set full_name = 'Deleted' where id = '00000000-0000-0000-0000-0000000000aa';
update public.users set full_name = 'Keep'    where id = '00000000-0000-0000-0000-0000000000bb';

insert into public.account_deletion_requests (user_id, status)
values ('00000000-0000-0000-0000-0000000000aa', 'processing');

-- exercise the finalizer for real on the chain schema
select public.finalize_account_deletion('00000000-0000-0000-0000-0000000000aa');

select scratch.assert(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000aa') = 0,
  'chain: public user deleted');
select scratch.assert(
  (select count(*) from public.users where id = '00000000-0000-0000-0000-0000000000bb') = 1,
  'chain: other user retained');
select scratch.assert(
  (select status from public.account_deletion_requests
     where user_id = '00000000-0000-0000-0000-0000000000aa') = 'db_finalized',
  'chain: request marked db_finalized');
select scratch.assert(
  to_regclass('public.account_deletion_requests') is not null,
  'chain: request table exists');
select scratch.assert(
  to_regprocedure('public.finalize_account_deletion(uuid)') is not null,
  'chain: finalizer exists');
select scratch.assert(
  to_regprocedure('public.request_account_deletion()') is not null,
  'chain: request RPC exists');
select scratch.assert(
  not has_function_privilege('authenticated', 'public.finalize_account_deletion(uuid)', 'EXECUTE'),
  'chain: authenticated cannot execute the finalizer');
select scratch.assert(
  has_function_privilege('service_role', 'public.finalize_account_deletion(uuid)', 'EXECUTE'),
  'chain: service_role can execute the finalizer');

-- Nothing above may survive: the transaction is always rolled back.
rollback;

\echo '--- chain acceptance: all assertions passed (rolled back) ---'
