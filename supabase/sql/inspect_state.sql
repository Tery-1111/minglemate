-- ============================================================
-- INSPECT STATE — one read-only statement that reports what is
-- ACTUALLY in the live database.
-- Paste the WHOLE file into Supabase Dashboard -> SQL Editor and run.
--
-- Sections (filterable, ordered):
--   01 OVERVIEW    which tables/views this app queries exist, and their RLS shape
--   02 COLUMNS     the real columns of every one of those tables
--   03 REQUIRED    the columns the app code requires: present / absent / mistyped
--   04 POLICIES    every RLS policy on public + storage.objects
--   05 TRIGGERS    every trigger on public + auth.users + storage.objects
--   06 FUNCTIONS   every public function, its SECURITY/grants, plus missing RPCs
--   07 SCRIPTS     whether the single schema entrypoint is APPLIED, plus the
--                   retired scripts kept under supabase/sql/superseded/
--   08 CRON        whether a cron job runs the matcher, and what else is scheduled
--   09 RLS GAPS    tables with RLS off, and tables with RLS on but no policy
--
-- READ-ONLY. It is a single SELECT: it creates nothing, alters nothing, and
-- is therefore safe to re-run any number of times. It is deliberately ONE
-- statement so that every SQL client — including editors that only render a
-- single result grid — shows the complete report.
--
-- Every row is (section, item, detail, status). To see only what needs work:
--
--   select * from (
--     << paste the query below (everything after WITH) >>
--   ) r
--   where status in ('MISSING','NOT APPLIED','PARTIAL','WARN');
--
-- Statuses: ok | MISSING | WARN | NOT APPLIED | PARTIAL | APPLIED | INFO
--
-- What APPLIED means here: every object a script is responsible for is
-- present in the database — NOT that the script's text ran without error.
-- Those differ where a script is skipped or aborts on a statement whose end
-- state another script already provides.
--
-- Notes on how it stays safe on a database that is only partly built:
--   * Absent objects are reported, never assumed: every check is a catalog
--     lookup, so a table that does not exist yet is a MISSING row rather
--     than an error.
--   * cron.job is read through query_to_xml() so that pg_cron being
--     absent (or the cron schema not being readable) yields "not
--     installed" rows instead of failing the whole report.
--   * No object name is ever interpolated into SQL text: only
--     query_to_xml() contains a query string and it is a constant.
-- ============================================================

with

