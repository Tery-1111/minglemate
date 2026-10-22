-- ============================================================
-- SECTION 2 — CONSOLIDATED READ-ONLY SCHEMA CAPTURE (ONE ROW)
--
-- WHY THIS FILE IS ONE STATEMENT
--   The previous version was a series of SELECTs. Supabase's SQL
--   Editor only renders the LAST result set, so every earlier
--   section was invisible to whoever ran it. Everything below is a
--   single SELECT that returns ONE row with ONE jsonb column whose
--   keys are the named sections — nothing can be hidden by the
--   editor, and there is nothing to run individually.
--
-- HOW TO RUN (one action)
--   1. Supabase dashboard -> project "minglemate-staging" ->
--      SQL Editor -> New query.
--   2. Paste this entire file.
--   3. Run (Ctrl/Cmd + Enter).
--   4. Copy the single JSON cell from the one result row and paste
--      it back into the conversation.
--
--   Section keys are the same identifiers the earlier multi-result
--   version used (1-columns, 4-policies, ...), so a response can be
--   compared with the expectations in docs/LIVE_SECTION2_SCHEMA.md
--   without translating names.
--
-- SAFETY
--   * Catalog metadata only: pg_catalog / information_schema. No
--     user table is named in a FROM clause, so no user row, contact
--     value, message body, payment amount or secret can be returned.
--   * ONE statement, and it is a SELECT: no INSERT/UPDATE/DELETE/DDL,
--     no SET, no DO block. Nothing to run in a particular order.
--   * Missing objects are not an error: existence is reported as a
--     boolean and every other section simply returns [].
--   * Repeat-safe: takes no locks beyond catalog reads.
--
-- WHAT IT SETTLES (the facts the two pending migrations need)
--   A. Do section2_responses / section2_chat_progress exist with the
--      columns each stage names? (owner already reported these two;
--      re-captured so the record is reproducible)
--   B. Does ANY object carry the paid Connect pair — connect_unlocks
--      or another table with buyer/seller or a contact snapshot?
--      The owner's earlier name search (names containing
--      unlock/payment/match) returned match_behavior, match_history,
--      match_interactions, match_queue, match_signals, matches,
--      payment_prompts and payments — connect_unlocks was NOT in that
--      list. Section "0b-connect-candidates" answers this from the
--      catalog instead of guessing: it matches by name AND by column
--      shape, in every non-system schema.
--   C. Live RLS, policy expressions, table and column grants.
--   D. get_unlocked_contacts / get_match_contact / users_are_paired /
--      complete_connect_unlock bodies, signatures and ACLs, plus ANY
--      function whose BODY touches a contact token (a reveal path that
--      is not named after one). The owner's 2026-10-22 search for
--      %unlocked_contact% / %match_contact% returned no rows while
--      src/pages/Chat.jsx and MatchDetail.jsx call
--      rpc('get_unlocked_contacts') — "7-functions" empty is the proof
--      of that, "7c-contact-function-bodies" is what finds the real
--      path if it goes by another name.
--   E. Full trigger inventory on the Section 2, user, payment and
--      connect tables, plus any contact/reveal trigger elsewhere.
--   F. payment_intents / payments constraints (purpose, status) AND
--      their columns — payments.match_id + payments.unlock_status are
--      owner-reported, so "1-columns"/"2-constraints" must show whether
--      match_id is a foreign key to matches(id) and which status values
--      a Connect payment can carry.
--   G. Roles, auth.uid(), users.share_* columns, matches.status.
--   H. Who may read the contact columns: "9b-users-access" returns the
--      users RLS flag, every users policy, table grants and the column
--      grants mentioning phone/whatsapp/email/social/share. If
--      authenticated can select those columns under a permissive
--      policy, that — not a reveal function — is the real exposure.
-- ============================================================

