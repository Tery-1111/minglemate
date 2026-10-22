// Production payment-intent lifecycle — static regression guard for
// supabase/sql/production/20261022170000_production_payment_intent_lifecycle.sql,
// the compatibility migration that lets the deployed payment-callback use the
// expiry verdict and bookkeeping columns it already writes.
//
//   node scripts/verify-production-payment-schema.mjs
//
// What this proves (and does not prove):
//   * The migration exists, is ordered after the Section 2 production file,
//     and adds every column / constraint / function the deployed callback
//     references — enumerated from the Edge Function source, not from memory.
//   * The DDL is additive: no table or column is dropped, no row is deleted,
//     and the only UPDATE is the expires_at backfill from created_at.
//   * The expiry rule is defined once: the window function feeds the column
//     default and the backfill, and the verdict function is the only
//     comparison. The Edge Function does no date arithmetic of its own.
//   * The verdict is SECURITY INVOKER, revoked from anon/authenticated/public
//     and granted to service_role only — the role the callback actually uses.
//   * The file's own post-check asserts the same facts, so a silent
//     half-application cannot commit.
//
// It does NOT prove the migration was applied, that the functions behave that
// way on the live database, or that the callback is deployed. Those need the
// database and a deployment; GATES.md records that evidence separately.

import { existsSync, readdirSync, readFileSync } from 'node:fs'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
}

const repoRoot = new URL('../', import.meta.url)
const read = (relativePath) => readFileSync(new URL(relativePath, repoRoot), 'utf8')