-- ------------------------------------------------------------
-- What the app expects to exist.
-- Sources: every .from('x') in src/ and supabase/functions/, every table/view
-- referenced by supabase/migrations/*.sql (now a single file, the chain) and by
-- the helper scripts in supabase/sql/.
--
-- Every object the chain owns is tagged with the chain's filename, so
-- 07 SCRIPTS answers one question for the whole schema: is that one file
-- applied? The files under supabase/sql/superseded/ are NOT applied and are
-- deliberately absent from these inventories — anything they used to provide
-- is tagged to the chain, which now provides it.
-- ------------------------------------------------------------
expected_tables(tbl, kind) as (values
  ('public.users',                   'table'),
  ('public.user_responses',          'table'),
  ('public.photos',                  'table'),
  ('public.matches',                 'table'),
  ('public.match_history',           'table'),
  ('public.messages',                'table'),
  ('public.conversations',           'table'),
  ('public.connect_unlocks',         'table'),
  ('public.section2_chat_progress',  'table'),
  ('public.section2_responses',      'table'),
  ('public.user_blocks',             'table'),
  ('public.reports',                 'table'),
  ('public.campuses',                'table'),
  ('public.admin_users',             'table'),
  ('public.admin_audit_log',         'table'),
  ('public.app_settings',            'table'),
  ('public.notifications',           'table'),
  ('public.engagement_metrics',      'table'),
  ('public.payment_intents',         'table'),
  ('public.token_purchases',         'table'),
  ('public.processed_payment_callbacks', 'table'),
  ('public.profiles_public',         'view'),
  ('public.payment_intent_anomalies','view')
),

-- ------------------------------------------------------------
-- Columns the app code requires, tagged with the script that
-- provides them. want_type is only set where a WRONG type is a
-- known failure mode (otherwise any type is accepted).
-- script is null for columns required by the app itself.
-- ------------------------------------------------------------
required_columns(tbl, col, want_type, script) as (values
  -- core app columns
  ('public.users', 'id',    'uuid',    null),
  ('public.users', 'email', 'text',    null),
  ('public.users', 'full_name', null,  null),
  ('public.users', 'phone', null,      null),
  ('public.users', 'whatsapp_number', null, null),
  ('public.users', 'section2_unlocked', 'boolean', null),
  ('public.users', 'section2_free_expires_at', null, null),
  ('public.users', 'share_phone',    null, null),
  ('public.users', 'share_whatsapp', null, null),
  ('public.users', 'share_email',    null, null),
  ('public.users', 'notifications_enabled', null, null),
  ('public.user_responses', 'user_id', null, null),
  ('public.user_responses', 'question_number', null, null),
  ('public.photos', 'user_id', null, null),
  ('public.photos', 'photo_url', null, null),
  ('public.photos', 'photo_type', null, null),
  ('public.photos', 'slot', null, null),
  ('public.matches', 'user_a_id', null, null),
  ('public.matches', 'user_b_id', null, null),
  ('public.matches', 'status', null, null),
  ('public.matches', 'created_at', null, null),
  ('public.match_history', 'user_a_id', null, null),
  ('public.match_history', 'user_b_id', null, null),
  ('public.messages', 'sender_id', null, null),
  ('public.messages', 'recipient_id', null, null),
  ('public.messages', 'content', null, null),
  ('public.messages', 'is_bot', null, null),
  ('public.conversations', 'user_a_id', null, null),
  ('public.conversations', 'user_b_id', null, null),
  ('public.conversations', 'status', null, null),
  ('public.section2_chat_progress', 'user_id_a', null, null),
  ('public.section2_chat_progress', 'user_id_b', null, null),
  ('public.section2_chat_progress', 'questions_discussed', null, null),
  ('public.section2_chat_progress', 'contacts_unlocked', null, null),
  ('public.reports', 'reporter_id', null, null),
  ('public.reports', 'reported_id', null, null),
  ('public.reports', 'reason', null, null),
  ('public.user_blocks', 'blocker_id', null, null),
  ('public.user_blocks', 'blocked_id', null, null),
  ('public.payment_intents', 'user_id', null, null),
  ('public.payment_intents', 'amount', null, null),
  ('public.payment_intents', 'status', null, null),
  ('public.payment_intents', 'checkout_request_id', null, null),
  ('public.payment_intents', 'mpesa_transaction_id', null, null),
  ('public.payment_intents', 'created_at', null, null),
  ('public.app_settings', 'maintenance_message', null, null),
  ('public.campuses', 'name', null, null),
  ('public.campuses', 'email_domain', null, null),

  -- chain, share-toggles stage
  ('public.users', 'share_social_instagram', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'share_social_x',         null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'share_social_tiktok',    null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'social_instagram',       null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'social_x',               null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'social_tiktok',          null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'phone',             null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'whatsapp_number',   null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'email',             null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'social_instagram',  null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'social_x',          null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'social_tiktok',     null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, entitlement stage
  ('public.users', 'section2_unlocked', 'boolean', '20261014150000_consolidated_schema_chain.sql'),

  -- chain, answers-column fix — integer[] here breaks every answer insert (22P02)
  ('public.user_responses', 'responses_array', 'text[]', '20261014150000_consolidated_schema_chain.sql'),

  -- the chat timestamp the rate-limit trigger counts by (the chain's resilience
  -- stage carries the corrected trigger; the column is what the app's writes need)
  ('public.messages', 'sent_at', 'timestamp with time zone', null),

  -- chain, product-flow stage
  ('public.matches', 'tier',       null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'created_by', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'buyer_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'seller_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'tier', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'amount', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks', 'payment_intent_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.conversations', 'match_tier', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.conversations', 'locked_at', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, matches-shape stage — the legacy weekly shape, retained
  ('public.matches', 'compatibility_score', 'integer', '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'is_visible', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'compatibility_drivers', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'explanation', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'success_probability', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'last_interaction_at', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'interested_at', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches', 'discarded_at', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, base stage (payment_intents, token_purchases)
  ('public.payment_intents', 'status', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'checkout_request_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'mpesa_transaction_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.token_purchases', 'mpesa_transaction_id', null, '20261014150000_consolidated_schema_chain.sql'),

  -- public.profiles_public — the app's read path (Chat, ForceConnect,
  -- MatchCelebration, MatchDetail select exactly these).
  ('public.profiles_public', 'id', null, null),
  ('public.profiles_public', 'full_name', null, null),
  ('public.profiles_public', 'age', null, null),
  ('public.profiles_public', 'bio', null, null),
  ('public.profiles_public', 'interests', null, null),
  ('public.profiles_public', 'section2_unlocked', null, null),
  ('public.profiles_public', 'section2_free_expires_at', null, null),

  -- profiles_public is defined ONCE by the chain (it used to be three
  -- competing copies whose column lists differed, which Postgres cannot
  -- reconcile — it refuses to drop columns from an existing view). The
  -- surviving definition keeps the prompt columns and has NO display_phone,
  -- and that absence is required, not tolerated: display_phone holds the
  -- user's "email to share with a match" and must never be world-readable. A
  -- view that grows a display_phone column is a privacy regression — 04
  -- POLICIES and the column grant in 02 COLUMNS are where it surfaces.
  ('public.profiles_public', 'profile_prompts', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.profiles_public', 'looking_for', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, admin stage
  ('public.admin_users', 'user_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.admin_audit_log', 'created_at', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, account-settings stage
  ('public.users', 'profile_prompts', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.users', 'notifications_enabled', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, resilience stage
  ('public.payment_intents', 'callback_key', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.processed_payment_callbacks', 'cache_key', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.app_settings', 'maintenance_message', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.app_settings', 'updated_by', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, payment stage
  ('public.payment_intents', 'expires_at', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'purpose', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'recipient_user_id', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'status_reason', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'ticket_state', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'unlock_state', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'unlock_applied_at', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'unlock_error', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'late_callback_at', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'verification_state', null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents', 'verification_detail', null, '20261014150000_consolidated_schema_chain.sql'),

  -- chain, the scheduled ops tick: the alert record and the two columns that say
  -- whether the alert actually reached anyone
  ('public.ops_alerts', 'kind',           null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.ops_alerts', 'dedupe_key',     null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.ops_alerts', 'body',           null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.ops_alerts', 'delivered_at',   null, '20261014150000_consolidated_schema_chain.sql'),
  ('public.ops_alerts', 'delivery_error', null, '20261014150000_consolidated_schema_chain.sql')
),

-- ------------------------------------------------------------
-- Functions the app calls (client RPCs + edge-function paths).
-- ------------------------------------------------------------
required_functions(fn, script) as (values
  -- called directly from src/
  ('discover_candidates',     null),
  ('get_unlocked_contacts',   null),
  ('my_profile',              null),
  ('unmatch_conversation',    null),
  ('request_account_deletion',null),
  ('am_i_admin',              null),
  ('admin_overview',          null),
  ('admin_users_list',        null),
  ('admin_user_detail',       null),
  ('admin_matches_list',      null),
  ('admin_reports_list',      null),
  ('admin_add_campus',        null),
  ('admin_set_campus_active', null),
  ('admin_set_campus_matching', null),

  ('handle_new_user',                 '20261014150000_consolidated_schema_chain.sql'),
  ('get_match_contact',               '20261014150000_consolidated_schema_chain.sql'),
  ('my_profile',                      '20261014150000_consolidated_schema_chain.sql'),
  ('request_account_deletion',        '20261014150000_consolidated_schema_chain.sql'),
  ('users_are_paired',                '20261014150000_consolidated_schema_chain.sql'),
  ('complete_connect_unlock',         '20261014150000_consolidated_schema_chain.sql'),
  ('complete_force_connect',          '20261014150000_consolidated_schema_chain.sql'),
  ('discover_candidates',             '20261014150000_consolidated_schema_chain.sql'),
  ('get_unlocked_contacts',           '20261014150000_consolidated_schema_chain.sql'),
  ('unmatch_conversation',            '20261014150000_consolidated_schema_chain.sql'),
  ('is_admin',                        '20261014150000_consolidated_schema_chain.sql'),
  ('admin_overview',                  '20261014150000_consolidated_schema_chain.sql'),
  ('admin_users_list',                '20261014150000_consolidated_schema_chain.sql'),
  ('admin_user_detail',               '20261014150000_consolidated_schema_chain.sql'),
  ('admin_matches_list',              '20261014150000_consolidated_schema_chain.sql'),
  ('admin_add_campus',                '20261014150000_consolidated_schema_chain.sql'),
  ('admin_set_campus_active',         '20261014150000_consolidated_schema_chain.sql'),
  ('admin_set_campus_matching',       '20261014150000_consolidated_schema_chain.sql'),
  ('enforce_contacts_unlocked',       '20261014150000_consolidated_schema_chain.sql'),
  ('enforce_message_rate_limit',      '20261014150000_consolidated_schema_chain.sql'),
  ('enforce_intent_rate_limit',       '20261014150000_consolidated_schema_chain.sql'),
  ('admin_set_maintenance_message',   '20261014150000_consolidated_schema_chain.sql'),
  ('admin_reports_list',              '20261014150000_consolidated_schema_chain.sql'),
  -- The entitlement evidence machinery: the writer's way to state a reason, the
  -- one recorder, and the raiser the scheduled tick calls.
  ('set_entitlement_context',         '20261014150000_consolidated_schema_chain.sql'),
  ('record_entitlement_evidence',     '20261014150000_consolidated_schema_chain.sql'),
  ('raise_entitlement_anomaly_alerts','20261014150000_consolidated_schema_chain.sql'),
  ('clamp_user_protected_columns',    '20261014150000_consolidated_schema_chain.sql'),
  ('handle_new_user',                 '20261014150000_consolidated_schema_chain.sql'),
  ('complete_connect_unlock',         '20261014150000_consolidated_schema_chain.sql'),
  ('get_unlocked_contacts',           '20261014150000_consolidated_schema_chain.sql'),
  ('expire_stale_payment_intents',    '20261014150000_consolidated_schema_chain.sql'),
  ('payment_intent_window',           '20261014150000_consolidated_schema_chain.sql'),
  ('payment_intent_expiry_state',     '20261014150000_consolidated_schema_chain.sql'),
  -- the scheduled tick, its alert rule and its delivery step
  ('payment_ops_tick',                '20261014150000_consolidated_schema_chain.sql'),
  ('raise_payment_anomaly_alerts',    '20261014150000_consolidated_schema_chain.sql'),
  ('dispatch_ops_alerts',             '20261014150000_consolidated_schema_chain.sql')
),

-- ------------------------------------------------------------
-- Policies the app depends on. tbl is schema-qualified because
-- storage.objects policies are part of the same expectation.
-- ------------------------------------------------------------
required_policies(tbl, pol, script) as (values
  ('public.users',                  'users_select_authenticated',       '20261014150000_consolidated_schema_chain.sql'),
  ('public.users',                  'users_insert_own',                 '20261014150000_consolidated_schema_chain.sql'),
  ('public.users',                  'users_update_own',                 '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_responses',         'responses_select_own',             '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_responses',         'responses_insert_own',             '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_responses',         'responses_update_own',             '20261014150000_consolidated_schema_chain.sql'),
  ('public.messages',               'messages_select_participants',     '20261014150000_consolidated_schema_chain.sql'),
  ('public.messages',               'messages_insert_own_sender',       '20261014150000_consolidated_schema_chain.sql'),
  ('public.section2_chat_progress', 'progress_select_participants',     '20261014150000_consolidated_schema_chain.sql'),
  ('public.section2_chat_progress', 'progress_insert_participants',     '20261014150000_consolidated_schema_chain.sql'),
  ('public.section2_chat_progress', 'progress_update_participants',     '20261014150000_consolidated_schema_chain.sql'),
  ('public.conversations',          'conversations_select_participant', '20261014150000_consolidated_schema_chain.sql'),
  ('public.matches',                'matches_select_participant',       '20261014150000_consolidated_schema_chain.sql'),
  ('public.reports',                'reports_insert_own',               '20261014150000_consolidated_schema_chain.sql'),
  ('public.reports',                'reports_select_own',               '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks',        'unlock_select_buyer',              '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_blocks',            'blocks_select_involved',           '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_blocks',            'blocks_insert_own',                '20261014150000_consolidated_schema_chain.sql'),
  ('public.user_blocks',            'blocks_delete_own',                '20261014150000_consolidated_schema_chain.sql'),
  -- NOT an expectation: no file in this repository creates a policy on
  -- public.campuses. admin_role.sql only SUGGESTS one in a closing comment
  -- ("campuses table itself should also get RLS if it has none (clients
  -- currently write it directly)"), and the chain preserves that comment as a
  -- note. Expecting it here made the verdict wrong: the entrypoint could never
  -- report APPLIED because it was being held responsible for a policy nothing
  -- creates. Whatever the live RLS state of campuses is, section 09 RLS GAPS
  -- reports it — RLS off is a WARN, RLS on with no policy is an INFO.
  ('public.app_settings',           'app_settings_public_read',         '20261014150000_consolidated_schema_chain.sql'),
  ('storage.objects',               'profile_photos_public_read',       '20261014150000_consolidated_schema_chain.sql'),
  ('storage.objects',               'profile_photos_owner_insert',      '20261014150000_consolidated_schema_chain.sql'),
  ('storage.objects',               'profile_photos_owner_update',      '20261014150000_consolidated_schema_chain.sql'),
  ('storage.objects',               'profile_photos_owner_delete',      '20261014150000_consolidated_schema_chain.sql')
),

-- ------------------------------------------------------------
-- Triggers the app depends on.
-- ------------------------------------------------------------
required_triggers(tbl, trg, script) as (values
  ('auth.users',                    'on_auth_user_created',             '20261014150000_consolidated_schema_chain.sql'),
  ('auth.users',                    'on_auth_user_created',             '20261014150000_consolidated_schema_chain.sql'),
  ('public.users',                  'clamp_user_protected_columns',     '20261014150000_consolidated_schema_chain.sql'),
  ('public.section2_chat_progress', 'trg_contacts_unlocked',            '20261014150000_consolidated_schema_chain.sql'),
  ('public.messages',               'messages_rate_limit',              '20261014150000_consolidated_schema_chain.sql'),
  ('public.payment_intents',        'intents_rate_limit',               '20261014150000_consolidated_schema_chain.sql'),
  -- Every grant path carries the recorder. public.campuses is NOT listed: the
  -- chain does not create that table, so its recorder is installed only when the
  -- table exists and section 10 reports that case instead of failing the
  -- verdict for a table the chain never owned.
  ('public.users',                  'entitlement_evidence_users',          '20261014150000_consolidated_schema_chain.sql'),
  ('public.section2_chat_progress', 'entitlement_evidence_section2_chat_progress', '20261014150000_consolidated_schema_chain.sql'),
  ('public.connect_unlocks',        'entitlement_evidence_connect_unlocks','20261014150000_consolidated_schema_chain.sql'),
  ('public.matches',                'entitlement_evidence_matches',        '20261014150000_consolidated_schema_chain.sql'),
  ('public.admin_users',            'entitlement_evidence_admin_users',    '20261014150000_consolidated_schema_chain.sql'),
  ('public.app_settings',           'entitlement_evidence_app_settings',   '20261014150000_consolidated_schema_chain.sql')
),

-- Triggers that must NOT exist — each one is a confirmed defect.
required_absent(tbl, trg, script, why) as (values
  ('public.messages', 'trg_auto_bot_question', '20261014150000_consolidated_schema_chain.sql',
   'its function queries section2_chat_progress.match_week_id, a column that does not exist: every message INSERT fails with 42703 until this trigger is dropped')
),

-- Function bodies that must read a particular column. Some fix scripts repair a
-- function rather than create an object, so existence alone cannot see them.
required_bodies(script, fn, need, forbid, why) as (values
  ('20261014150000_consolidated_schema_chain.sql', 'enforce_message_rate_limit', 'sent_at', 'created_at',
   'the rate-limit trigger must count messages by sent_at; while it reads created_at — a column messages does not have — every message INSERT fails with 42703'),
  ('20261014150000_consolidated_schema_chain.sql', 'expire_stale_payment_intents', 'payment_intent_expiry_state', 'expires_at',
   'the sweep must ask the shared verdict instead of comparing expires_at itself — a sweep carrying its own timestamp comparison is exactly the second copy of the window rule that payment_intent_expiry_state exists to prevent'),
  ('20261014150000_consolidated_schema_chain.sql', 'payment_intent_window', '30 minutes', null,
   'the window must be written down in this one function and nowhere else, so the column default, the backfill and every verdict keep agreeing; an empty body silently removes the window instead of failing loudly')
),

-- ------------------------------------------------------------
-- Live catalog state.
-- ------------------------------------------------------------
rel as (
  select n.nspname || '.' || c.relname as key,
         c.relkind, c.relrowsecurity, c.oid,
         n.nspname as sch, c.relname as tbl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public') and c.relkind in ('r','p','v','m','f')
),
col as (
  select r.key as tbl_key,
         r.tbl,
         a.attname,
         a.attnum,
         format_type(a.atttypid, a.atttypmod) as typ,
         a.attnotnull,
         pg_get_expr(d.adbin, d.adrelid) as dflt
  from pg_attribute a
  join rel r on r.oid = a.attrelid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
),
pol as (
  select p.schemaname || '.' || p.tablename as tbl_key,
         p.schemaname || '.' || p.tablename || '.' || p.policyname as key,
         p.tablename, p.policyname, p.permissive, p.roles::text as roles,
         p.cmd, coalesce(p.qual, '-') as qual,
         coalesce(p.with_check, '-') as with_check
  from pg_policies p
  where p.schemaname in ('public','storage')
),
trg as (
  select n.nspname || '.' || c.relname as tbl_key,
         n.nspname || '.' || c.relname || '.' || t.tgname as key,
         n.nspname as sch, c.relname as tbl, t.tgname, pr.proname,
         case when (t.tgtype & 2) > 0 then 'BEFORE'
              when (t.tgtype & 64) > 0 then 'INSTEAD OF'
              else 'AFTER' end as timing,
         concat_ws(',',
           case when (t.tgtype & 4) > 0 then 'INSERT' end,
           case when (t.tgtype & 8) > 0 then 'DELETE' end,
           case when (t.tgtype & 16) > 0 then 'UPDATE' end,
           case when (t.tgtype & 32) > 0 then 'TRUNCATE' end) as events,
         ((t.tgtype & 1) > 0) as for_each_row
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc pr on pr.oid = t.tgfoid
  where not t.tgisinternal and n.nspname in ('public','auth','storage')
),
fn as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,
         coalesce(p.proconfig::text, '') as proconfig,
         p.prosrc,
         p.oid,
         case when exists (select 1 from pg_roles where rolname = 'anon')
              then has_function_privilege('anon', p.oid, 'EXECUTE')::text else 'no-role' end as anon_can,
         case when exists (select 1 from pg_roles where rolname = 'authenticated')
              then has_function_privilege('authenticated', p.oid, 'EXECUTE')::text else 'no-role' end as auth_can,
         case when exists (select 1 from pg_roles where rolname = 'service_role')
              then has_function_privilege('service_role', p.oid, 'EXECUTE')::text else 'no-role' end as service_can
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),

-- ------------------------------------------------------------
-- Per-script requirements, reduced to one row per object.
-- ------------------------------------------------------------
script_objects as (
  select rc.script, 'column' as kind, rc.tbl as obj_tbl, rc.col as obj_name,
         exists (
           select 1 from col c
           where c.tbl_key = rc.tbl
             and c.attname = rc.col
             and (rc.want_type is null or c.typ = rc.want_type)
         ) as present
  from required_columns rc where rc.script is not null
  union all
  select rf.script, 'function', null::text, rf.fn,
         exists (select 1 from fn f where f.proname = rf.fn)
  from required_functions rf where rf.script is not null
  union all
  select rp.script, 'policy', rp.tbl, rp.pol,
         exists (select 1 from pol p where p.key = rp.tbl || '.' || rp.pol)
  from required_policies rp where rp.script is not null
  union all
  select rt.script, 'trigger', rt.tbl, rt.trg,
         exists (select 1 from trg t where t.key = rt.tbl || '.' || rt.trg)
  from required_triggers rt where rt.script is not null
  union all
  -- satisfied by the trigger being ABSENT
  select ra.script, 'absent trigger', ra.tbl, ra.trg,
         not exists (select 1 from trg t where t.key = ra.tbl || '.' || ra.trg)
  from required_absent ra
  union all
  select rb.script, 'function body', null::text, rb.fn,
         exists (select 1 from fn f
                  where f.proname = rb.fn
                    and f.prosrc ilike '%' || rb.need || '%'
                    and (rb.forbid is null or f.prosrc not ilike '%' || rb.forbid || '%'))
  from required_bodies rb
),
script_state as (
  select script,
         count(*) as want,
         count(*) filter (where present) as have,
         string_agg(kind || ' ' || coalesce(obj_tbl || '.', '') || obj_name, ', ' order by kind, obj_name)
           filter (where not present) as missing
  from script_objects
  group by script
),

-- ------------------------------------------------------------
-- cron.job, read indirectly so a missing pg_cron cannot break the report.
-- ------------------------------------------------------------
cron_doc as (
  -- query_to_xml returns a FOREST of <row> elements, which xpath() cannot read
  -- (it needs one document), so the forest is wrapped in a synthetic root.
  select case when to_regclass('cron.job') is null then null
              else ('<jobset>' || query_to_xml('select * from cron.job order by jobid', false, true, '')::text || '</jobset>')::xml
         end as doc
),
cron_jobs as (
  -- NOTE: xpath() evaluates a relative path against the DOCUMENT node, so
  -- xpath('jobid/text()', <row node>) silently returns nothing. Every path
  -- here is therefore absolute and indexed by row number. A column that an
  -- older pg_cron does not have (jobname since 1.3) simply indexes out of
  -- range and falls back to its default, which is why this reads `select *`.
  select coalesce((xpath('//row/jobid/text()',    d.doc))[r.n]::text, '?')         as jobid,
         coalesce((xpath('//row/jobname/text()',  d.doc))[r.n]::text, '(unnamed)') as jobname,
         coalesce((xpath('//row/schedule/text()', d.doc))[r.n]::text, '?')         as schedule,
         coalesce((xpath('//row/active/text()',   d.doc))[r.n]::text, '?')         as active,
         coalesce((xpath('//row/command/text()',  d.doc))[r.n]::text, '?')         as command
  from cron_doc d
  cross join generate_series(1, cardinality(xpath('//row', d.doc))) as r(n)
),
cron_summary as (
  select
    (select count(*) from pg_extension e where e.extname = 'pg_cron') as ext_installed,
    (to_regclass('cron.job') is not null) as job_table_visible,
    (select count(*) from cron_jobs) as total_jobs,
    (select count(*) from cron_jobs
      where command ilike '%match-generator%' or command ilike '%match_generator%'
         or command ilike '%run-weekly-matching%') as matcher_jobs,
    (select count(*) from cron_jobs
      where command ilike '%run-weekly-matching%') as retired_jobs,
    -- The one schedule this repository DOES create.
    (select count(*) from cron_jobs
      where command ilike '%payment_ops_tick%') as ops_jobs
),
-- ops_alerts is read through query_to_xml for the same reason cron.job is: the
-- report must run on a database where the chain has not been applied yet, and a
-- plain reference to a missing table would fail the whole statement.
ops_alert_state as (
  select
    to_regclass('public.ops_alerts') is not null as present,
    (xpath('//row/undelivered/text()',  d.doc))[1]::text::int as undelivered,
    (xpath('//row/abandoned/text()',    d.doc))[1]::text::int as abandoned,
    (xpath('//row/unconfirmed/text()',  d.doc))[1]::text::int as unconfirmed,
    (xpath('//row/last_error/text()',   d.doc))[1]::text as last_error
  from (
    select case when to_regclass('public.ops_alerts') is null then null
                else ('<r>' || query_to_xml($q$
                  select
                    count(*) filter (where delivered_at is null)::int as undelivered,
                    count(*) filter (where delivered_at is null and dispatch_attempts >= 5)::int as abandoned,
                    count(*) filter (where delivered_at is null and net_request_id is not null
                                       and dispatched_at < now() - interval '15 minutes')::int as unconfirmed,
                    (select delivery_error from public.ops_alerts
                      where delivered_at is null order by created_at desc limit 1) as last_error
                  from public.ops_alerts
                $q$, false, true, '')::text || '</r>')::xml
           end as doc
  ) d
),

-- ------------------------------------------------------------
-- The entitlement ledger and its verdict. Same guarded read as cron.job and
-- ops_alerts: this report has to run on a database where the chain has not been
-- applied yet, so nothing here may reference a missing relation directly.
-- ------------------------------------------------------------
entitlement_doc as (
  select case
    when to_regclass('public.entitlement_evidence_anomalies') is null then null
    else ('<r>' || query_to_xml($q$
      select anomaly,
             count(*)::int as n,
             (array_agg(subject_table || ' ' || subject_id order by subject_id))[1] as first_subject
      from public.entitlement_evidence_anomalies
      group by anomaly
      order by anomaly
    $q$, false, true, '')::text || '</r>')::xml
  end as doc
),
entitlement_anomaly_rows as (
  select coalesce((xpath('//row/anomaly/text()', d.doc))[r.n]::text, '?') as anomaly,
         coalesce((xpath('//row/n/text()', d.doc))[r.n]::text, '0')::int as n,
         coalesce((xpath('//row/first_subject/text()', d.doc))[r.n]::text, '?') as first_subject
  from entitlement_doc d
  cross join generate_series(1, cardinality(xpath('//row', d.doc))) as r(n)
),
entitlement_summary as (
  select
    (to_regclass('public.entitlement_grants') is not null) as ledger_present,
    (to_regclass('public.entitlement_evidence_anomalies') is not null) as verdict_present,
    (xpath('//row/total/text()', d.doc))[1]::text::int as total,
    (xpath('//row/unexplained/text()', d.doc))[1]::text::int as unexplained,
    (xpath('//row/paid_unexplained/text()', d.doc))[1]::text::int as paid_unexplained,
    (xpath('//row/kinds/text()', d.doc))[1]::text as kinds,
    (xpath('//row/last/text()', d.doc))[1]::text as last_grant,
    (select count(*) from trg t where t.tgname like 'entitlement_evidence%') as recorders,
    (to_regclass('public.campuses') is not null) as campuses_present,
    (select count(*) from trg t where t.tgname = 'entitlement_evidence_campuses') as campus_recorder
  from (
    select case when to_regclass('public.entitlement_grants') is null then null
                else ('<r>' || query_to_xml($q$
                  select count(*)::int as total,
                         count(*) filter (where reason_source = 'none')::int as unexplained,
                         count(*) filter (where reason_source = 'none'
                           and kind in ('section2_unlock_paid','connection_unlock_paid','qrashe_match_paid'))::int
                           as paid_unexplained,
                         (select count(distinct kind)::text from public.entitlement_grants) as kinds,
                         (select kind || ' on ' || subject_table || ' (' || actor_role || ')'
                            from public.entitlement_grants order by created_at desc limit 1) as last
                  from public.entitlement_grants
                $q$, false, true, '')::text || '</r>')::xml
           end as doc
  ) d
)

-- ============================================================
-- THE REPORT
-- ============================================================

-- 01 OVERVIEW --------------------------------------------------
select '01 OVERVIEW' as section, e.tbl as item,
       e.kind || case when r.oid is null then ' — NOT PRESENT'
                     else ' [' || case r.relkind
                            when 'r' then 'table' when 'p' then 'partitioned table'
                            when 'v' then 'view' when 'm' then 'materialized view'
                            else r.relkind::text end || ']'
                          || ' cols=' || (select count(*) from col c where c.tbl_key = e.tbl)
                          || ' rls=' || case when r.relrowsecurity then 'ON' else 'OFF' end
                          || ' policies=' || (select count(*) from pol p where p.tbl_key = e.tbl)
                          || ' triggers=' || (select count(*) from trg t where t.tbl_key = e.tbl) end
       as detail,
       case when r.oid is null then 'MISSING'
            when e.kind <> 'view' and r.relkind in ('v','m') then 'WARN'
            when e.kind = 'view'  and r.relkind in ('r','p') then 'WARN'
            else 'ok' end as status
from expected_tables e left join rel r on r.key = e.tbl

-- 02 COLUMNS ---------------------------------------------------
union all
select '02 COLUMNS', c.tbl_key || '.' || c.attname,
       c.typ
       || case when c.attnotnull then ' NOT NULL' else '' end
       || case when c.dflt is not null then ' default ' || c.dflt else '' end
       || case when exists (select 1 from required_columns rc
                            where rc.tbl = c.tbl_key and rc.col = c.attname)
               then '  <- referenced by app code' else '' end,
       'INFO'
from col c
where exists (select 1 from expected_tables e where e.tbl = c.tbl_key)

-- 03 REQUIRED COLUMNS -----------------------------------------
union all
select '03 REQUIRED COLUMNS', rc.tbl || '.' || rc.col,
       case when c.attname is null
              then 'ABSENT — required' || coalesce(' as ' || rc.want_type, '')
                   || ' by ' || rc.scripts
            when rc.want_type is not null and c.typ <> rc.want_type
              then 'WRONG TYPE — is ' || c.typ || ', app requires ' || rc.want_type
                   || ' (' || rc.scripts || ')'
            else c.typ || ' — satisfies ' || rc.scripts end,
       case when c.attname is null then 'MISSING'
            when rc.want_type is not null and c.typ <> rc.want_type then 'WARN'
            else 'ok' end
from (
  select tbl, col, max(want_type) as want_type,
         string_agg(distinct coalesce(script, 'app code'), ', ' order by coalesce(script, 'app code')) as scripts
  from required_columns group by tbl, col
) rc
left join col c on c.tbl_key = rc.tbl and c.attname = rc.col

-- 04 POLICIES -------------------------------------------------
union all
select '04 POLICIES', p.tbl_key || ': ' || p.policyname,
       p.cmd || ' to ' || p.roles
       || ' using=' || p.qual
       || case when p.with_check <> '-' then ' with check=' || p.with_check else '' end
       || case when p.permissive <> 'PERMISSIVE' then ' [' || p.permissive || ']' else '' end,
       'INFO'
from pol p
union all
select '04 POLICIES', rp.tbl || ': ' || rp.pol, 'ABSENT — required by ' || rp.script, 'MISSING'
from required_policies rp
where not exists (select 1 from pol p where p.key = rp.tbl || '.' || rp.pol)

-- 05 TRIGGERS -------------------------------------------------
union all
select '05 TRIGGERS', t.tbl_key || ': ' || t.tgname,
       t.timing || ' ' || t.events || case when t.for_each_row then ' for each row' else ' for each statement' end
       || ' -> ' || t.proname || '()' || case when t.sch = 'auth' then '  [auth schema]' else '' end
       || coalesce('  *** ' || ra.why, ''),
       case when ra.trg is not null then 'WARN' else 'INFO' end
from trg t
left join required_absent ra on ra.tbl = t.tbl_key and ra.trg = t.tgname
union all
select '05 TRIGGERS', rt.tbl || ': ' || rt.trg, 'ABSENT — required by ' || rt.script, 'MISSING'
from required_triggers rt
where not exists (select 1 from trg t where t.key = rt.tbl || '.' || rt.trg)

-- 06 FUNCTIONS ------------------------------------------------
union all
select '06 FUNCTIONS', f.proname || '(' || f.args || ')',
       case when f.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
       || case when f.proconfig = '' then ' | search_path NOT pinned' else ' | ' || f.proconfig end
       || ' | execute: anon=' || f.anon_can || ' authenticated=' || f.auth_can
       || ' service_role=' || f.service_can,
       case when f.prosecdef and f.proconfig = '' then 'WARN' else 'INFO' end
from fn f
union all
select '06 FUNCTIONS', x.fn,
       'ABSENT — required by ' || x.scripts, 'MISSING'
from (
  select fn,
         string_agg(distinct coalesce(script, 'app code'), ', ' order by coalesce(script, 'app code')) as scripts
  from required_functions group by fn
) x
where not exists (select 1 from fn f where f.proname = x.fn)

-- 07 SCRIPTS --------------------------------------------------
union all
select '07 SCRIPTS', s.script || '  [' || s.have || '/' || s.want || ' objects]',
       case when s.have = s.want then 'every object this script creates is present'
            when s.have = 0     then 'nothing this script creates is present — it was never applied'
            else 'partly applied; missing: ' || coalesce(s.missing, '?') end,
       case when s.have = s.want then 'APPLIED'
            when s.have = 0     then 'NOT APPLIED'
            else 'PARTIAL' end
from script_state s
union all
select '07 SCRIPTS', so.script || ' — ' || so.kind || ' ' || coalesce(so.obj_tbl || '.', '') || so.obj_name,
       case when so.kind = 'absent trigger'
              then 'PRESENT but must be dropped: ' || coalesce(ra.why, 'confirmed defect')
            when so.kind = 'function body'
              then 'function does not satisfy it: ' || coalesce(rb.why, 'body does not match')
            else 'absent' end,
       case when so.kind = 'absent trigger' then 'WARN' else 'MISSING' end
from script_objects so
left join required_absent ra on ra.script = so.script and ra.trg = so.obj_name
left join required_bodies rb on rb.script = so.script and rb.fn = so.obj_name
where not so.present
union all
select '07 SCRIPTS', 'audit_rls.sql',
       'read-only audit (reports RLS state, changes nothing) — nothing to apply', 'INFO'
union all
select '07 SCRIPTS', 'superseded/ — retired sources (do not apply)',
       'These were applied by hand, in order, to reach this schema; the chain now applies all of '
       || 'them in one file, so nothing of theirs is expected to be missing and none of them is '
       || 'expected to be run again: fix_rls, fix_responses_column, fix_bot_question_trigger, '
       || 'remediation_bundle, account_settings_bundle, product_flow_bundle, harden_profile_reads, '
       || 'harden_resilience, fix_rate_limit_column, reconcile_matches_shape, admin_role, '
       || 'storage_rls, payment_intent_lifecycle, plus the two timestamped migrations. They are kept '
       || 'under supabase/sql/superseded/ for provenance only: running one of them after the chain '
       || 'can re-open a defect the chain closes (for example harden_resilience.sql re-creates '
       || 'enforce_message_rate_limit with the removed messages.created_at column).', 'INFO'
union all
select '07 SCRIPTS', 'seed_test_sessions.sql',
       'STAGING-ONLY data seed (auth.sessions/auth.refresh_tokens for the two liveness test users); '
       || 'not a schema change, so it is not verifiable from the schema — check for rows directly: '
       || 'select count(*) from auth.sessions where user_agent = ''liveness-seed-script'';', 'INFO'

-- 08 CRON -----------------------------------------------------
union all
select '08 CRON', 'pg_cron extension',
       case when c.ext_installed > 0 then 'installed'
            else 'NOT installed — nothing can be scheduled until it is enabled (Dashboard -> Database -> Extensions)' end,
       case when c.ext_installed > 0 then 'ok' else 'WARN' end
from cron_summary c
union all
select '08 CRON', 'cron.job readable',
       case when c.job_table_visible then 'yes'
            else 'no — either pg_cron is not installed or this role cannot read cron.job' end,
       case when c.job_table_visible then 'ok' else 'WARN' end
from cron_summary c
union all
select '08 CRON', 'job ' || j.jobid || ' ' || j.jobname,
       'schedule=' || j.schedule || ' active=' || j.active
       || ' command=' || replace(left(j.command, 300), E'\n', ' '),
       case when j.command ilike '%run-weekly-matching%'
              then 'WARN'  -- retired engine: reads a table nothing writes
            when j.command ilike '%match-generator%' or j.command ilike '%match_generator%'
              then 'ok'
            else 'INFO' end
from cron_jobs j
union all
select '08 CRON', 'DOES A CRON JOB RUN THE MATCHER?',
       case when c.matcher_jobs > 0
              then c.matcher_jobs || ' scheduled job(s) reference the matcher (match-generator / run-weekly-matching)'
            else 'NO. Nothing in this repository schedules the matcher. The one schedule the chain creates '
              || 'is payment-ops-tick (expire stale payment intents + raise and deliver anomaly alerts), '
              || 'which does not run the matcher, and every matcher '
              || 'trigger found in the repo is a manual one (the Admin panel Run Matching button, or a curl). '
              || 'The Admin panel says the per-campus matching_enabled / is_active flags "govern the weekly '
              || 'cron schedule" — so if staging or production does have a weekly run, it was created outside '
              || 'this repository and should be checked against cron.job above.' end,
       case when c.matcher_jobs > 0 then 'ok' else 'WARN' end
from cron_summary c
union all
select '08 CRON', 'retired engine still scheduled',
       case when c.retired_jobs > 0
              then c.retired_jobs || ' job(s) call run-weekly-matching, which was retired: it read '
                   || 'section1_responses, a table nothing writes, so it always produced zero matches. '
                   || 'Unschedule it and delete the deployed function.'
            else 'no' end,
       case when c.retired_jobs > 0 then 'WARN' else 'ok' end
from cron_summary c
union all
select '08 CRON', 'payment-ops-tick schedule (expire + alert)',
       case when not c.job_table_visible
              then 'pg_cron is not installed, so payment_ops_tick never runs: dead pushes never expire '
                   || 'and a stuck unlock only reaches anyone if somebody remembers to look. Enable '
                   || 'pg_cron (Dashboard -> Database -> Extensions), then run: select cron.schedule('''
                   || 'payment-ops-tick'', ''*/5 * * * *'', ''select public.payment_ops_tick()'');'
            when c.ops_jobs = 0
              then 'MISSING — no cron job calls payment_ops_tick(), so nothing expires stale pushes or '
                   || 'alerts on a stuck unlock. Create it with: select cron.schedule('''
                   || 'payment-ops-tick'', ''*/5 * * * *'', ''select public.payment_ops_tick()'');'
            when c.ops_jobs > 1
              then c.ops_jobs || ' jobs call payment_ops_tick() — the same tick is scheduled more than once '
                   || '(every tick is idempotent, but this is not what the chain creates); unschedule the extras'
            else 'scheduled' end,
       case when not c.job_table_visible then 'WARN'
            when c.ops_jobs = 0 then 'MISSING'
            when c.ops_jobs > 1 then 'WARN'
            else 'ok' end