with
-- Objects whose mere existence gates a migration stage.
present as (
  select jsonb_object_agg(t.name, to_regclass('public.' || t.name) is not null) as v
  from unnest(array[
    'section2_responses', 'section2_chat_progress', 'connect_unlocks',
    'payment_intents', 'payments', 'payment_prompts',
    'match_history', 'matches', 'match_queue', 'match_signals',
    'match_interactions', 'match_behavior', 'user_blocks', 'users',
    'conversations'
  ]) as t(name)
),
-- 1. Columns of the tables a Section 2 stage reads or writes.
primary_columns as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'column', a.attname,
           'type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid)
         ) order by c.relname, a.attnum), '[]'::jsonb) as v
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname in ('section2_responses', 'section2_chat_progress',
                      'connect_unlocks', 'payment_intents', 'payments')
),
-- 1b. Partner tables the D2 helper reads — Stage 0 asserts these.
partner_columns as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'column', a.attname,
           'type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid)
         ) order by c.relname, a.attnum), '[]'::jsonb) as v
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname in ('match_history', 'matches', 'user_blocks')
),
-- 1b. matches.status labels when it is an enum (otherwise the CHECK
--     is in "2-constraints").
matches_status as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'enum_type', t.typname, 'label', e.enumlabel, 'order', e.enumsortorder
         ) order by e.enumsortorder), '[]'::jsonb) as v
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  join pg_enum e on e.enumtypid = t.oid
  where n.nspname = 'public' and c.relname = 'matches' and a.attname = 'status'
),
-- 0b. Anything that could be the paid Connect pair. Two independent
--     probes so an unexpected name cannot hide the relationship:
--     name shape, and column shape (buyer/seller/payment link or a
--     contact snapshot column) in any non-system schema.
connect_candidates as (
  select coalesce(jsonb_agg(x order by x->>'schema', x->>'table'), '[]'::jsonb) as v
  from (
    select distinct jsonb_build_object(
             'schema', n.nspname,
             'table', c.relname,
             'matched_on', 'name',
             'columns', (select coalesce(jsonb_agg(a.attname order by a.attnum), '[]'::jsonb)
                         from pg_attribute a
                         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
           ) as x
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and c.relname ~* '(unlock|connect|contact|reveal|purchase)'
    union
    select distinct jsonb_build_object(
             'schema', n.nspname,
             'table', c.relname,
             'matched_on', 'columns:' || string_agg(distinct a.attname, ',' order by a.attname),
             'columns', (select coalesce(jsonb_agg(b.attname order by b.attnum), '[]'::jsonb)
                         from pg_attribute b
                         where b.attrelid = c.oid and b.attnum > 0 and not b.attisdropped)
           ) as x
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and a.attname in ('buyer_id', 'seller_id', 'payment_intent_id',
                        'match_id', 'whatsapp_number', 'social_instagram')
      and c.relname <> 'users'
    group by n.nspname, c.relname, c.oid
  ) s
),
-- 2. Keys and checks on the tables the migrations write or read.
constraints as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'name', con.conname,
           'kind', con.contype,
           'definition', pg_get_constraintdef(con.oid)
         ) order by c.relname, con.conname), '[]'::jsonb) as v
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('section2_responses', 'section2_chat_progress',
                      'connect_unlocks', 'payment_intents', 'payments', 'matches')
),
indexes as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', tablename, 'index', indexname, 'definition', indexdef
         ) order by tablename, indexname), '[]'::jsonb) as v
  from pg_indexes
  where schemaname = 'public'
    and tablename in ('section2_responses', 'section2_chat_progress',
                      'connect_unlocks', 'payment_intents', 'payments')
),
-- 3. RLS status for every table in scope.
rls as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'rls_enabled', c.relrowsecurity,
           'rls_forced', c.relforcerowsecurity
         ) order by c.relname), '[]'::jsonb) as v
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('section2_responses', 'section2_chat_progress',
                      'connect_unlocks', 'payment_intents', 'payments')
),
-- 4. Every live policy on the tables in scope, exact expressions.
policies as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', tablename, 'policy', policyname, 'permissive', permissive,
           'roles', roles, 'command', cmd, 'using', qual, 'with_check', with_check
         ) order by tablename, policyname), '[]'::jsonb) as v
  from pg_policies
  where schemaname = 'public'
    and tablename in ('section2_responses', 'section2_chat_progress',
                      'connect_unlocks', 'payment_intents', 'payments')
),
-- 5. Table privileges, then column privileges (which do not appear in
--    role_table_grants and would otherwise be invisible).
grants_table as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', table_name, 'grantee', grantee, 'privilege', privilege_type
         ) order by table_name, grantee, privilege_type), '[]'::jsonb) as v
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('section2_responses', 'section2_chat_progress',
                       'connect_unlocks', 'payment_intents', 'payments')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
),
grants_column as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', table_name, 'column', column_name,
           'grantee', grantee, 'privilege', privilege_type
         ) order by table_name, grantee, column_name, privilege_type), '[]'::jsonb) as v
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name in ('section2_responses', 'section2_chat_progress',
                       'connect_unlocks', 'payment_intents', 'payments')
    and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
),
-- 6. Function-level EXECUTE privileges for the reveal surface. A null
--    proacl is materialized through acldefault() so the implicit
--    PUBLIC EXECUTE — the thing that makes a function callable by anon
--    — is visible rather than absent.
function_grants as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'arguments', pg_get_function_identity_arguments(p.oid),
           'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
           'privilege', a.privilege_type
         ) order by p.proname, 3, 4), '[]'::jsonb) as v
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname = 'public'
    and p.proname in ('get_unlocked_contacts', 'get_match_contact', 'users_are_paired',
                      'complete_connect_unlock', 'enforce_contacts_unlocked',
                      'handle_contact_reveal', 'pin_section2_contacts_flag',
                      'is_section2_partner')
),
-- 7. Signatures, return types, settings and full source. A missing
--    function simply produces no row.
functions as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'arguments', pg_get_function_identity_arguments(p.oid),
           'returns', pg_get_function_result(p.oid),
           'security_definer', p.prosecdef,
           'settings', p.proconfig,
           'definition', pg_get_functiondef(p.oid)
         ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) as v
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_unlocked_contacts', 'get_match_contact', 'users_are_paired',
                      'complete_connect_unlock', 'enforce_contacts_unlocked',
                      'handle_contact_reveal', 'pin_section2_contacts_flag',
                      'is_section2_partner')
),
-- Any other function that could be a second reveal path.
function_overloads as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'arguments', pg_get_function_identity_arguments(p.oid),
           'returns', pg_get_function_result(p.oid)
         ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) as v
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname ~* '(contact|unlock|reveal|paired)'
),
-- 7c. The reveal path does not have to be named after it. The owner's
--     search for %unlocked_contact% / %match_contact% returned no rows
--     while the app calls get_unlocked_contacts, so the name probes
--     above are not enough on their own: search the BODIES for the
--     contact tokens instead. This is what answers "how is contact
--     access actually controlled" when the function is called
--     something else (or when there is no function at all and users
--     is simply readable).
contact_function_bodies as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', p.proname,
           'arguments', pg_get_function_identity_arguments(p.oid),
           'returns', pg_get_function_result(p.oid),
           'security_definer', p.prosecdef,
           'settings', p.proconfig,
           'definition', pg_get_functiondef(p.oid)
         ) order by p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) as v
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    -- prokind 'f' = plain function: pg_get_functiondef() raises
    -- "array_agg is an aggregate function" if an aggregate reaches it.
    and p.prokind = 'f'
    and p.proname not in ('get_unlocked_contacts', 'get_match_contact', 'users_are_paired',
                          'complete_connect_unlock', 'enforce_contacts_unlocked',
                          'handle_contact_reveal', 'pin_section2_contacts_flag',
                          'is_section2_partner')
    and (pg_get_functiondef(p.oid) ~*
         '(share_(phone|whatsapp|email|social)|whatsapp|phone_number|contact_(details|info|columns)|unlock|notif)'
         or p.prorettype in (select t.oid
                             from pg_type t
                             join pg_class c on c.oid = t.typrelid
                             join pg_namespace cn on cn.oid = c.relnamespace
                             where cn.nspname = 'public' and c.relname = 'users'))
),
-- 8. Every trigger on section2_chat_progress — the table the
--    question-count reveal was attached to.
triggers as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'trigger', t.tgname,
           'function', p.proname,
           'enabled', t.tgenabled,
           'definition', pg_get_triggerdef(t.oid)
         ) order by t.tgname), '[]'::jsonb) as v
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and c.relname = 'section2_chat_progress'
    and not t.tgisinternal
),
-- 8b. Contact-related triggers elsewhere: no second attachment point.
contact_triggers as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'trigger', t.tgname,
           'function', p.proname,
           'enabled', t.tgenabled,
           'definition', pg_get_triggerdef(t.oid)
         ) order by c.relname, t.tgname), '[]'::jsonb) as v
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public'
    and not t.tgisinternal
    and (
      c.relname in ('connect_unlocks', 'users', 'section2_responses',
                    'payments', 'payment_intents')
      or p.proname ~* '(contact|reveal|unlock)'
    )
),
-- 9. Contact-sharing flags on public.users (names and defaults only).
share_columns as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'column', a.attname,
           'type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid)
         ) order by a.attname), '[]'::jsonb) as v
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname = 'users'
    and a.attname like 'share\_%'
),
-- 9b. Who can read the contact columns. The owner reports the details
--     live in public.users, so the reveal question is also a grant
--     question: if authenticated can select users.phone/whatsapp_number
--     under a permissive policy, no reveal function matters. Captures
--     RLS, every users policy, table grants and the column grants that
--     mention a contact or share column.
users_access as (
  select jsonb_build_object(
           'rls_enabled', (select c.relrowsecurity from pg_class c
                           join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relname = 'users'),
           'policies', coalesce((select jsonb_agg(jsonb_build_object(
                                  'policy', policyname, 'permissive', permissive,
                                  'roles', roles, 'command', cmd,
                                  'using', qual, 'with_check', with_check)
                                order by policyname)
                              from pg_policies
                              where schemaname = 'public' and tablename = 'users'), '[]'::jsonb),
           'all_policies_count', (select count(*) from pg_policies
                                  where schemaname = 'public' and tablename = 'users'),
           'table_grants', coalesce((select jsonb_agg(jsonb_build_object(
                                     'grantee', grantee, 'privilege', privilege_type)
                                   order by grantee, privilege_type)
                                 from information_schema.role_table_grants
                                 where table_schema = 'public' and table_name = 'users'
                                   and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), '[]'::jsonb),
           'contact_column_grants', coalesce((select jsonb_agg(jsonb_build_object(
                                               'column', column_name, 'grantee', grantee,
                                               'privilege', privilege_type)
                                             order by column_name, grantee, privilege_type)
                                           from information_schema.column_privileges
                                           where table_schema = 'public' and table_name = 'users'
                                             and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
                                             and column_name ~* '(phone|whatsapp|email|social|share)'), '[]'::jsonb)
         ) as v
),
-- 10. Payment purpose / status checks, isolated so they are easy to
--     read next to the Connect relationship question.
payment_checks as (
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'name', con.conname,
           'definition', pg_get_constraintdef(con.oid)
         ) order by c.relname, con.conname), '[]'::jsonb) as v
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('payment_intents', 'payments')
    and con.contype = 'c'
),
-- 11. Platform preconditions.
platform as (
  select jsonb_build_object(
           'roles', coalesce((select jsonb_agg(rolname order by rolname)
                              from pg_roles
                              where rolname in ('anon', 'authenticated', 'service_role')), '[]'::jsonb),
           'auth_uid_present', to_regprocedure('auth.uid()') is not null,
           'server_version', current_setting('server_version')
         ) as v
)
select jsonb_pretty(jsonb_build_object(
  'captured_at_utc', now(),
  '0-tables-present', (select v from present),
  '0b-connect-candidates', (select v from connect_candidates),
  '1-columns', (select v from primary_columns),
  '1b-partner-columns', (select v from partner_columns),
  '1b-matches-status-enum', (select v from matches_status),
  '2-constraints', (select v from constraints),
  '2-indexes', (select v from indexes),
  '3-rls-status', (select v from rls),
  '4-policies', (select v from policies),
  '5-table-grants', (select v from grants_table),
  '5-column-grants', (select v from grants_column),
  '6-function-grants', (select v from function_grants),
  '7-functions', (select v from functions),
  '7b-function-overloads', (select v from function_overloads),
  '7c-contact-function-bodies', (select v from contact_function_bodies),
  '8-triggers', (select v from triggers),
  '8b-contact-triggers', (select v from contact_triggers),
  '9-share-columns', (select v from share_columns),
  '9b-users-access', (select v from users_access),
  '10-payment-constraints', (select v from payment_checks),
  '11-platform', (select v from platform)
)) as section2_capture;
