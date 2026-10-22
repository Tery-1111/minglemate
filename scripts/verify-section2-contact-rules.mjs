// Section 2 contact rules — static regression guard for owner decisions
// D1–D5 (docs/OWNER_DECISIONS_SECTION2_CONTACTS.md).
//
//   node scripts/verify-section2-contact-rules.mjs
//
// What this proves (and does not prove):
//   * The migration that implements D1–D5 exists, is later than the last
//     migration that predates it, removes the question-count contact reveal,
//     drops get_match_contact after revoking it, and describes Section 2
//     access without any payment / entitlement / unlock / expiry column.
//   * get_unlocked_contacts requires BOTH a connect_unlocks row for this
//     buyer/seller AND the owner's live share_* flag, per channel.
//   * The three match-display screens and Payment carry no Section 2 gate,
//     initiate-payment refuses new section2 purchases, and payment-callback
//     still settles old ones.
//
// It does NOT prove the migration was applied, that RLS behaves as written on
// the live database, or that the Edge Functions are deployed. Those need a
// database and a deployment, which this script deliberately does not touch.

import { existsSync, readdirSync, readFileSync } from 'node:fs'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
}

const repoRoot = new URL('../', import.meta.url)
const read = (relativePath) => readFileSync(new URL(relativePath, repoRoot), 'utf8')