from cron_summary c
union all
select '08 CRON', 'ops alerts actually delivered',
       case when not o.present
              then 'public.ops_alerts does not exist — the chain has not been applied, so there is no alert record '
                   || 'and nothing to deliver'
            when coalesce(o.undelivered, 0) = 0
              then 'every alert raised has been delivered'
            else coalesce(o.undelivered, 0) || ' alert(s) raised but NOT delivered '
                 || '(abandoned after 5 attempts: ' || coalesce(o.abandoned, 0) || ', '
                 || 'dispatched with no webhook answer for over 15 minutes: ' || coalesce(o.unconfirmed, 0) || '. '
                 || 'last error: ' || coalesce(o.last_error, '(none recorded)') || ') — a stuck unlock has '
                 || 'not reached anyone: check the Vault secret OPS_ALERT_WEBHOOK_URL and that the webhook '
                 || 'still accepts this payload'
       end,
       case when not o.present then 'INFO'
            when coalesce(o.undelivered, 0) = 0 then 'ok'
            else 'WARN' end
from ops_alert_state o

-- 09 RLS GAPS -------------------------------------------------
union all
select '09 RLS GAPS', r.key,
       case when not r.relrowsecurity
              then 'RLS is OFF on a table in the public schema — any client with the anon key can read/write it'
            else 'RLS is ON but there is no policy at all: expected for server-only tables '
              || '(payment intents, callback cache, audit log), a silent failure for anything the app reads'
       end,
       case when not r.relrowsecurity then 'WARN' else 'INFO' end
