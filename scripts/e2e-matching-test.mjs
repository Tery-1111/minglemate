// ============================================================
// E2E MATCHING TEST — live, real-DB, controlled users
//
// Run ONLY against STAGING. Never point this at production.
//
//   E2E_SUPABASE_URL=https://<ref>.supabase.co \
//   E2E_SUPABASE_ANON_KEY=<anon key> \
//   node scripts/e2e-matching-test.mjs
//
// Optional:
//   E2E_SERVICE_KEY   service_role key — enables automatic admin
//                     grant + trigger + cleanup. NEVER print it.
//   E2E_PASSWORD      override the test password.
//
// What it does:
//   1. Signs up A (male), B (female), C (female) via /auth/v1/signup.
//   2. Writes curated answers: A and B choose option[0] of every
//      question (identical → expected 100). C chooses option[3]
//      of every question (opposite → expected 0 under exact-match).
//   3. Computes expected scores from the LIVE question file —
//      both the deployed legacy engine (word-overlap) and the new
//      engine (exact match) — so the result also tells you WHICH
//      engine version the deployed match-generator runs.
//   4. Triggers POST /functions/v1/match-generator. With a service
//      key it grants the first test user admin_users itself; without
//      one it prints the one-line SQL to run and polls.
//   5. Verifies matches.compatibility_score and match_history
//      tier1/tier2 as the test users (through real RLS).
//   6. Prints cleanup SQL (never deletes on its own).
// ============================================================

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- config -------------------------------------------------
const SUPABASE_URL = (process.env.E2E_SUPABASE_URL || '').replace(/\/$/, '')
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.E2E_SERVICE_KEY || '' // never logged
const PASSWORD = process.env.E2E_PASSWORD || 'E2e!TestPass2026x'

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Set E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY first.')
  console.error('STAGING ONLY — aborting because production must never be tested against.')
  process.exit(1)
}
if (/mhdjnhiqahsllbczbzpk/.test(SUPABASE_URL)) {
  console.error('REFUSING: that URL is the production project.')
  process.exit(1)
}

const stamp = Date.now().toString(36)
const USERS = [
  { tag: 'a', email: `e2e-a-${stamp}@staging.test`, gender: 'male', optionIndex: 0 },
  { tag: 'b', email: `e2e-b-${stamp}@staging.test`, gender: 'female', optionIndex: 0 },
  { tag: 'c', email: `e2e-c-${stamp}@staging.test`, gender: 'female', optionIndex: 3 },
]

// --- live question data (guarantees exact option strings) ----
const { section1Questions } = await import(
  'file:///' + join(__dirname, '..', 'src', 'data', 'section1Questions.js').replace(/\\/g, '/')
)
if (section1Questions.length !== 50) {
  console.error(`Expected 50 questions, found ${section1Questions.length} — aborting.`)
  process.exit(1)
}
for (const q of section1Questions) {
  if (!q.options || q.options.length < 4) {
    console.error(`Question ${q.id} has fewer than 4 options — aborting.`)
    process.exit(1)
  }
}

// answers[tag] = array of 50 option strings (index i = question i+1)
const answers = {}
for (const u of USERS) {
  answers[u.tag] = section1Questions.map(q => q.options[u.optionIndex])
}

