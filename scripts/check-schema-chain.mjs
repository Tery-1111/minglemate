// Static check for the consolidated schema chain: every object defined exactly
// once, and none of the defects the chain was built to remove.
//
//   node scripts/check-schema-chain.mjs
//
// The chain replaced a set of bundles that had to be applied in a particular
// order by hand and that declared several objects two or three times
// (payment_intents.callback_key, processed_payment_callbacks,
// enforce_message_rate_limit, the messages and matches policies,
// profiles_public, my_profile, complete_handle... , handle_new_user, the matches
// table and its index, the Section 2 entitlement columns). A later edit that
// pastes one of those duplicates back in — or that reintroduces the buggy
// rate-limit body — is what this catches.
//
// It reads the SQL as text: no database, no dependencies, in the same spirit as
// scripts/verify-payment-ticket.mjs. Behaviour (does it apply in one run, is it
// idempotent, do the policies still behave) is what supabase/sql/inspect_state.sql
// verifies against the live project after you run the chain.

import { readFileSync } from 'node:fs'

const CHAIN = new URL(
  '../supabase/migrations/20261014150000_consolidated_schema_chain.sql',
  import.meta.url
)
const text = readFileSync(CHAIN, 'utf8')
// Counts run on code with line comments stripped: the chain's own notes name the
// objects they replaced, and those names must not count as definitions.
const code = text.replace(/--[^\n]*/g, '')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`); if (detail) console.log(`        ${detail}`) }
}

function counts(haystack, re, group = 1) {
  const out = new Map()
  for (const m of haystack.matchAll(re)) {
    const k = (m[group] || '').replace(/"/g, '').toLowerCase()
    if (!k) continue
    out.set(k, (out.get(k) || 0) + 1)
  }
  return out
}
const dupes = (map) => [...map.entries()].filter(([, n]) => n > 1)

const functions = counts(code, /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi)
const tables = counts(code, /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)
const views = counts(code, /\bcreate\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z0-9_]+)/gi)
const policies = counts(code, /\bcreate\s+policy\s+"?([a-z0-9_ ]+)"?/gi)
const triggers = counts(code, /\bcreate\s+trigger\s+"?([a-z0-9_]+)"?/gi)
const indexes = counts(code, /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)
const columns = counts(code, /\badd\s+column\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi)

// Duplicate adds are keyed by (table, column), not by name alone: the same
// column name legitimately exists on two tables (users.status and
// conversations.status), while adding one column twice to the SAME table is
// the defect this guards against. `columns` above stays name-keyed for the
// specific pins below (callback_key, the entitlement columns).
const columnsByTable = new Map()
for (const stmt of code.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)([^;]*);/gi)) {
  const table = stmt[1].toLowerCase()
  for (const col of stmt[2].matchAll(/\badd\s+column\s+if\s+not\s+exists\s+([a-z0-9_]+)/gi)) {
    const key = `${table}.${col[1].toLowerCase()}`
    columnsByTable.set(key, (columnsByTable.get(key) || 0) + 1)
  }
}
const total = (map) => [...map.values()].reduce((a, b) => a + b, 0)

check('every function is defined exactly once', dupes(functions).length === 0, JSON.stringify(dupes(functions)))
check('every table is created exactly once', dupes(tables).length === 0, JSON.stringify(dupes(tables)))
check('every view is defined exactly once', dupes(views).length === 0, JSON.stringify(dupes(views)))
check('every policy is created exactly once', dupes(policies).length === 0, JSON.stringify(dupes(policies)))
check('every trigger is created exactly once', dupes(triggers).length === 0, JSON.stringify(dupes(triggers)))
check('every index is created exactly once', dupes(indexes).length === 0, JSON.stringify(dupes(indexes)))
// The second condition keeps this honest: if the attribution above stopped
// matching, columnsByTable would be empty and the rule would pass vacuously.
check('no column is added twice, per table',
  dupes(columnsByTable).length === 0 && total(columnsByTable) === total(columns),
  `dupes=${JSON.stringify(dupes(columnsByTable))} byTable=${total(columnsByTable)} byName=${total(columns)}`)

for (const [kind, name] of [
  ['function', 'handle_new_user'], ['function', 'my_profile'], ['function', 'complete_connect_unlock'],
  ['function', 'get_unlocked_contacts'], ['function', 'enforce_message_rate_limit'],
  ['function', 'payment_intent_window'], ['function', 'payment_intent_expiry_state'],
  ['function', 'expire_stale_payment_intents'], ['function', 'clamp_user_protected_columns'],
  ['view', 'profiles_public'], ['view', 'payment_intent_anomalies'],
  ['table', 'matches'], ['table', 'payment_intents'], ['table', 'processed_payment_callbacks'],
  ['table', 'connect_unlocks'], ['table', 'conversations'], ['table', 'user_blocks'],
  ['trigger', 'on_auth_user_created'], ['trigger', 'clamp_user_protected_columns'],
  ['index', 'idx_matches_user_b'],
  ['policy', 'messages_select_participants'], ['policy', 'messages_insert_own_sender'],
  ['policy', 'matches_select_participant']
]) {
  const map = { function: functions, view: views, table: tables, trigger: triggers, index: indexes, policy: policies }[kind]
  check(`${kind} ${name}: exactly one definition`, map.get(name) === 1, `count=${map.get(name) ?? 0}`)
}

check('callback_key added once (was: harden_resilience + payment_intent_lifecycle)',
  columns.get('callback_key') === 1, `count=${columns.get('callback_key') ?? 0}`)
check('the Section 2 entitlement columns are added once, in the base stage',
  columns.get('section2_unlocked') === 1 && columns.get('section2_free_expires_at') === 1,
  `unlocked=${columns.get('section2_unlocked')}, free_expires_at=${columns.get('section2_free_expires_at')}`)
check('the matches table is created in the product-flow stage, before the stages after it',
  code.indexOf('create table if not exists public.matches') > 0 &&
  code.indexOf('create table if not exists public.matches') < text.indexOf('-- STAGE 3'),
  'stage order')
check("product_flow's live policy versions are the ones kept",
  /and c\.status in \('locked','unmatched'\)/.test(code) && /c\.locked_at < now\(\) - interval '7 days'/.test(code),
  'locked/unmatched insert clause and archived-history select clause present')

// Defects and invariants the chain must (not) carry.
check('the buggy rate-limit body is gone (no counting by messages.created_at)',
  !/m\.created_at/.test(code) && /m\.sent_at > now\(\) - interval '1 hour'/.test(code))
check('the 30-minute window is written once', (code.match(/interval '30 minutes'/g) || []).length === 1)
check('only the verdict function compares expires_at',
  (code.match(/[^_]expires_at\s*</g) || []).length === 0,
  `${(code.match(/[^_]expires_at\s*</g) || []).length} stray comparison(s)`)

const grantLists = [...code.matchAll(/grant select \(([^)]*)\) on public\.users/gi)].map((m) => m[1])
check('every users column grant is display_phone-free',
  grantLists.length > 0 && grantLists.every((g) => !/display_phone/.test(g)),
  JSON.stringify(grantLists.map((g) => g.replace(/\s+/g, ' ').trim().slice(0, 60))))
check('the display_phone revoke is present exactly once',
  (code.match(/revoke select \(display_phone\) on public\.users from anon, authenticated;/g) || []).length === 1)

check('every stage banner is present', [1, 2, 3, 4, 5, 6].every((n) => text.includes(`-- STAGE ${n} — `)),
  JSON.stringify([1, 2, 3, 4, 5, 6].filter((n) => !text.includes(`-- STAGE ${n} — `))))
check('the chain says how to apply it and that it is idempotent',
  /supabase db push/.test(text) && /paste this whole file/.test(text) && /Re-running is safe/.test(text))
check('the folded sources are named where their content came from',
  (text.match(/folded from supabase\/sql\/superseded\//g) || []).length >= 10,
  `${(text.match(/folded from supabase\/sql\/superseded\//g) || []).length} provenance banners`)
// The chain must NOT carry the old staging-only directive, because the chain is
// the file that goes to production. Historical mentions are fine and expected:
// the notes explain why the callback key and the idempotency cache moved to the
// payment stage, and that is worth keeping. What must never come back is the
// instruction itself ("STAGING ONLY (ref: ...)", "Do NOT run on production").
check('no staging-only directive survives (history may be mentioned, an instruction may not)',
  !/STAGING ONLY\s*\(ref:/.test(text) && !/Do NOT run on production/.test(text),
  JSON.stringify(text.split('\n').filter((l) => /STAGING ONLY\s*\(ref:|Do NOT run on production/.test(l)).slice(0, 3)))
check('the chain declares its superseded sources retired, provenance only, not to be re-run',
  /RETIRED SOURCES:/.test(text) &&
    /superseded\/ for provenance only/.test(text) &&
    /Do not run them\./.test(text),
  'the header must say what the retired files under supabase/sql/superseded/ are for')

// ---------------------------------------------------------------- the ops tick
// The scheduled alerting path. Each check here pins something that was wrong in
// an earlier draft of it or that a future edit could quietly undo.
const opsStart = text.indexOf('-- I. The scheduled ops tick')
const opsEnd = text.indexOf('-- STAGE 5 — admin')
const opsSection = opsStart >= 0 && opsEnd > opsStart ? text.slice(opsStart, opsEnd) : ''
const opsSql = opsSection.replace(/--[^\n]*/g, '')
const tickBody = opsSql.slice(
  opsSql.indexOf('create or replace function public.payment_ops_tick()'),
  opsSql.indexOf('$$;', opsSql.indexOf('create or replace function public.payment_ops_tick()'))
)

check('the ops tick section is present', opsSection.length > 0)
check('it creates the alert record once',
  (opsSql.match(/create table if not exists public\.ops_alerts/g) || []).length === 1)
check('the alert record is server-only (RLS on, no policies, no client grant)',
  /alter table public\.ops_alerts enable row level security;/.test(opsSql) &&
    /revoke all on public\.ops_alerts from anon, authenticated;/.test(opsSql) &&
    !/create policy[^;]*ops_alerts/i.test(opsSql))
check('undelivered alerts have a partial index, so the scan does not grow forever',
  /create index if not exists ops_alerts_undelivered_idx[\s\S]*?where delivered_at is null;/.test(opsSql))
check('the tick expires first, then raises, then delivers',
  /public\.expire_stale_payment_intents\(\)/.test(tickBody) &&
    /public\.raise_payment_anomaly_alerts\(\)/.test(tickBody) &&
    /public\.dispatch_ops_alerts\(\)/.test(tickBody) &&
    tickBody.indexOf('expire_stale_payment_intents') < tickBody.indexOf('raise_payment_anomaly_alerts') &&
    tickBody.indexOf('raise_payment_anomaly_alerts') < tickBody.indexOf('dispatch_ops_alerts'))
check('the alert rule reads the audit view instead of re-deriving the anomaly',
  /from public\.payment_intent_anomalies a[\s\S]{0,600}?'paid_but_not_unlocked'/.test(opsSql) ||
    /where a\.anomaly = 'paid_but_not_unlocked'/.test(opsSql))
check('stuck is defined with a grace period, so a callback in flight is not an incident',
  /a\.created_at < now\(\) - interval '10 minutes'/.test(opsSql))
check('one alert per problem (dedupe), so a five-minute tick cannot spam the channel',
  /dedupe_key text not null/.test(opsSql) && /unique \(dedupe_key\)/.test(opsSql) &&
    /on conflict \(dedupe_key\) do nothing/.test(opsSql))
check('an alert whose POST is still unanswered is not re-sent (net_request_id is the in-flight handle)',
  /where delivered_at is null[\s\S]{0,80}?and net_request_id is null/.test(opsSql) &&
    /delivered_at = case when x\.status_code between 200 and 299 then now\(\) end/.test(opsSql) &&
    /net_request_id = null[\s\S]{0,200}?from net\._http_response/.test(opsSql))
check('delivery is confirmed, not assumed: the webhook answer is read back',
  /net\._http_response/.test(opsSql) && /webhook rejected the alert: HTTP/.test(opsSql))
check('a rejection keeps its reason (the error is not cleared by the next attempt)',
  !/delivery_error = null/.test(opsSql))
check('retries are bounded, so a dead webhook cannot loop forever',
  /dispatch_attempts < 5/.test(opsSql))
check('every degradation is a guard, not a crash: pg_cron, pg_net and Vault are all optional',
  /to_regclass\('cron\.job'\) is null/.test(opsSql) &&
    /to_regprocedure\('net\.http_post\(text,jsonb,jsonb,jsonb,integer\)'\) is null/.test(opsSql) &&
    /to_regclass\('vault\.decrypted_secrets'\) is not null/.test(opsSql))
check('the channel is a Vault secret, never a URL in this file',
  /OPS_ALERT_WEBHOOK_URL/.test(opsSql) && !/https?:\/\//.test(opsSql))
check('the schedule is idempotent by name and runs every five minutes',
  /cron\.unschedule\('payment-ops-tick'\)/.test(opsSql) &&
    /cron\.schedule\('payment-ops-tick', '\*\/5 \* \* \* \*', 'select public\.payment_ops_tick\(\)'\)/.test(opsSql))
check('the alert body reads like a message a person can act on',
  /minutes ago/.test(opsSql) && /mpesa txn: /.test(opsSql) && /unlock error: /.test(opsSql))
check('the sweep is scheduled exactly once, by the tick, and not advertised twice',
  !/cron\.schedule\('expire-payment-intents'/.test(text) &&
    !/Nothing calls this/.test(text) &&
    /Called by the scheduled tick/.test(text) &&
    // Exactly one real call. The other mention of cron.schedule( in the file is
    // the notice that prints the statement to run when pg_cron is missing —
    // which is prose for the operator, not a second schedule.
    (text.match(/perform cron\.schedule\(/g) || []).length === 1)
check('the ops functions are service-role only',
  ['raise_payment_anomaly_alerts', 'dispatch_ops_alerts', 'payment_ops_tick'].every((fn) =>
    new RegExp(`revoke all on function public\\.${fn}\\(\\) from anon, authenticated, public;`).test(opsSql)))

// ------------------------------------------------- the entitlement ledger
// Stage 6: every server-side grant, not just a payment, leaves a recorded and
// checkable reason. The handlers live in that stage; the tick that surfaces the
// findings is in the payment stage, so both halves are checked here.
const entStart = text.indexOf('-- STAGE 6 — entitlement evidence')
const entSection = entStart >= 0 ? text.slice(entStart) : ''
const entSql = entSection.replace(/--[^\n]*/g, '')

const fnBody = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  if (start < 0) return ''
  return sql.slice(start, sql.indexOf('$$;', start))
}

// Every kind the recorder or a caller can attach to a grant. Each one has to be
// in the registry: an unregistered kind is what the verdict reports as
// 'grant_kind_unregistered', so a new kind without a rule is a finding by design.
const ENTITLEMENT_KINDS = [
  'section2_trial_14d', 'section2_unlock_paid', 'connection_unlock_paid', 'qrashe_match_paid',
  'chat_contacts_unlocked', 'profile_status_pending_deletion',
  'profile_status_paused', 'profile_status_resumed',
  'admin_role_granted', 'admin_role_revoked', 'campus_added', 'campus_flag_changed',
  'maintenance_message_changed', 'user_entitlement_changed'
]

// Every path that can change an entitlement, and the kind it declares. A path
// that stops declaring leaves "no explicit reason recorded" in the ledger —
// recorded, but a warn on the operator's channel — so the reason is pinned here.
const ENTITLEMENT_PATHS = {
  handle_new_user: 'section2_trial_14d',
  request_account_deletion: 'profile_status_pending_deletion',
  complete_connect_unlock: 'connection_unlock_paid',
  complete_force_connect: 'qrashe_match_paid',
  enforce_contacts_unlocked: 'chat_contacts_unlocked',
  admin_set_maintenance_message: 'maintenance_message_changed',
  admin_add_campus: 'campus_added',
  admin_set_campus_active: 'campus_flag_changed',
  admin_set_campus_matching: 'campus_flag_changed'
}

// The tables that carry an entitlement, and the events that can change one.
// campuses is installed conditionally: this chain reads it but never creates it.
const ENTITLEMENT_TABLES = {
  users: 'after insert or update on public.users',
  section2_chat_progress: 'after insert or update on public.section2_chat_progress',
  connect_unlocks: 'after insert on public.connect_unlocks',
  matches: 'after insert on public.matches',
  admin_users: 'after insert or delete on public.admin_users',
  campuses: 'after insert or update on public.campuses',
  app_settings: 'after insert or update on public.app_settings'
}

const entLedgerDdl = entSql.slice(
  entSql.indexOf('create table if not exists public.entitlement_grants'),
  entSql.indexOf('create index if not exists entitlement_grants_subject_idx')
)
const entRecorder = fnBody(entSql, 'record_entitlement_evidence')
const entRegistry = entSql.slice(
  entSql.indexOf('insert into public.entitlement_grant_kinds'),
  entSql.indexOf('on conflict (kind) do update')
)
const entVerdict = entSql.slice(entSql.indexOf('create or replace view public.entitlement_evidence_anomalies'))
const entRaiser = fnBody(entSql, 'raise_entitlement_anomaly_alerts')

check('the entitlement stage is present', entSection.length > 0)
check('the ledger is created once, server-only (RLS on, no policies, no client grant)',
  (entSql.match(/create table if not exists public\.entitlement_grants/g) || []).length === 1 &&
    /alter table public\.entitlement_grants enable row level security;/.test(entSql) &&
    /revoke all on public\.entitlement_grants from anon, authenticated;/.test(entSql) &&
    !/create policy[^;]*entitlement_grants/i.test(entSql),
  'ledger ddl or grants')
check('the ledger says who, how and why — not only what changed',
  /previous_state jsonb/.test(entLedgerDdl) && /reason text not null/.test(entLedgerDdl) &&
    /evidence_table text/.test(entLedgerDdl) && /actor uuid/.test(entLedgerDdl) &&
    /actor_role text not null/.test(entLedgerDdl) && /route text not null/.test(entLedgerDdl),
  entLedgerDdl.replace(/\s+/g, ' ').slice(0, 200))
check('the ledger records where a reason came from, so nothing has to string-match prose',
  /reason_source text not null/.test(entLedgerDdl) &&
    /check \(reason_source in \('declared', 'evidence', 'none'\)\)/.test(entLedgerDdl) &&
    /v_reason_source := 'declared'/.test(entRecorder) &&
    /v_reason_source := 'evidence'/.test(entRecorder) &&
    /v_reason_source := 'none'/.test(entRecorder))
check('recorded is not the same as reasoned: an unexplained trial expiry is still a finding',
  /reason_source = 'declared'/.test(entVerdict) &&
    !/reason = 'no explicit reason recorded'/.test(entVerdict),
  'the verdict must key off reason_source, not off the fallback reason text')
check('the ledger outlives the row it describes (no cascade delete can erase the record)',
  !/references public\./i.test(entLedgerDdl))
check('the ledger has exactly one writer: the recorder trigger',
  (entSql.match(/insert into public\.entitlement_grants/g) || []).length === 1 &&
    /insert into public\.entitlement_grants/.test(entRecorder))
const registered = (k) => entRegistry.includes(`('${k}', 'public.`)
check('every kind the recorder can emit is registered, with a rule for how it is justified',
  ENTITLEMENT_KINDS.every(registered),
  JSON.stringify(ENTITLEMENT_KINDS.filter((k) => !registered(k))))
check('the recorder classifies the paths the database can decide alone',
  ['section2_trial_14d', 'section2_unlock_paid', 'connection_unlock_paid', 'qrashe_match_paid',
    'chat_contacts_unlocked', 'user_entitlement_changed'].every((k) => new RegExp(`'${k}'`).test(entRecorder)),
  JSON.stringify(['section2_trial_14d', 'section2_unlock_paid', 'connection_unlock_paid', 'qrashe_match_paid',
    'chat_contacts_unlocked', 'user_entitlement_changed'].filter((k) => !new RegExp(`'${k}'`).test(entRecorder))))
check('a paid unlock is matched to the intent that paid for it, not to a claim in prose',
  /from public\.payment_intents pi[\s\S]{0,400}?status = 'succeeded'[\s\S]{0,300}?unlock_state, ''\) = 'applied'/.test(entRecorder))
check('one declared reason describes one grant (the recorder consumes its context)',
  /set_config\('app\.entitlement_kind', '', true\)/.test(entRecorder))
check('the recorder is attached to every table that carries an entitlement',
  Object.keys(ENTITLEMENT_TABLES).every((t) => new RegExp(`entitlement_evidence_${t}\\b`).test(entSql)),
  JSON.stringify(Object.keys(ENTITLEMENT_TABLES).filter((t) => !new RegExp(`entitlement_evidence_${t}\\b`).test(entSql))))
check('each attachment fires on the events that can change an entitlement, via the one recorder',
  Object.entries(ENTITLEMENT_TABLES).every(([, ev]) => entSql.includes(ev)) &&
    (entSql.match(/public\.record_entitlement_evidence\(\)/g) || []).length >= 7,
  JSON.stringify(Object.entries(ENTITLEMENT_TABLES).filter(([, ev]) => !entSql.includes(ev)).map(([t]) => t)))
check('every path that grants states its reason before it grants',
  Object.entries(ENTITLEMENT_PATHS).every(([fn, kind]) => {
    const body = fnBody(code, fn)
    return body.includes('set_entitlement_context(') && body.includes(`'${kind}'`)
  }),
  JSON.stringify(Object.entries(ENTITLEMENT_PATHS)
    .filter(([fn, kind]) => {
      const body = fnBody(code, fn)
      return !(body.includes('set_entitlement_context(') && body.includes(`'${kind}'`))
    })
    .map(([fn]) => fn)))
check('the reason setter is a service-role-only server function',
  /revoke all on function public\.set_entitlement_context\(text, text, text, text\) from anon, authenticated, public;/.test(entSql) &&
    /grant execute on function public\.set_entitlement_context\(text, text, text, text\) to service_role;/.test(entSql))
check('a table this chain does not create cannot break the apply: the campus recorder is installed only if campuses exists',
  /to_regclass\('public\.campuses'\) is null/.test(entSql) && /raise notice/.test(entSql))
check('the verdict checks a paid unlock against the intent that paid for it',
  /from public\.payment_intents pi[\s\S]{0,200}?status = 'succeeded'/.test(entVerdict) && /pi\.user_id = u\.id/.test(entVerdict))
check('the verdict checks the trial expiry against signup + 14 days, not against itself',
  /u\.created_at \+ interval '14 days'/.test(entVerdict))
check('the verdict checks the reveal against the question count that grants it',
  /questions_discussed, 0\) < 14/.test(entVerdict))
check('the verdict reports a grant nobody registered and a grant nobody could classify',
  /grant_kind_unregistered/.test(entVerdict) && /grant_unclassified/.test(entVerdict) &&
    /admin_role_unrecorded/.test(entVerdict))
check('the verdict reads through the caller\'s own privileges and is server-only',
  /with \(security_invoker = true\) as/.test(entVerdict) &&
    /revoke all on public\.entitlement_evidence_anomalies from anon, authenticated;/.test(entSql))
check('the findings land on the same channel as a stuck payment, deduped',
  /insert into public\.ops_alerts/.test(entRaiser) && /on conflict \(dedupe_key\) do nothing/.test(entRaiser))
check('the ops tick raises entitlement findings too: after the payment ones, before delivery',
  tickBody.indexOf('raise_entitlement_anomaly_alerts') > tickBody.indexOf('raise_payment_anomaly_alerts') &&
    tickBody.indexOf('raise_entitlement_anomaly_alerts') < tickBody.indexOf('dispatch_ops_alerts'),
  tickBody.replace(/\s+/g, ' ').slice(0, 300))
// Only the callable ones: a trigger function (returns trigger) cannot be invoked
// directly, and the chain does not revoke execute on the trigger functions it
// already had — so this pins the two a client could otherwise reach.
check('the callable entitlement functions are service-role only',
  ['raise_entitlement_anomaly_alerts', 'set_entitlement_context']
    .every((fn) => entSql.includes(`revoke all on function public.${fn}(`)),
  JSON.stringify(['raise_entitlement_anomaly_alerts', 'set_entitlement_context']
    .filter((fn) => !entSql.includes(`revoke all on function public.${fn}(`))))

// --------------------------------------- security regressions (this round)
// Each check below pins a defect that was found by measurement and repaired,
// or a guard that had no static test at all. They are text-level proofs that
// the repair is still in the file — the behavioural half (do the grants really
// refuse, does the clamp really discard) lives in the SQL probes.

// D-1 / P1: the contact reveal must not read anything a client can write. The
// guarded pair is get_unlocked_contacts (the paid snapshot) and
// get_match_contact (the paywall). questions_discussed, section2_unlocked and
// section2_free_expires_at were all readable controls for that reveal once.
const unlockContacts = fnBody(code, 'get_unlocked_contacts')
const matchContact = fnBody(code, 'get_match_contact')
check('the contact reveal is payment-only: no question counter, trial or unlock flag in either RPC',
  unlockContacts.length > 0 && matchContact.length > 0 &&
    [unlockContacts, matchContact].every((b) =>
      !/questions_discussed|section2_free_expires_at|section2_unlocked/.test(b)) &&
    /from public\.connect_unlocks/.test(unlockContacts) &&
    /from public\.connect_unlocks/.test(matchContact),
  'a reveal that reads a client-writable column is the P1 forgery again')
const enforceContacts = fnBody(code, 'enforce_contacts_unlocked')
check('a client write cannot raise contacts_unlocked through the question counter',
  /v_is_client/.test(enforceContacts) &&
    /new\.contacts_unlocked := false/.test(enforceContacts) &&
    /new\.contacts_unlocked := old\.contacts_unlocked/.test(enforceContacts),
  'the trigger must pin the flag for client INSERT and UPDATE')

// Client write grants. created_at is server-owned (`default now()`), and the
// entitlement/lifecycle columns must never appear in an INSERT or UPDATE grant.
// profile_status is deliberately allowed (Settings' pause/resume) and is
// guarded by the clamp instead — see the next check.
const writeGrants = [...code.matchAll(/grant (?:insert|update) \(([^)]*)\) on public\.users/gi)].map((m) => m[1])
check('no client write grant on public.users carries a server-owned column',
  writeGrants.length === 2 && writeGrants.every((g) =>
    !/\b(created_at|section2_unlocked|section2_free_expires_at|reg_number|reputation_score|status|contacts_unlocked)\b/.test(g)),
  JSON.stringify(writeGrants.map((g) => g.replace(/\s+/g, ' ').trim().slice(0, 70))))
const clampBody = fnBody(code, 'clamp_user_protected_columns')
check('the clamp keeps client pause/resume but preserves a server-set pending_deletion',
  /old\.profile_status = 'pending_deletion'/.test(clampBody) &&
    /new\.profile_status := old\.profile_status/.test(clampBody) &&
    !/new\.profile_status := 'active'/.test(clampBody),
  'a client write must not move a queued account back into matching')

// The admin RPCs that returned 42703 / permission denied for the enrolled admin.
const adminOverview = fnBody(code, 'admin_overview')
check('admin_overview does not depend on an undeclared campuses column',
  adminOverview.length > 0 && /order by c\.name/.test(adminOverview) && !/c\.created_at/.test(adminOverview),
  'campuses.created_at is declared by nothing in the repository')
const adminDetail = fnBody(code, 'admin_user_detail')
check('photos.display_order is converged before admin_user_detail reads it',
  /alter table public\.photos add column if not exists display_order integer;/.test(code) &&
    adminDetail.includes('p.display_order'),
  'the function orders photos by it; public.photos is a precondition table')
check('admin_set_maintenance_message is granted to authenticated and guarded inside',
  /grant execute on function public\.admin_set_maintenance_message\(text\) to authenticated;/.test(code) &&
    /public\.is_admin\(\)/.test(fnBody(code, 'admin_set_maintenance_message')),
  'granted like the other admin_* RPCs, authorization enforced in the body')

// D-2i: the storage policies must cover the bucket the app actually uploads to
// (every storage.from() in src/ names `user-photos`), not only profile_photos.
check('storage policies cover user-photos (the bucket src/ uploads to) as well as profile_photos',
  /values \('user-photos', 'user-photos', true\)/.test(code) &&
    /bucket_id = 'user-photos'/.test(code) &&
    /bucket_id = 'profile_photos'/.test(code),
  'a policy on the wrong bucket id is the BOLA gap A01/D-2i describes')

// ------------------------------------------- RLS closure (audit C-15, 2026-10-15)
// photos, notifications, token_purchases and campuses are PRECONDITIONS of the
// chain: it reads them but never brings them under RLS (the campuses enablement
// survives only as a comment at chain:3582), so a client with the anon key can
// read and write rows it does not own. The closure cannot live in the chain
// itself — `supabase db push` never re-runs a migration version already in
// supabase_migrations.schema_migrations, so appending a stage to
// 20261014150000 would be a silent no-op on every project that has run it. It
// ships as its own timestamped migration; this is the guard that keeps that file
// present and complete. Read as text, exactly like the chain.
const RLS_CLOSURE = new URL(
  '../supabase/migrations/20261015120000_rls_closure_precondition_tables.sql',
  import.meta.url
)
let closure = ''
try { closure = readFileSync(RLS_CLOSURE, 'utf8') } catch { /* reported below */ }
const closureCode = closure.replace(/--[^\n]*/g, '')

const REQUIRED_RLS = ['photos', 'notifications', 'token_purchases', 'campuses']
const rlsEnabled = (t) => new RegExp(`alter table public\\.${t} enable row level security`, 'i').test(closureCode)
// Every policy the closure creates: name, table, command.
const closurePolicies = [...closureCode.matchAll(
  /create policy "([a-z0-9_]+)"\s+on public\.([a-z0-9_]+) for (select|insert|update|delete|all)/gi
)].map((m) => ({ name: m[1].toLowerCase(), table: m[2].toLowerCase(), cmd: m[3].toLowerCase() }))

check('the RLS closure migration exists (audit C-15)',
  closure.length > 0,
  'supabase/migrations/20261015120000_rls_closure_precondition_tables.sql is missing')
check('every precondition table is brought under RLS by the closure',
  REQUIRED_RLS.every(rlsEnabled),
  JSON.stringify(REQUIRED_RLS.filter((t) => !rlsEnabled(t))))
check('the legacy permissive policies that let a client forge or read a trusted row are retired',
  /drop policy if exists "System can insert notifications" on public\.notifications/i.test(closureCode) &&
    !closurePolicies.some((p) => p.table === 'notifications' && p.cmd !== 'select'),
  'notifications must keep no insert/update/delete policy — WITH CHECK (true) is the forgery')
check('the closure keeps the reads the product needs',
  ['photos_select_authenticated', 'notifications_select_own', 'campuses_select_authenticated']
    .every((n) => closurePolicies.some((p) => p.name === n && p.cmd === 'select')),
  JSON.stringify(closurePolicies.filter((p) => p.cmd === 'select').map((p) => p.name)))
check('an owner-scoped notification read policy is what keeps the Home.jsx Realtime alert working',
  /create policy "notifications_select_own"[\s\S]{0,200}?using \(user_id = auth\.uid\(\)\)/i.test(closureCode),
  'Realtime applies RLS for the subscriber, so own-row SELECT is the delivery path')
check('photo writes are confined to the owning user',
  ['photos_insert_own', 'photos_update_own', 'photos_delete_own']
    .every((n) => closurePolicies.some((p) => p.name === n && p.cmd !== 'select')) &&
    (closureCode.match(/user_id = auth\.uid\(\)/g) || []).length >= 4,
  JSON.stringify(closurePolicies.filter((p) => /photos_/.test(p.name))))
check('campuses is read-only for clients in the closure (no client write policy)',
  closure.length > 0 && !closurePolicies.some((p) => p.table === 'campuses' && p.cmd !== 'select'))
check('the closure does not hand a client the payment table (RLS on, no policy, client privileges revoked)',
  rlsEnabled('token_purchases') &&
    !closurePolicies.some((p) => p.table === 'token_purchases') &&
    /revoke all on public\.token_purchases from anon, authenticated/i.test(closureCode))
check('client write privileges are revoked, not only filtered by RLS',
  /revoke insert, update, delete on public\.notifications\s+from anon, authenticated/i.test(closureCode) &&
    /revoke insert, update, delete on public\.campuses\s+from anon, authenticated/i.test(closureCode))
check('the closure leaves users.campus_id alone (it needs a product decision)',
  closure.length > 0 && !/campus_id/.test(closureCode) && !/grant (insert|update)[^;]*on public\.users/i.test(closureCode),
  'the campus_id correction changes product behaviour and is out of scope for this security migration')

// ------------------------------------------- photo uniqueness (2026-10-15)
// The photo upsert defect: src/pages/Photos.jsx:112 and
// src/pages/PhotoUpload.jsx:87 both upsert on (user_id, photo_type), and
// PostgREST can only build `on conflict (user_id, photo_type)` from a unique
// constraint or unique index on that pair. public.photos had only photos_pkey,
// so both upserts failed with 42P10 before RLS was consulted — which is why it
// reproduced for the service role too. The fix ships as its own timestamped
// migration for the same reason the closure does: 20261014150000 is already
// recorded in supabase_migrations.schema_migrations everywhere it has run, so a
// stage appended there would never execute. What this section keeps true is
// that the fix stays a schema change: it must look for duplicate pairs before
// it adds anything, must not resolve them itself, and must not touch the
// security layer the closure owns. Read as text, exactly like the chain.
const PHOTO_UNIQUE = new URL(
  '../supabase/migrations/20261015160000_photos_unique_per_user_and_type.sql',
  import.meta.url
)
let photoFix = ''
try { photoFix = readFileSync(PHOTO_UNIQUE, 'utf8') } catch { /* reported below */ }
const photoCode = photoFix.replace(/--[^\n]*/g, '')

const closureVersion = (RLS_CLOSURE.pathname.match(/(\d{14})_/) || [])[1] || ''
const photoVersion = (PHOTO_UNIQUE.pathname.match(/(\d{14})_/) || [])[1] || ''

check('the photo-uniqueness migration exists',
  photoFix.length > 0,
  'supabase/migrations/20261015160000_photos_unique_per_user_and_type.sql is missing')
check('the photo migration sorts after the RLS closure, so a push applies it second',
  closureVersion.length === 14 && photoVersion.length === 14 && photoVersion > closureVersion,
  `${closureVersion} -> ${photoVersion}`)
check('it adds the unique pair the app upserts against',
  /alter\s+table\s+public\.photos\s+add\s+constraint\s+photos_user_id_photo_type_key\s+unique\s*\(\s*user_id\s*,\s*photo_type\s*\)/i.test(photoCode),
  'expected: alter table public.photos add constraint photos_user_id_photo_type_key unique (user_id, photo_type)')
const dupeCheckAt = photoCode.search(/having\s+count\(\*\)\s*>\s*1/i)
const addAt = photoCode.search(/add\s+constraint\s+photos_user_id_photo_type_key/i)
check('it looks for duplicate pairs before it creates the constraint',
  dupeCheckAt > -1 && addAt > -1 && dupeCheckAt < addAt,
  `duplicate check at offset ${dupeCheckAt}, constraint at offset ${addAt}`)
check('duplicates stop the migration with the offending pairs named',
  /raise\s+exception\s+'public\.photos holds duplicate/i.test(photoCode) &&
    /string_agg\(format\(/i.test(photoCode),
  'a bare 23505 from add constraint would not say which pairs are ambiguous, nor that nothing was changed')
check('it never resolves duplicates itself: no delete, update, insert or truncate statement',
  !/\bdelete\s+from\b|\binsert\s+into\b|\bupdate\s+public\s*\.|\btruncate\b/i.test(photoCode),
  'deciding which of two photos of the same person survives is a product decision')
check('it stays out of the security layer the closure owns',
  !/row\s+level\s+security|create\s+policy|drop\s+policy|\bgrant\b|\brevoke\b/i.test(photoCode),
  'this migration adds a constraint; policies and privileges are the closure\'s business')
check('it is re-runnable: a second run finds the constraint and stops',
  /from\s+pg_constraint/i.test(photoCode) && /pg_indexes/i.test(photoCode) &&
    /already exists/i.test(photoCode),
  'every other file in supabase/migrations is idempotent, and this one is applied by hand too')
check('it does nothing on a project where the precondition table is absent',
  /to_regclass\('public\.photos'\)\s+is\s+null/i.test(photoCode),
  'photos is a precondition of the chain, so it may legitimately not exist')

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