from rel r
where r.relkind in ('r','p')
  and (not r.relrowsecurity
       or not exists (select 1 from pol p where p.tbl_key = r.key))

-- 10 ENTITLEMENTS ---------------------------------------------
-- Does every server-side grant leave a recorded, checkable reason, and is any
-- entitlement currently in a state its evidence does not support? The ledger and
-- the verdict are the stage-6 machinery; this section is where an operator sees
-- whether it is installed, whether it is being used, and what it has found.
union all
select '10 ENTITLEMENTS', 'recorder coverage (every grant path)',
       case when s.recorders = 7
              then 'all seven grant paths record what changed, who changed it, how, and why'
            when s.recorders = 6 and not s.campuses_present
              then 'six of seven: public.campuses does not exist (it is a precondition of the chain, not '
                   || 'created by it), so the campus-flag recorder is not installed and a campus change '
                   || 'made by hand would not be recorded. Re-run the chain once the campus DDL exists.'
            when not s.campuses_present
              then s.recorders || ' of 7 recorder(s) installed, and public.campuses does not exist — '
                   || 're-run the chain to install the rest'
            else s.recorders || ' of 7 recorder(s) installed — re-run the chain; every path is supposed to carry one'
       end,
       case when s.recorders = 7 then 'ok'
            when s.recorders = 6 and not s.campuses_present then 'INFO'
            else 'WARN' end
