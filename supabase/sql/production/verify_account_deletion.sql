-- ============================================================
-- READ-ONLY verification for the account-deletion implementation.
-- Safe to run against production. No DDL, no DML, no function calls
-- that mutate (the RPCs are referenced, never invoked).
--
-- Every row's `ok` should be true.
-- ============================================================

with checks as (

  -- ---- functions exist with the expected signatures ----
  select 'request_account_deletion() exists' as item,
         exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'request_account_deletion'
             and pg_get_function_identity_arguments(p.oid) = ''
         ) as ok

  union all
  select 'finalize_account_deletion(uuid) exists',
         exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'finalize_account_deletion'
             and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'
         )

  union all
  select 'request RPC is SECURITY DEFINER',
         coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname='public' and p.proname='request_account_deletion'), false)

  union all
  select 'finalizer is SECURITY DEFINER',
         coalesce((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname='public' and p.proname='finalize_account_deletion'), false)

  union all
  select 'request RPC pins search_path',
         coalesce((select (p.proconfig is not null and exists (
                             select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='request_account_deletion'), false)

  union all
  select 'finalizer pins search_path',
         coalesce((select (p.proconfig is not null and exists (
                             select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='finalize_account_deletion'), false)

  -- ---- privileges ----
  union all
  select 'authenticated may execute request RPC',
         coalesce((select has_function_privilege('authenticated',
                          'public.request_account_deletion()', 'EXECUTE')), false)

  union all
  select 'anon may NOT execute request RPC',
         not coalesce((select has_function_privilege('anon',
                          'public.request_account_deletion()', 'EXECUTE')), false)

  union all
  select 'service_role may execute finalizer',
         coalesce((select has_function_privilege('service_role',
                          'public.finalize_account_deletion(uuid)', 'EXECUTE')), false)

  union all
  select 'authenticated may NOT execute finalizer',
         not coalesce((select has_function_privilege('authenticated',
                          'public.finalize_account_deletion(uuid)', 'EXECUTE')), false)

  union all
  select 'anon may NOT execute finalizer',
         not coalesce((select has_function_privilege('anon',
                          'public.finalize_account_deletion(uuid)', 'EXECUTE')), false)

  -- ---- deletion-request table ----
  union all
  select 'account_deletion_requests exists',
         to_regclass('public.account_deletion_requests') is not null

  union all
  select 'account_deletion_requests has RLS enabled',
         coalesce((select relrowsecurity from pg_class
                   where oid = 'public.account_deletion_requests'::regclass), false)

  union all
  select 'no Data API grant to anon',
         not coalesce(has_table_privilege('anon', 'public.account_deletion_requests', 'SELECT'), false)

  union all
  select 'no Data API grant to authenticated',
         not coalesce(has_table_privilege('authenticated', 'public.account_deletion_requests', 'SELECT'), false)

  union all
  select 'service_role owns table privileges',
         coalesce(has_table_privilege('service_role', 'public.account_deletion_requests', 'SELECT'), false)

  union all
  select 'user_id is the primary key',
         exists (select 1 from pg_constraint
                 where conrelid = 'public.account_deletion_requests'::regclass
                   and contype = 'p')

  union all
  select 'user_id cascades from auth.users',
         exists (select 1 from pg_constraint
                 where conrelid = 'public.account_deletion_requests'::regclass
                   and contype = 'f' and confdeltype = 'c')

  union all
  select 'status CHECK allows pending/processing/db_finalized',
         coalesce((select pg_get_constraintdef(oid) like '%pending%processing%db_finalized%'
                   from pg_constraint
                   where conrelid = 'public.account_deletion_requests'::regclass
                     and contype = 'c'
                     and pg_get_constraintdef(oid) like '%status%'), false)

  -- ---- retention FKs: nullable + SET NULL ----
  union all
  select 'payment_intents.user_id -> auth.users SET NULL',
         exists (select 1 from pg_constraint
                 where conname = 'payment_intents_user_id_fkey' and confdeltype = 'n')
  union all
  select 'payment_intents.user_id is nullable',
         (select is_nullable = 'YES' from information_schema.columns
          where table_schema='public' and table_name='payment_intents' and column_name='user_id')

  union all
  select 'payment_intents.recipient_user_id -> users SET NULL',
         exists (select 1 from pg_constraint
                 where conname = 'payment_intents_recipient_user_id_fkey' and confdeltype = 'n')

  union all
  select 'payments.user_id -> auth.users SET NULL',
         exists (select 1 from pg_constraint
                 where conname = 'payments_user_id_fkey' and confdeltype = 'n')

  union all
  select 'connect_unlocks.buyer_id -> users SET NULL',
         exists (select 1 from pg_constraint
                 where conname = 'connect_unlocks_buyer_id_fkey' and confdeltype = 'n')
  union all
  select 'connect_unlocks.seller_id -> users SET NULL',
         exists (select 1 from pg_constraint
                 where conname = 'connect_unlocks_seller_id_fkey' and confdeltype = 'n')
  union all
  select 'connect_unlocks sides are nullable',
         (select bool_and(is_nullable = 'YES') from information_schema.columns
          where table_schema='public' and table_name='connect_unlocks'
            and column_name in ('buyer_id','seller_id'))
)
select item, ok, case when ok then 'PASS' else 'FAIL' end as result
from checks
order by (case when ok then 1 else 0 end), item;