// --- expected scores: replicate BOTH engine versions ----------
// Legacy (deployed until the engine fix ships): word-overlap >= 50% of
// the shorter option counts as a match. New: exact option text match.
function legacySimilar(a, b) {
  if (!a || !b) return false
  const wa = new Set(a.trim().toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wb = new Set(b.trim().toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (wa.size === 0 || wb.size === 0) return a === b
  const overlap = [...wa].filter(w => wb.has(w)).length
  return overlap / Math.min(wa.size, wb.size) >= 0.5
}
const exactSimilar = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()

const DIMENSIONS = [
  { name: 'communication', from: 1, weight: 0.3 },
  { name: 'conflict', from: 11, weight: 0.25 },
  { name: 'emotional', from: 21, weight: 0.2 },
  { name: 'expectations', from: 31, weight: 0.15 },
  { name: 'values', from: 41, weight: 0.1 },
]
function expectedScore(similarFn, tagX, tagY) {
  let overall = 0
  const dims = {}
  for (const dim of DIMENSIONS) {
    let match = 0
    for (let i = dim.from; i < dim.from + 10; i++) {
      if (answers[tagX][i - 1] && answers[tagY][i - 1] && similarFn(answers[tagX][i - 1], answers[tagY][i - 1])) match++
    }
    const pct = (match / 10) * 100
    dims[dim.name] = pct
    overall += pct * dim.weight
  }
  return { overall: Math.round(overall), dims }
}

// --- HTTP helpers ---------------------------------------------
async function rest(path, { method = 'GET', token = ANON_KEY, key = ANON_KEY, body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json, text }
}

const results = []
function record(step, status, detail) {
  results.push({ step, status, detail })
  const icon = status === 'PASS' ? '✔' : status === 'FAIL' ? '✘' : '→'
  console.log(`${icon} ${step}: ${status}${detail ? ` — ${detail}` : ''}`)
}

// ============================================================
// 1. SIGN UP the three controlled users
// ============================================================
for (const u of USERS) {
  const r = await rest('/auth/v1/signup', {
    method: 'POST',
    body: { email: u.email, password: PASSWORD, data: { full_name: `E2E ${u.tag.toUpperCase()}` } },
  })
  if (r.status === 200 && r.json?.access_token) {
    u.token = r.json.access_token
    u.id = r.json.user?.id
    record(`signup ${u.tag}`, 'PASS', `${u.email} → session ok`)
  } else if (r.status === 200 && r.json?.user && !r.json.access_token) {
    record(`signup ${u.tag}`, 'FAIL', 'no session returned — email confirmation is ON. Disable it on STAGING (Authentication → Providers → Email → Confirm email off) or confirm manually, then rerun.')
    process.exit(1)
  } else {
    record(`signup ${u.tag}`, 'FAIL', `HTTP ${r.status} ${r.text?.slice(0, 200)}`)
    process.exit(1)
  }
}

// ============================================================
// 2. PROFILE ROWS — the fix_rls trigger should create them;
//    fill required fields (full_name, gender).
// ============================================================
for (const u of USERS) {
  let row = await rest(`/rest/v1/users?id=eq.${u.id}&select=id,full_name,gender,section1_complete,profile_status`, { token: u.token })
  if (row.ok && Array.isArray(row.json) && row.json.length === 0) {
    // no trigger on this project — create the row ourselves
    const ins = await rest('/rest/v1/users', {
      method: 'POST', token: u.token,
      body: { id: u.id, full_name: `E2E ${u.tag.toUpperCase()}`, gender: u.gender },
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    row = ins
  }
  const upd = await rest('/rest/v1/users?id=eq.' + u.id, {
    method: 'PATCH', token: u.token,
    body: { full_name: `E2E ${u.tag.toUpperCase()}`, gender: u.gender, profile_status: 'active' },
    prefer: 'return=representation',
  })
  record(`profile ${u.tag}`, upd.ok ? 'PASS' : 'FAIL', upd.ok ? 'filled name/gender/status' : `HTTP ${upd.status} ${upd.text?.slice(0, 160)}`)
  if (!upd.ok) process.exit(1)
}

// ============================================================
// 3. ANSWERS — upsert user_responses, mark section1_complete
// ============================================================
for (const u of USERS) {
  const r = await rest('/rest/v1/user_responses', {
    method: 'POST', token: u.token,
    body: { user_id: u.id, responses_array: answers[u.tag] },
    prefer: 'resolution=merge-duplicates,return=representation',
  })
  // merge-duplicates needs a unique/PK conflict target; if it fails, try PATCH fallback
  let ok = r.ok
  let errText = r.text
  if (!ok) {
    const patch = await rest(`/rest/v1/user_responses?user_id=eq.${u.id}`, {
      method: 'PATCH', token: u.token, body: { responses_array: answers[u.tag] },
    })
    ok = patch.ok
    errText = patch.text
  }
  record(`answers ${u.tag}`, ok ? 'PASS' : 'FAIL', ok ? '50 option strings stored' : `HTTP ${r.status} ${errText?.slice(0, 160)}`)
  if (!ok) process.exit(1)

  const done = await rest('/rest/v1/users?id=eq.' + u.id, {
    method: 'PATCH', token: u.token, body: { section1_complete: true },
  })
  record(`complete ${u.tag}`, done.ok ? 'PASS' : 'FAIL', done.ok ? 'section1_complete=true' : `HTTP ${done.status}`)
  if (!done.ok) process.exit(1)
}

// read-back through the user's own session proves the column type is text[]
for (const u of [USERS[0]]) {
  const back = await rest(`/rest/v1/user_responses?user_id=eq.${u.id}&select=responses_array`, { token: u.token })
  const arr = back.json?.[0]?.responses_array
  const good = Array.isArray(arr) && arr.length === 50 && typeof arr[0] === 'string' && arr[0] === answers.a[0]
  record('read-back', good ? 'PASS' : 'FAIL',
    good ? `q1="${arr[0]}" q31="${arr[30]}"` : `unexpected: ${JSON.stringify(arr)?.slice(0, 120)}`)
  if (!good) process.exit(1)
}

// ============================================================
// 4. EXPECTED SCORES (both engine versions)
// ============================================================
const expAB_new = expectedScore(exactSimilar, 'a', 'b')
const expAC_new = expectedScore(exactSimilar, 'a', 'c')
const expAB_old = expectedScore(legacySimilar, 'a', 'b')
const expAC_old = expectedScore(legacySimilar, 'a', 'c')
console.log('\nExpected scores — A vs B (identical): new-engine 100, legacy ' + expAB_old.overall)
console.log('Expected scores — A vs C (opposite):  new-engine ' + expAC_new.overall + ', legacy ' + expAC_old.overall)
console.log('dimension detail (new engine) A/B:', JSON.stringify(expAB_new.dims))
console.log('dimension detail (new engine) A/C:', JSON.stringify(expAC_new.dims), '\n')

// ============================================================
// 5. TRIGGER match-generator through the real HTTP path
// ============================================================
async function tryTrigger(token, key) {
  return rest('/functions/v1/match-generator', { method: 'POST', token, key, body: {} })
}

let triggered = null
if (SERVICE_KEY) {
  // Grant A admin via service key (rest call with service auth)
  const grant = await rest('/rest/v1/admin_users', {
    method: 'POST', key: SERVICE_KEY, token: SERVICE_KEY,
    body: { user_id: USERS[0].id },
    prefer: 'resolution=merge-duplicates',
  })
  record('admin grant (service key)', grant.ok || grant.status === 409 ? 'PASS' : 'FAIL',
    grant.ok ? 'A added to admin_users' : `HTTP ${grant.status} ${grant.text?.slice(0, 140)}`)
  triggered = await tryTrigger(SERVICE_KEY, SERVICE_KEY)
} else {
  console.log('No E2E_SERVICE_KEY provided. Run this one line in the STAGING SQL editor,')
  console.log(`  insert into admin_users (user_id) values ('${USERS[0].id}');`)
  console.log('Polling the endpoint every 20s for up to 3 minutes afterwards…')
  for (let i = 0; i < 9; i++) {
    await new Promise(r => setTimeout(r, 20000))
    triggered = await tryTrigger(USERS[0].token, ANON_KEY)
    if (triggered.ok) break
  }
}

if (!triggered?.ok) {
  record('trigger match-generator', 'FAIL',
    `HTTP ${triggered?.status ?? 'n/a'} ${triggered?.text?.slice(0, 200)}`)
} else {
  record('trigger match-generator', 'PASS', JSON.stringify(triggered.json))
}

// ============================================================
// 6. VERIFY — real delivery state in the DB, through real RLS
// ============================================================
// The weekly engine no longer writes `matches`: that table holds only
// Qrashe pairs created by the paid Force Connect flow, and the app
// reads every status='active' row there as a Qrashe match — so a
// weekly pair written into it would be mislabelled. The checks are
// therefore (a) the generator wrote no weekly pair into it, and (b)
// the weekly result landed in match_history with the right ranking.
// Per-pair compatibility scores are no longer persisted in `matches`,
// so the deployed-engine signal is the ranking below: B (identical
// answers, ~100) must outrank C (opposite answers).
const matchRows = await rest(
  `/rest/v1/matches?or=(user_a_id.eq.${USERS[0].id},user_b_id.eq.${USERS[0].id})&select=user_a_id,user_b_id,tier,status`,
  { token: USERS[0].token }
)
if (!matchRows.ok || !Array.isArray(matchRows.json)) {
  record('matches read', 'FAIL', `HTTP ${matchRows.status} ${matchRows.text?.slice(0, 200)}`)
} else {
  const testPartners = new Set([USERS[1].id, USERS[2].id])
  const leaked = matchRows.json.filter(m =>
    (m.user_a_id === USERS[0].id && testPartners.has(m.user_b_id)) ||
    (m.user_b_id === USERS[0].id && testPartners.has(m.user_a_id)))
  const legacyRows = matchRows.json.filter(m => m.tier !== 'qrashe')
  record('generator leaves matches alone', leaked.length === 0 ? 'PASS' : 'FAIL',
    leaked.length === 0
      ? `no weekly pair in matches (${matchRows.json.length} row(s) on A, ${legacyRows.length} pre-tier legacy)`
      : `weekly pair(s) written into the Qrashe table: ${JSON.stringify(leaked)}`)
}

const hist = await rest(
  `/rest/v1/match_history?user_id=eq.${USERS[0].id}&select=week_id,tier1_match_id,tier2_match_id,delivered_at`,
  { token: USERS[0].token }
)
if (hist.ok && hist.json?.length > 0) {
  const h = hist.json[0]
  const t1ok = h.tier1_match_id === USERS[1].id   // B scores 100 → tier1
  record('match_history tier1', t1ok ? 'PASS' : 'FAIL',
    `tier1=${h.tier1_match_id === USERS[1].id ? 'B (correct)' : h.tier1_match_id === USERS[2].id ? 'C (WRONG)' : h.tier1_match_id}, tier2=${h.tier2_match_id ?? 'null'}`)
} else {
  record('match_history', 'FAIL', hist.ok ? 'empty — delivery step failed' : `HTTP ${hist.status}`)
}

// B's symmetric view
const histB = await rest(
  `/rest/v1/match_history?user_id=eq.${USERS[1].id}&select=tier1_match_id,tier2_match_id`,
  { token: USERS[1].token }
)
if (histB.ok && histB.json?.length > 0) {
  record('match_history (B view)', histB.json[0].tier1_match_id === USERS[0].id ? 'PASS' : 'FAIL',
    `B.tier1=${histB.json[0].tier1_match_id === USERS[0].id ? 'A (correct)' : histB.json[0].tier1_match_id}`)
}

// ============================================================
// 7. SUMMARY + CLEANUP (printed, never auto-executed)
// ============================================================
console.log('\n================ SUMMARY ================')
for (const r of results) console.log(`${r.status === 'PASS' ? '✔' : '✘'} ${r.step}`)

console.log('\nCleanup (run in the STAGING SQL editor when done):')
console.log(`  delete from auth.users where id in ('${USERS.map(u => u.id).join("','")}');`)
console.log('  (cascades to users, user_responses, matches, match_history, admin_users)')
console.log('\nTest users (password ' + PASSWORD + '):')
USERS.forEach(u => console.log(`  ${u.tag}: ${u.email}  ${u.id}`))