from entitlement_summary s
union all
select '10 ENTITLEMENTS', 'the ledger itself',
       case when not s.ledger_present
              then 'MISSING — public.entitlement_grants does not exist, so no grant is recorded: an '
                   || 'entitlement can change state with nothing left behind. Re-run the chain.'
            when coalesce(s.total, 0) = 0
              then 'the ledger exists and is empty: no grant has been made since it was installed '
                   || '(a project that predates it has history the ledger does not)'
            else coalesce(s.total, 0) || ' grant(s) recorded across ' || coalesce(s.kinds, '0')
                 || ' kind(s); the most recent: ' || coalesce(s.last_grant, '(unreadable)')
       end,
       case when not s.ledger_present then 'MISSING' else 'ok' end
from entitlement_summary s
union all
select '10 ENTITLEMENTS', 'grants with no stated reason and no evidence',
       case when not s.ledger_present
              then 'not applicable — there is no ledger'
            when coalesce(s.unexplained, 0) = 0
              then 'every recorded grant either states why it happened or names the evidence that justifies it'
            else coalesce(s.unexplained, 0) || ' grant(s) are recorded with no reason and no evidence'
                 || case when coalesce(s.paid_unexplained, 0) > 0
                         then ': ' || s.paid_unexplained || ' of them are PAID entitlements, which is the '
                              || 'case this whole mechanism exists to catch — a payment that bought '
                              || 'nothing, or an unlock nobody can account for'
                         else ' — read them before trusting them; a hand-made change is the usual cause' end
       end,
       case when not s.ledger_present then 'INFO'
            when coalesce(s.unexplained, 0) = 0 then 'ok'
            else 'WARN' end
from entitlement_summary s
union all
select '10 ENTITLEMENTS', 'finding: ' || a.anomaly,
       a.n || ' subject(s), first: ' || a.first_subject
       || case when a.anomaly in ('paid_unlock_without_evidence','paid_grant_without_evidence',
                                  'grant_evidence_unresolvable','chat_unlock_without_questions')
               then ' — raised as CRITICAL on the alert channel'
               else ' — raised as a warning on the alert channel' end,
       'WARN'
from entitlement_anomaly_rows a
union all
select '10 ENTITLEMENTS', 'entitlement findings (none)',
       'nothing is currently in a state its evidence does not support',
       'ok'
from entitlement_summary s
where s.verdict_present
  and not exists (select 1 from entitlement_anomaly_rows)

order by section, item, status;