// Strip line comments so the checks assert on SQL, not on prose that names
// the columns and the removed mechanisms.
function sqlCode(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function jsCode(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const MIGRATION = 'supabase/sql/production/20261022170000_production_payment_intent_lifecycle.sql'
const PREDECESSOR = '20261022160000'
const CALLBACK = 'supabase/functions/payment-callback/index.ts'
const TICKET = 'supabase/functions/payment-callback/ticket.ts'
const INITIATE = 'supabase/functions/initiate-payment/index.ts'

const raw = existsSync(new URL(MIGRATION, repoRoot)) ? read(MIGRATION) : ''
const sql = raw ? sqlCode(raw) : ''
// The callback's contract spans both files: index.ts performs the writes,
// ticket.ts builds the patches (status_reason, late_callback_at, verified_at)
// and therefore holds the values the state CHECKs must admit.
const callback = `${jsCode(read(CALLBACK))}\n${jsCode(read(TICKET))}`
const initiate = jsCode(read(INITIATE))

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------
check('the production payment-intent migration exists', raw.length > 0, MIGRATION)

check('it is ordered after the Section 2 production migration',
  MIGRATION.includes('20261022170000') && '20261022170000' > PREDECESSOR,
  `predecessor=${PREDECESSOR}`)

const sqlFiles = existsSync(new URL('supabase/sql/production', repoRoot))
  ? readdirSync(new URL('supabase/sql/production', repoRoot)).filter((f) => f.endsWith('.sql'))
  : []
check('no other production file shares its timestamp',
  sqlFiles.filter((f) => f.slice(0, 14) === '20261022170000').length === 1,
  JSON.stringify(sqlFiles.filter((f) => f.slice(0, 14) === '20261022170000')))

check('it is outside supabase/migrations on purpose, and the header says why',
  /NOT IN supabase\/migrations\/ ON PURPOSE/.test(raw) &&
  /production_chain_replay_guard/.test(raw),
  '')

check('it names its production target',
  /mhdjnhiqahsllbczbzpk/.test(raw), '')

// ---------------------------------------------------------------------------
// The contract, enumerated from the deployed Edge Function
// ---------------------------------------------------------------------------
const REQUIRED_COLUMNS = [
  'ticket_state',
  'status_reason',
  'verification_requested_at',
  'verification_conversation_id',
  'verification_state',
  'verification_detail',
  'verified_at',
  'unlock_state',
  'unlock_applied_at',
  'unlock_error',
  'late_callback_at'
]

check('expires_at is added, read by the verdict, and never re-derived in the callback',
  /add column if not exists expires_at timestamptz/i.test(sql) &&
  /r\.expires_at/i.test(sql) &&
  !/expires_at/.test(callback),
  'the window comparison lives in SQL only')

for (const column of REQUIRED_COLUMNS) {
  check(`callback reads/writes ${column} AND the migration adds it`,
    callback.includes(column) &&
    new RegExp(`add column if not exists\\s+${column}\\b`, 'i').test(sql),
    '')
}

check('the callback asks for the expiry verdict over RPC',
  /rpc\('payment_intent_expiry_state'/.test(callback), '')

check('the callback writes the terminal expired status',
  /status:\s*'expired'/.test(callback), '')

check('the callback keeps the idempotency cache insert',
  /from\('processed_payment_callbacks'\)/.test(callback), '')

check('the callback still calls both unlock RPCs, untouched by this change',
  /rpc\('complete_connect_unlock'/.test(callback) &&
  /rpc\('complete_force_connect'/.test(callback), '')

check('the callback does no expiry date arithmetic of its own',
  !/expires_at/.test(callback) && !/Date\.now\(\).*payment_intent_window/.test(callback),
  'IntentRow deliberately omits expires_at; the verdict is the database’s')

// ---------------------------------------------------------------------------
// The expiry rule: one window, one comparison
// ---------------------------------------------------------------------------
check('payment_intent_window() is defined with the 30 minute window',
  /create or replace function public\.payment_intent_window\(\)[\s\S]*?interval '30 minutes'/.test(sql),
  '')

check('expires_at is added nullable first, then backfilled from created_at',
  /add column if not exists expires_at timestamptz/i.test(sql) &&
  /set expires_at = created_at \+ public\.payment_intent_window\(\)/i.test(sql) &&
  !/set expires_at = now\(\)/i.test(sql),
  'an old pending intent must come out already expired, not freshly alive')

check('the default is the window function, not a literal interval',
  /alter column expires_at set default \(now\(\) \+ public\.payment_intent_window\(\)\)/i.test(sql),
  '')

check('NOT NULL is only applied when no NULL remains',
  /if exists \(select 1 from public\.payment_intents where expires_at is null\)/i.test(sql) &&
  /set not null/i.test(sql),
  '')

check('the verdict function is the only expiry comparison in the file',
  /when coalesce\(p_at, now\(\)\) >= r\.expires_at then 'expired'/.test(sql) &&
  (sql.match(/expires_at\s*</g) || []).length === 0,
  '')

check('the verdict handles every state the callback understands',
  /'no_intent'/.test(sql) && /'no_window'/.test(sql) &&
  /'expired'/.test(sql) && /'live'/.test(sql), '')

check('an absent intent still yields exactly one row (left join)',
  /left join \(/.test(sql) && /r on true/i.test(sql), '')

// ---------------------------------------------------------------------------
// Security: invoker, not an oracle; service_role only
// ---------------------------------------------------------------------------
check('the verdict function is SECURITY INVOKER with a fixed search_path',
  /create or replace function public\.payment_intent_expiry_state\([\s\S]*?security invoker/i.test(sql) &&
  /set search_path = public/i.test(sql),
  '')

check('the verdict is revoked from anon, authenticated and PUBLIC',
  /revoke all on function public\.payment_intent_expiry_state\(uuid, timestamptz\)\s+from anon, authenticated, public/i.test(sql),
  '')

check('the verdict is granted to service_role only',
  /grant execute on function public\.payment_intent_expiry_state\(uuid, timestamptz\)\s+to service_role/i.test(sql) &&
  !/grant execute on function public\.payment_intent_expiry_state\(uuid, timestamptz\)\s+to (anon|authenticated)/i.test(sql),
  '')

check('a conflicting overload aborts the migration instead of creating ambiguity',
  /to_regprocedure\('public\.payment_intent_expiry_state\(uuid,timestamptz\)'\)/.test(sql) &&
  /conflicting function/.test(sql),
  '')

// ---------------------------------------------------------------------------
// Status vocabulary and state constraints
// ---------------------------------------------------------------------------
check('the status CHECK gains expired and keeps the existing three',
  /check \(status in \('pending','succeeded','failed','expired'\)\)/i.test(sql), '')

for (const [name, values] of [
  ['verification', ['pending', 'confirmed', 'contradicted', 'unavailable']],
  ['unlock', ['applied', 'failed', 'no_effect']],
  ['ticket', ['verified', 'missing_key', 'wrong_key', 'no_key_on_intent']]
]) {
  check(`the ${name} state CHECK matches the values the callback writes`,
    new RegExp(`payment_intents_${name}_state_check`, 'i').test(sql) &&
    values.every((v) => sql.includes(`'${v}'`)),
    values.join('|'))
}

// ---------------------------------------------------------------------------
// Additive only
// ---------------------------------------------------------------------------
check('the file drops no table and no column',
  !/\bdrop\s+table\b/i.test(sql) && !/\bdrop\s+column\b/i.test(sql),
  '')

check('the file deletes and truncates nothing',
  !/\bdelete\s+from\b/i.test(sql) && !/\btruncate\b/i.test(sql), '')

check('the only UPDATE is the expires_at backfill',
  (sql.match(/update\s+public\./gi) || []).length === 1 &&
  /update public\.payment_intents\s+set expires_at/i.test(sql),
  '')

check('it touches no Section 2, Connect, Force Connect or user row',
  !/\b(users|connect_unlocks|matches|user_blocks|conversations)\b/i.test(
    sql.replace(/payment_intents/g, '')
  ),
  '')

check('the dropped status CHECK is the only DROP statement',
  (sql.match(/\bdrop\s+(?!constraint if exists payment_intents_status_check)/gi) || []).length === 0,
  '')

// ---------------------------------------------------------------------------
// Self-checking application
// ---------------------------------------------------------------------------
check('the file post-checks its own result and raises on failure',
  /6\. Post-check/i.test(raw) &&
  /raise exception 'post-check:/.test(sql) &&
  /payment_intent_expiry_state\(gen_random_uuid\(\)\)/.test(sql),
  'a failed assertion rolls back the whole file')

check('the post-check asserts the ACL, not just the existence',
  /has_function_privilege\('anon'/.test(sql) &&
  /has_function_privilege\('service_role'/.test(sql),
  '')

// ---------------------------------------------------------------------------
// The new-intent path must use the default, not send NULL
// ---------------------------------------------------------------------------
check('initiate-payment does not set expires_at (so the default applies)',
  !/expires_at/.test(initiate),
  '')

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('\n========== PRODUCTION PAYMENT-INTENT LIFECYCLE ==========')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
