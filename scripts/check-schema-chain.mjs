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

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