// Comment lines are removed so the checks assert on code, not on prose that
// deliberately names the mechanism being removed.
function code(relativePath) {
  return read(relativePath)
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return (
        !t.startsWith('//') &&
        !t.startsWith('*') &&
        !t.startsWith('/*') &&
        !t.startsWith('--')
      )
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// The migration itself
// ---------------------------------------------------------------------------
const MIGRATION = 'supabase/migrations/20261021120000_section2_free_access_and_contacts.sql'
const LAST_PREDATING_MIGRATION = '20261019190000'

check('the Section 2 migration exists', existsSync(new URL(MIGRATION, repoRoot)), MIGRATION)

const migrationRaw = existsSync(new URL(MIGRATION, repoRoot)) ? read(MIGRATION) : ''
const migration = migrationRaw ? code(MIGRATION) : ''
const stamp = MIGRATION.split('/').pop().slice(0, 14)

const decisionsSeed = existsSync(new URL('docs/OWNER_DECISIONS_SECTION2_CONTACTS.md', repoRoot))
  ? read('docs/OWNER_DECISIONS_SECTION2_CONTACTS.md')
  : ''
const liveSchema = existsSync(new URL('docs/LIVE_SECTION2_SCHEMA.md', repoRoot))
  ? read('docs/LIVE_SECTION2_SCHEMA.md')
  : ''

check('the migration timestamp is later than the last pre-existing migration',
  stamp > LAST_PREDATING_MIGRATION,
  `stamp=${stamp} lastPredating=${LAST_PREDATING_MIGRATION}`)

const migrationNames = existsSync(new URL('supabase/migrations', repoRoot))
  ? readdirSync(new URL('supabase/migrations', repoRoot)).filter((f) => f.endsWith('.sql'))
  : []
const sameStamp = migrationNames.filter((f) => f.slice(0, 14) === stamp)
check('no other migration shares this timestamp', sameStamp.length === 1, JSON.stringify(sameStamp))

check('the migration contains no DML and no destructive table/column DDL',
  !/\binsert\s+into\b/i.test(migration) &&
  !/\bupdate\s+public\./i.test(migration) &&
  !/\bdelete\s+from\b/i.test(migration) &&
  !/\btruncate\b/i.test(migration) &&
  !/\bdrop\s+table\b/i.test(migration) &&
  !/\bdrop\s+column\b/i.test(migration),
  '')

check('the question-count reveal triggers are dropped by their live names',
  /drop trigger if exists trg_contacts_unlocked on public\.section2_chat_progress/i.test(migration) &&
  /drop trigger if exists trg_auto_contact_reveal on public\.section2_chat_progress/i.test(migration),
  '')

check('the reveal functions are removed by name, not by row count',
  migration.includes("'enforce_contacts_unlocked'") &&
  migration.includes("'handle_contact_reveal'") &&
  /drop function if exists %s/i.test(migration),
  '')

check('no question threshold of 14 survives in the migration',
  !/>=\s*14\b/.test(migration) && !/questions_discussed\s*>=/i.test(migration),
  '')

check('the reveal recorder (set_entitlement_context) is not called for a question count',
  !/set_entitlement_context/i.test(migration), '')

check('the retained contacts_unlocked column is pinned, not derived',
  /new\.contacts_unlocked := false/i.test(migration) &&
  /new\.contacts_unlocked := coalesce\(old\.contacts_unlocked, false\)/i.test(migration),
  '')

// ---------------------------------------------------------------------------
// D2 — matched-partner helper and response policies
// ---------------------------------------------------------------------------
const partnerStart = migration.indexOf('create or replace function public.is_section2_partner')
const partnerEnd = migration.indexOf('revoke all on function public.is_section2_partner')
const partnerBody = partnerStart >= 0 && partnerEnd > partnerStart
  ? migration.slice(partnerStart, partnerEnd)
  : ''

check('the matched-partner helper exists as SECURITY DEFINER with a fixed search_path',
  partnerBody.length > 0 &&
  /security definer/i.test(partnerBody) &&
  /set search_path = public/i.test(partnerBody),
  '')

check('D2 pairing: match_history either direction OR matched matches, either direction',
  /from public\.match_history mh/i.test(partnerBody) &&
  /mh\.tier1_match_id = b or mh\.tier2_match_id = b/i.test(partnerBody) &&
  /mh\.tier1_match_id = a or mh\.tier2_match_id = a/i.test(partnerBody) &&
  /from public\.matches m/i.test(partnerBody) &&
  // The captured target admits matched|interested|... and stores every live
  // pair as 'matched'; 'active' is the chain's label. Both must be accepted,
  // 'interested' must not (it is one-sided).
  /m\.status in \('active', 'matched'\)/i.test(partnerBody) &&
  !/m\.status in \([^)]*'interested'/i.test(partnerBody),
  '')

check('D2 blocks: user_blocks in either direction stops a partner read',
  /from public\.user_blocks ub/i.test(partnerBody) &&
  /ub\.blocker_id = a and ub\.blocked_id = b/i.test(partnerBody) &&
  /ub\.blocker_id = b and ub\.blocked_id = a/i.test(partnerBody),
  '')

check('section2_responses SELECT is own-or-matched-partner only',
  /section2_responses_select_own_or_partner/i.test(migration) &&
  /user_id = auth\.uid\(\)\s*\n\s*or public\.is_section2_partner\(user_id, auth\.uid\(\)\)/i.test(migration),
  '')

check('section2_responses writes are own-row only (insert and update)',
  /section2_responses_insert_own/i.test(migration) &&
  /section2_responses_update_own/i.test(migration) &&
  (migration.match(/with check \(user_id = auth\.uid\(\)\)/g) || []).length >= 2,
  '')

check('both Section 2 tables have RLS enabled',
  /alter table public\.section2_chat_progress enable row level security/i.test(migration) &&
  /execute 'alter table public\.section2_responses enable row level security'/i.test(migration),
  '')

check('progress writes are participant-scoped, not payment-scoped',
  /section2_progress_insert_participants/i.test(migration) &&
  /section2_progress_update_participants/i.test(migration) &&
  /user_id_a = auth\.uid\(\) or user_id_b = auth\.uid\(\)/i.test(migration),
  '')

// The whole RLS stage (progress policies through the last response policy)
// must be free of payment / entitlement / completion / unlock / expiry inputs.
const policyStart = migration.indexOf('create policy "section2_progress_select_participants"')
const policyEnd = migration.indexOf('public.get_match_contact', policyStart)
const policyStage = policyStart >= 0 && policyEnd > policyStart
  ? migration.slice(policyStart, policyEnd)
  : ''

check('no Section 2 policy reads payment, entitlement, completion, unlock or expiry state',
  policyStage.length > 0 &&
  !/connect_unlocks|payment_intents|entitlement|section2_unlocked|section2_free_expires_at|contacts_unlocked|expires_at/i.test(policyStage),
  '')

// ---------------------------------------------------------------------------
// D3 — the reveal is payment AND owner consent. The base migration leaves
// get_unlocked_contacts alone; a later migration must replace it, and the
// guard reads the replacement body rather than trusting the prose.
// ---------------------------------------------------------------------------
const D3_MIGRATION = 'supabase/migrations/20261021130000_section2_d3_contact_reveal.sql'
const d3Raw = existsSync(new URL(D3_MIGRATION, repoRoot)) ? read(D3_MIGRATION) : ''
const d3 = d3Raw ? code(D3_MIGRATION) : ''
const d3Stamp = D3_MIGRATION.split('/').pop().slice(0, 14)

check('the D3 migration exists', d3Raw.length > 0, D3_MIGRATION)
check('the D3 migration runs after the base Section 2 migration',
  d3Stamp > stamp, `d3=${d3Stamp} base=${stamp}`)
check('no other migration shares the D3 timestamp',
  migrationNames.filter((f) => f.slice(0, 14) === d3Stamp).length === 1,
  JSON.stringify(migrationNames.filter((f) => f.slice(0, 14) === d3Stamp)))

check('the D3 migration contains no DML and no destructive table/column DDL',
  !/\binsert\s+into\b/i.test(d3) &&
  !/\bupdate\s+public\./i.test(d3) &&
  !/\bdelete\s+from\b/i.test(d3) &&
  !/\btruncate\b/i.test(d3) &&
  !/\bdrop\s+table\b/i.test(d3) &&
  !/\bdrop\s+column\b/i.test(d3),
  '')

const d3BodyStart = d3.indexOf('create or replace function public.get_unlocked_contacts')
const d3BodyEnd = d3.indexOf('comment on function public.get_unlocked_contacts', d3BodyStart)
const d3Body = d3BodyStart >= 0 && d3BodyEnd > d3BodyStart
  ? d3.slice(d3BodyStart, d3BodyEnd)
  : ''

check('D3 replaces get_unlocked_contacts in a plpgsql SECURITY DEFINER function',
  d3Body.length > 0 &&
  /language plpgsql/i.test(d3Body) &&
  /security definer/i.test(d3Body) &&
  /set search_path = public/i.test(d3Body),
  '')

check('D3 condition 1: a connect_unlocks row for THIS buyer and THIS seller is required',
  /from public\.connect_unlocks cu/i.test(d3Body) &&
  /cu\.buyer_id = me/i.test(d3Body) &&
  /cu\.seller_id = other_user_id/i.test(d3Body) &&
  /if not found then\s*\n\s*return;/i.test(d3Body),
  '')

check('D3 condition 2: every channel is filtered by the owner\'s live share_* flag',
  [
    ['share_phone', 'phone'],
    ['share_whatsapp', 'whatsapp_number'],
    ['share_email', 'email'],
    ['share_social_instagram', 'social_instagram'],
    ['share_social_x', 'social_x'],
    ['share_social_tiktok', 'social_tiktok']
  ].every(([flag, channel]) =>
    new RegExp(`case when contact_owner\\.${flag} then paid\\.${channel} end`, 'i').test(d3Body)),
  '')

check('D3 removes the legacy question-count branch: no Section 2 state in the reveal',
  d3Body.length > 0 &&
  !/section2_chat_progress|contacts_unlocked|questions_discussed|section2_unlocked|section2_free_expires_at|section2_responses/i.test(d3Body),
  '')

check('D3 re-asserts the ACL: PUBLIC and anon revoked, authenticated granted',
  /revoke all on function public\.get_unlocked_contacts\(uuid\) from public/i.test(d3) &&
  /revoke all on function public\.get_unlocked_contacts\(uuid\) from anon/i.test(d3) &&
  /grant execute on function public\.get_unlocked_contacts\(uuid\) to authenticated/i.test(d3),
  '')

check('D3 proves itself at apply time (body + privilege post-conditions)',
  /prosrc/i.test(d3) &&
  /has_function_privilege/i.test(d3) &&
  /still reads Section 2 state/i.test(d3),
  '')

check('D3 refuses a drifted live shape before changing anything',
  /assumptions are not met on this database/i.test(d3) &&
  /connect_unlocks\((?:id,)?buyer_id,seller_id/i.test(d3) &&
  /users\(id,share_phone/i.test(d3) &&
  /create or replace cannot change the return type|CREATE OR REPLACE cannot change the return type/i.test(d3Raw),
  '')

// A TABLE function's pg_proc arrays carry the IN argument first ('i'), then
// one 't' per returned column. Comparing against six 't' entries only made
// the preflight fail every second run; this pins the real shape.
check('D3 preflight compares against the real TABLE-function catalog shape',
  /array\['i', 't', 't', 't', 't', 't', 't'\]/.test(d3) &&
  /'other_user_id', 'phone', 'whatsapp_number'/.test(d3) &&
  /array\['uuid', 'text', 'text', 'text', 'text', 'text', 'text'\]/.test(d3),
  '')

// The deployed table grants let a buyer select the whole connect_unlocks row
// (RLS policy unlock_select_buyer), which returned contact channels the owner
// had since switched off. Column privileges are the only fix under RLS.
check('D3 closes the connect_unlocks snapshot side channel',
  /revoke select on public\.connect_unlocks from public/i.test(d3) &&
  /revoke select on public\.connect_unlocks from anon/i.test(d3) &&
  /revoke select on public\.connect_unlocks from authenticated/i.test(d3) &&
  /grant select \(id, buyer_id, seller_id, tier, created_at\)[\s\S]{0,80}on public\.connect_unlocks to authenticated/i.test(d3) &&
  /has_column_privilege\('authenticated', 'public\.connect_unlocks', 'phone', 'select'\)/i.test(d3),
  '')

check('D3 keeps the deployed pairing guard and requires it to exist',
  /if not public\.users_are_paired\(me, other_user_id\) then/i.test(d3Body) &&
  /to_regprocedure\('public\.users_are_paired\(uuid, uuid\)'\)/i.test(d3) &&
  /dropped the deployed pairing guard/i.test(d3),
  '')

// The 2026-10-15 dump is a LOCAL chain materialization, not the project
// database. Presenting it as live evidence is the defect this guards; the
// live evidence must come from a read-only catalog read of the project.
check('the evidence register separates the live capture from the local chain dump',
  /Status: CAPTURED \(live\)/.test(liveSchema) &&
  /supabase_read_only_user/.test(liveSchema) &&
  /not the project database/i.test(liveSchema) &&
  /local Supabase/i.test(liveSchema) &&
  !/pg_dump of the project database/i.test(liveSchema + decisionsSeed + d3Raw),
  '')

check('the base migration still leaves get_unlocked_contacts untouched',
  !/create (or replace )?function public\.get_unlocked_contacts/i.test(migration) &&
  !/revoke all on function public\.get_unlocked_contacts/i.test(migration) &&
  !/drop function if exists public\.get_unlocked_contacts/i.test(migration),
  '')

check('the decisions record states D3 is implemented in the follow-up migration',
  /\| D3 \| Implemented in its own migration/i.test(decisionsSeed) &&
  /## D3 implementation/.test(decisionsSeed) &&
  /20261021130000_section2_d3_contact_reveal\.sql/.test(decisionsSeed) &&
  !/## Deferred pending live verification/.test(decisionsSeed) &&
  [
    'connect_unlocks',
    'share_phone',
    'share_whatsapp',
    'share_email',
    'share_social_instagram',
    'share_social_x',
    'share_social_tiktok'
  ].every((needle) => decisionsSeed.includes(needle)),
  '')

check('the migration carries a stage-0 preflight that refuses an unexpected live schema',
  /assumptions are not met on this database/i.test(migration) &&
  /information_schema\.columns/i.test(migration) &&
  /array_to_string\(missing, '; '\)/i.test(migration),
  '')

check('the preflight names the columns the policies depend on',
  ['user_id_a', 'user_id_b', 'questions_discussed', 'contacts_unlocked',
    'user_id', 'question_number', 'answer_text', 'tier1_match_id', 'tier2_match_id',
    'user_a_id', 'user_b_id', 'blocker_id', 'blocked_id']
    .every((column) => migration.includes(column)),
  '')

check('the migration is marked applied with its recorded version',
  /STATUS: APPLIED to minglemate-staging on 2026-10-22/.test(migrationRaw) &&
  /20261021120000 recorded in supabase_migrations\.schema_migrations/.test(migrationRaw),
  '')

check('the evidence register records the 2026-10-22 capture of the target',
  existsSync(new URL('docs/LIVE_SECTION2_SCHEMA.md', repoRoot)) &&
  /Status: CAPTURED \(live\)/.test(liveSchema) &&
  // Both projects must be named: the capture is only meaningful next to the
  // project whose absences it refutes.
  /ifiewinipbxxfvzpzezd/.test(liveSchema) &&
  /mhdjnhiqahsllbczbzpk/.test(liveSchema) &&
  ['connect_unlocks', 'payment_intents', 'user_blocks', 'conversations', 'share_phone']
    .every((needle) => liveSchema.includes(needle)),
  '')

// ---------------------------------------------------------------------------
// D5 — get_match_contact revoked then dropped
// ---------------------------------------------------------------------------
const revokeMatchContact = migration.indexOf('revoke all on function public.get_match_contact')
const dropMatchContact = migration.indexOf('drop function if exists public.get_match_contact')
check('get_match_contact has its EXECUTE grants revoked BEFORE the drop',
  revokeMatchContact > -1 && dropMatchContact > revokeMatchContact,
  `revokeAt=${revokeMatchContact} dropAt=${dropMatchContact}`)

// ---------------------------------------------------------------------------
// D1 — the client screens carry no Section 2 gate
// ---------------------------------------------------------------------------
const chat = code('src/pages/Chat.jsx')
check('Chat.jsx has no Section 2 payment, trial, unlock or question-count gate',
  !/section2_unlocked|section2_free_expires_at|contacts_unlocked|FREE_QUESTIONS|bothUnlocked|isPaywallPoint/i.test(chat) &&
  !/Unlock Section 2/i.test(chat),
  '')

check('Chat.jsx offers every guided question, gated only by a reply',
  /msgsSinceBot >= 1\)/.test(chat) &&
  /sendBotQuestion\(nextQ, s2Progress, currentUser, matchId\)/.test(chat),
  '')

const section2 = code('src/pages/Section2.jsx')
check('Section2.jsx has no payment, unlock or expiry gate',
  !/section2_unlocked|section2_free_expires_at|contacts_unlocked|payment/i.test(section2),
  '')

const matches = code('src/pages/Matches.jsx')
check('Matches.jsx reads no Section 2 entitlement column',
  !/section2_unlocked|section2_free_expires_at/i.test(matches),
  '')

const payment = code('src/pages/Payment.jsx')
check('Payment.jsx offers no Section 2 purchase',
  !/section2\s*:\s*\{/.test(payment) &&
  !/section2_unlocked/i.test(payment) &&
  /Nothing to pay for/.test(payment),
  '')

// No client code may call the dropped RPC.
function walk(relativeDir) {
  const absolute = new URL(relativeDir, repoRoot)
  if (!existsSync(absolute)) return []
  const out = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const child = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) out.push(...walk(child))
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(child)
  }
  return out
}

const clientFiles = [...walk('src'), ...walk('supabase/functions')]
const matchContactCallers = clientFiles.filter((file) => read(file).includes('get_match_contact'))
check('nothing in src/ or supabase/functions calls get_match_contact',
  matchContactCallers.length === 0,
  JSON.stringify(matchContactCallers))


// ---------------------------------------------------------------------------
// D5 — new purchases refused, old callbacks still processed
// ---------------------------------------------------------------------------
const initiate = code('supabase/functions/initiate-payment/index.ts')
check('initiate-payment rejects purpose=section2 with HTTP 400 and a clear message',
  /purpose === 'section2'/.test(initiate) &&
  /Section 2 is free — there is nothing to pay for\. Contact details are unlocked with Connect\./.test(initiate) &&
  /status: 400/.test(initiate),
  '')

check('initiate-payment no longer prices or describes a Section 2 purchase',
  !/section2:\s*200/.test(initiate) &&
  !/Section 2 Unlock/.test(initiate) &&
  !/purpose !== 'section2'/.test(initiate),
  '')

const callbackIndex = code('supabase/functions/payment-callback/index.ts')
const callbackTicket = code('supabase/functions/payment-callback/ticket.ts')
check('payment-callback still settles old section2 intents',
  /section2/.test(callbackIndex) && /section2/.test(callbackTicket),
  '')

// ---------------------------------------------------------------------------
// D4 — the isolation guard keeps its teeth
// ---------------------------------------------------------------------------
const isolation = read('scripts/verify-section2-isolation.mjs')
check('the Section 2 isolation guard still covers the three matching files',
  ['match-generator/index.ts', 'compatibilityEngine.ts', 'matchingEligibility.ts']
    .every((file) => isolation.includes(file)),
  '')

check('the Section 2 isolation guard still asserts the Section 2 identifiers',
  ['section2_unlocked', 'section2_responses', 'section2_chat_progress', 'engagement_metrics']
    .every((identifier) => isolation.includes(identifier)),
  '')

// ---------------------------------------------------------------------------
// The decisions are recorded
// ---------------------------------------------------------------------------
check('D1–D5 are recorded verbatim alongside the four still-open items',
  ['## D1', '## D2', '## D3', '## D4', '## D5', '## Open, not decided']
    .every((heading) => decisionsSeed.includes(heading)) &&
  [
    '1. Connect price',
    '2. Refund or retirement of old Section 2 payments',
    '3. Read receipts',
    '4. Whether match visibility should expire after a number of weeks'
  ].every((item) => decisionsSeed.includes(item)) &&
  !/AWAITING OWNER TEXT/.test(decisionsSeed),
  '')

// ---------------------------------------------------------------------------
// The capture file must keep covering every live fact the migration needs.
// A missing section means the one round-trip the owner runs cannot unblock
// the migration, so it is guarded here rather than trusted to review.
// ---------------------------------------------------------------------------
const CAPTURE = 'supabase/sql/capture_section2_contacts_state.sql'
const capture = existsSync(new URL(CAPTURE, repoRoot)) ? read(CAPTURE) : ''

check('the capture file exists and is read-only by construction',
  capture.length > 0 &&
  !/^\s*(insert|update|delete|truncate|create|alter|drop|grant|revoke)\b/im.test(capture),
  CAPTURE)

check('the capture file covers every fact the migration and D3 need',
  [
    '1-columns',            // Section 2 tables + connect_unlocks
    '1b-partner-columns',   // match_history / matches / user_blocks (Stage 0, D2)
    '1b-matches-status-enum',
    '2-constraints',
    '3-rls-status',
    '4-policies',
    '5-table-grants',
    '5-column-grants',      // PUBLIC + column-level grants
    '6-function-grants',
    '7-functions',          // includes the live get_unlocked_contacts body
    '7c-contact-function-bodies', // reveal path that is not named after one
    '8-triggers',
    '8b-contact-triggers',  // no second reveal attachment point
    '9-share-columns',
    '9b-users-access',      // users RLS/policies/grants on the contact columns
    '10-payment-constraints',
    '11-platform'           // authenticated role + auth.uid()
  ].every((section) => capture.includes(`'${section}'`)),
  '')

// The owner's 2026-10-22 report showed payments.match_id + unlock_status as
// the candidate paid-pair record, so the shape probe must keep looking for
// match_id as well as buyer/seller.
check('the capture finds a paid-pair table by match_id shape too',
  /'match_id'/.test(capture) && /connect_unlocks/.test(capture),
  '')

check('the capture file captures the live get_unlocked_contacts definition',
  /'get_unlocked_contacts'/.test(capture) &&
  /pg_get_functiondef/.test(capture) &&
  /pg_get_function_result/.test(capture),
  '')

// ---------------------------------------------------------------------------
// Step 1 reconciliation — the live findings must be reconciled, not absorbed
// silently into the migrations. These four checks keep the analysis in
// docs/SECTION2_LIVE_RECONCILIATION.md tied to the files it governs.
// ---------------------------------------------------------------------------
const RECONCILIATION = 'docs/SECTION2_LIVE_RECONCILIATION.md'
const reconciliation = existsSync(new URL(RECONCILIATION, repoRoot))
  ? read(RECONCILIATION)
  : ''

check('the live-schema reconciliation artifact exists and covers findings A–F',
  reconciliation.length > 0 &&
  ['A', 'B', 'C', 'D', 'E', 'F'].every((f) => reconciliation.includes(`### Finding ${f}`)),
  RECONCILIATION)

check('the reconciliation names both projects and records the corrected verdict',
  /mhdjnhiqahsllbczbzpk/.test(reconciliation) &&
  /ifiewinipbxxfvzpzezd/.test(reconciliation) &&
  /Corrected verdict/.test(reconciliation),
  '')

check('the reconciliation records the lineage verdict and its decisive facts',
  /never creates/.test(reconciliation) &&
  /public\.payments/.test(reconciliation) &&
  ['connect_unlocks', 'payment_intents', 'user_blocks', 'conversations']
    .every((table) => reconciliation.includes(table)) &&
  // Markdown wraps the sentence, so the phrase is matched across newlines.
  /is\s+not\s+the\s+output\s+of\s+this\s+repository's\s+migration\s+chain/i.test(reconciliation),
  '')

check('neither pending migration was rewritten against the legacy payments shape',
  !/\bpayments\b/i.test(d3Body) &&
  !/from public\.payments/i.test(d3) &&
  /payments/.test(d3Raw),
  'D3 must name payments in its provenance note only, never in Stage 0 or the body')

check('both pending migrations declare the chain they must run after',
  /MUST RUN AFTER 20261014150000/.test(migrationRaw) &&
  /MUST RUN AFTER 20261014150000/.test(d3Raw),
  '')

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('\n=========== SECTION 2 CONTACT RULES ===========')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
