// Regression test: a client write may not move an entitlement, and the server
// still can.
//
//   supabase start
//   node scripts/verify-entitlement-clamp.mjs
//
// It runs against a local Supabase stack over the same interface the app uses —
// PostgREST and the Auth API, with a real user JWT for the client and the
// service role key for the server — because the property under test is not the
// trigger alone. It is the whole path: the grants, the RLS policies, the JWT
// claims PostgREST actually sets, and the clamp trigger that reads them.
//
// What it pins, in order:
//   1. a client's PATCH of its own section2_unlocked / trial expiry is discarded;
//   2. a client's PATCH of ANOTHER user's row changes nothing;
//   3. neither attempt leaves a grant in public.entitlement_grants;
//   4. a service-role unlock still applies, and is recorded with the intent that
//      paid for it as the evidence;
//   5. that unlock is not reported as an anomaly.
//
// A regression that removed clamp_user_protected_columns, widened the users
// grant, or broke the claim reading would turn step 1 or 4 red: stepping 1 red
// means a client can grant itself Section 2, step 4 red means nobody can grant
// it at all.
//
// Connection details come from the environment, or from `supabase status`, so a
// fresh `supabase start` needs no arguments. No dependencies: global fetch only.
//
// Getting a stack to run this against: `supabase start`, then apply the schema.
// The chain converges a database rather than creating one — its header lists the
// app's original tables as preconditions — so on a brand-new stack those come
// first (supabase/.temp/preconditions.sql was used for the run recorded in
// DEPLOYMENT-CHECKLIST.md step 6.12), then
// supabase/migrations/20261014150000_consolidated_schema_chain.sql.

import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'

// A stack probe before anything else. Without it the script falls through to
// `supabase status`, which can report a URL for a project that is not running,
// and then blocks on an untimed fetch to a dead port instead of exiting.
// 2 means "skipped: nothing to test against", not "failed".
async function stackIsUp() {
  try {
    const res = await fetch('http://127.0.0.1:54321/rest/v1/', {
      signal: AbortSignal.timeout(1500),
    })
    return res.status > 0
  } catch { return false }
}
if (!(await stackIsUp())) {
  console.error('no local stack — skipped (exit 2)')
  process.exit(2)
}

const DEFAULT_URL = 'http://127.0.0.1:54321'

const fromEnv = {
  url: process.env.SUPABASE_URL || '',
  anon: process.env.SUPABASE_ANON_KEY || '',
  service: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  db: process.env.SUPABASE_DB_URL || '',
  jwtSecret: process.env.SUPABASE_JWT_SECRET || ''
}

function fromSupabaseStatus() {
  const out = { url: '', anon: '', service: '', db: '', jwtSecret: '' }
  const parse = (text) => {
    for (const line of text.split(/\r?\n/)) {
      const env = line.match(/^([A-Z_]+)\s*=\s*"?([^"]*)"?$/)
      if (env) {
        // Both key generations: the JWT anon/service_role keys and the newer
        // sb_publishable_/sb_secret_ pair. Either works against the API, and the
        // legacy names are preferred because that is what the app's env uses.
        if (env[1] === 'API_URL') out.url = out.url || env[2]
        if (['ANON_KEY', 'PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY'].includes(env[1])) out.anon = out.anon || env[2]
        if (['SERVICE_ROLE_KEY', 'SECRET_KEY', 'SUPABASE_SECRET_KEY'].includes(env[1])) out.service = out.service || env[2]
        if (env[1] === 'DB_URL' || env[1] === 'SUPABASE_DB_URL') out.db = out.db || env[2]
        if (env[1] === 'JWT_SECRET') out.jwtSecret = out.jwtSecret || env[2]
        continue
      }
      const human = line.match(/^\s*(API URL|anon key|service_role key)\s*:\s*(\S+)/)
      if (human) {
        if (human[1] === 'API URL') out.url = out.url || human[2]
        if (human[1] === 'anon key') out.anon = out.anon || human[2]
        if (human[1] === 'service_role key') out.service = out.service || human[2]
        if (human[1] === 'DB URL') out.db = out.db || human[2]
      }
    }
    return out
  }

  let lastError = ''
  // Several ways to ask, because which one works depends on the machine. Two
  // supabase installs on PATH is a real setup (an npm shim plus a standalone
  // binary), and a bare execFile on Windows skips the npm shim — `supabase` is a
  // shell script there — landing on an older supabase.exe that can reject a
  // config.toml written for a newer CLI. supabase.cmd names that shim
  // explicitly, and nothing here is invalidated by a slow shell.
  const commands = ['supabase']
  if (process.platform === 'win32') commands.push('supabase.cmd')
  const attempts = []
  for (const args of [['status', '-o', 'env'], ['status']]) {
    for (const command of commands) {
      attempts.push({ args, command, shell: false })
      attempts.push({ args, command, shell: true })
    }
  }
  {
    for (const { args, command, shell } of attempts) {
      let text = ''
      try {
        // Bounded on purpose: `supabase status` talks to the Docker daemon, and a
        // half-started engine leaves it blocked rather than failing. A stalled
        // probe must not hang the test that is supposed to report on the stack.
        //
        // Both forms are attempted because neither is reliable on every setup:
        // the shell form resolves a shim the no-shell form cannot, and the
        // no-shell form still works where the CLI is a single binary. With the
        // shell, the CLI is invoked as one command string rather than an args
        // array (Node deprecates args+shell), which also keeps the quoting
        // identical to a developer typing it.
        text = shell
          ? execFileSync(`${command} ${args.join(' ')}`, {
              encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL', shell: true
            })
          : execFileSync(command, args, {
              encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL'
            })
      } catch (e) {
        // A non-zero exit is NOT failure here: `supabase status` exits non-zero
        // while still printing the keys whenever any optional service is
        // stopped (imgproxy, analytics, the pooler), which is normal for a stack
        // that is only running the API, Auth, Storage and Postgres. What matters
        // is whether the keys came out, so the output is parsed either way.
        text = String(e.stdout || '')
        lastError = String(e.stderr || e.message || '').trim().split('\n').filter((l) => l.trim())[0] || ''
      }
      const parsed = parse(text)
      if (parsed.anon && parsed.service) {
        // Say where the keys came from: two CLI generations and a half-restarted
        // stack are enough moving parts that a silent guess would be unhelpful.
        // (console.log rather than note(): this runs before note is defined.)
        if (!process.env.SUPABASE_ANON_KEY) {
          console.log(`stack ${parsed.url || DEFAULT_URL} (keys from \`${command} ${args.join(' ')}\`)\n`)
        }
        return { url: parsed.url || DEFAULT_URL, ...parsed }
      }
    }
  }
  if (lastError) {
    console.log(`\`supabase status\` could not be read: ${lastError.slice(0, 200)}`)
    console.log('(set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to skip it)\n')
  }
  return null
}

let stack = fromEnv.anon && fromEnv.service ? fromEnv : null
if (!stack) {
  const detected = fromSupabaseStatus()
  stack = detected ? { ...detected, url: detected.url || DEFAULT_URL } : null
  if (!stack) {
    console.log('No local stack found. Start one first:\n')
    console.log('  supabase start\n')
    console.log('or set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(2)
  }
}
const URL_ = stack.url.replace(/\/$/, '')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`); if (detail) console.log(`        ${detail}`) }
}
const note = (msg) => console.log(`        ${msg}`)

async function api(path, { method = 'GET', key, token, body, prefer, timeoutMs } = {}) {
  const headers = { apikey: key, Authorization: `Bearer ${token || key}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Only the connectivity probe passes a budget: a target that answers
    // nothing must be a skip, never a hang. Test requests stay unbounded.
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return { status: res.status, ok: res.ok, json, text }
}

const asService = (path, opts = {}) => api(path, { ...opts, key: stack.service })
const me = (path, token, opts = {}) => api(path, { ...opts, key: stack.anon, token })

// ---------------------------------------------------------------- connectivity
{
  const health = await asService('/rest/v1/', { timeoutMs: 2000 }).catch((e) => ({ status: 0, text: String(e) }))
  if (health.status === 0) {
    console.log(`No reachable stack at ${URL_} (${health.text}). Is it running? try: supabase start`)
    process.exit(2)
  }
  const who = await asService('/rest/v1/users?select=id&limit=1')
  if (who.status === 404 || /relation .* does not exist/i.test(who.text)) {
    console.log(`${URL_} answers, but the app's tables are not there: apply the schema chain first ` +
      '(supabase/migrations/20261014150000_consolidated_schema_chain.sql) — it needs the app\'s base '
      + 'tables to exist as preconditions.')
    process.exit(2)
  }
}

// ---------------------------------------------------------------- fixture users
// A user is created the way the product does it (an auth.users row, so the
// app's own on_auth_user_created trigger grants the trial) and the client then
// presents a real user JWT to PostgREST. Two routes are used, in this order:
//   * the Auth admin API, when it answers — the ordinary path;
//   * the same row written over SQL, plus a token signed with the stack's own
//     JWT secret, when Auth cannot complete the request.
// The fallback is not a shortcut around the property under test: RLS, the column
// grants, the clamp trigger and the ledger trigger are all still exercised
// through PostgREST, and which route was taken is printed rather than hidden.
const stamp = Date.now()
const subjectEmail = `clamp-subject-${stamp}@example.test`
const outsiderEmail = `clamp-outsider-${stamp}@example.test`
const PASSWORD = 'clamp-test-password-1'

const created = []
let dbContainer = null

function sqlExec(sql, { quiet = false } = {}) {
  const args = ['-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-q'] : ['-tA']), '-c', sql]
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, killSignal: 'SIGKILL' }
  if (stack.db) {
    try { return execFileSync('psql', [stack.db, ...args], opts) } catch (e) { if (e.status === undefined) { /* no psql on PATH */ } }
  }
  if (!dbContainer) {
    try {
      const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], opts).split('\n').map((s) => s.trim())
      dbContainer = names.find((n) => /supabase_db_/.test(n)) || null
    } catch { dbContainer = null }
  }
  if (!dbContainer) throw new Error('no psql on PATH and no supabase_db_* container to run SQL in')
  return execFileSync('docker', ['exec', '-i', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', ...args], opts)
}

function mintClientJwt(sub) {
  if (!stack.jwtSecret) throw new Error('the stack JWT secret is unknown, so a client token cannot be minted')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ iss: 'supabase-demo', role: 'authenticated', aud: 'authenticated', sub, iat: now, exp: now + 3600 })
  return `${head}.${body}.${createHmac('sha256', stack.jwtSecret).update(`${head}.${body}`).digest('base64url')}`
}

const routes = []
async function createUser(email) {
  const res = await asService('/auth/v1/admin/users', {
    method: 'POST',
    body: { email, password: PASSWORD, email_confirm: true }
  })
  if (res.ok && res.json?.id) {
    created.push(res.json.id)
    routes.push('auth admin api')
    return res.json.id
  }
  const id = randomUUID()
  sqlExec(`insert into auth.users (id, email, email_confirmed_at) values ('${id}', '${email}', now())`)
  created.push(id)
  routes.push('sql insert + minted token')
  return id
}

async function clientSession(email, id) {
  const signIn = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: stack.anon,
    body: { email, password: PASSWORD }
  })
  if (signIn.status === 200 && typeof signIn.json?.access_token === 'string') return signIn.json.access_token
  return mintClientJwt(id)
}

let subjectId = null
let outsiderId = null
let intentId = null
// Pre-existing state of the column privilege the clamp check needs, so the
// finally block can put back what it found rather than a fixed assumption.
let hadUpdate = null
// Set only if THIS run granted UPDATE. The cleanup takes back only that,
// because a table-level revoke also drops column-level grants this run never
// made.
let grantedUpdate = false
// True when the grant this run made was a two-column grant rather than a
// table-wide one, so the finally block revokes exactly that shape.
let grantedUpdateColumns = false

try {
  subjectId = await createUser(subjectEmail)
  outsiderId = await createUser(outsiderEmail)
  const token = await clientSession(subjectEmail, subjectId)
  note(`accounts: ${routes.join(', ')}`)

  const own = await me(`/rest/v1/users?id=eq.${subjectId}&select=id`, token)
  check('the client presents a token the API accepts, as that user',
    own.status === 200 && own.json?.[0]?.id === subjectId,
    `${own.status} ${own.text.slice(0, 200)}`)
  if (!(own.status === 200 && own.json?.[0]?.id === subjectId)) throw new Error('the client session does not identify the test user')

  const readRow = async (id) => (await asService(
    `/rest/v1/users?id=eq.${id}&select=id,section2_unlocked,section2_free_expires_at,created_at`
  )).json?.[0]

  const before = await readRow(subjectId)
  check('the trial the signup grant made is on the record',
    before !== undefined && before.section2_unlocked === false &&
      Math.abs(new Date(before.section2_free_expires_at) - (new Date(before.created_at).getTime() + 14 * 864e5)) < 6e4,
    JSON.stringify(before))

  const ledger = async (kind, id) => (await asService(
    `/rest/v1/entitlement_grants?kind=eq.${kind}&subject_id=eq.${id}&select=kind,subject_id,reason,reason_source,evidence_id,actor_role,route`
  )).json || []

  const signupGrants = await ledger('section2_trial_14d', subjectId)
  check('the recorder fired on the local stack, with a declared reason',
    signupGrants.length === 1 && signupGrants[0].reason_source === 'declared' &&
      /14-day Section 2 trial/.test(signupGrants[0].reason),
    JSON.stringify(signupGrants))

  // -------------------------------------------------- 1. the client cannot grant
  // return=minimal on purpose: with return=representation PostgREST adds a
  // RETURNING clause over every exposed column, which needs SELECT on
  // display_phone — a grant the chain deliberately withholds, so the refusal
  // would be about reading rather than about the entitlement being frozen.
  const attack = await me(`/rest/v1/users?id=eq.${subjectId}`, token, {
    method: 'PATCH',
    body: { section2_unlocked: true, section2_free_expires_at: '2099-01-01T00:00:00Z' },
    prefer: 'return=minimal'
  })
  const afterAttack = await readRow(subjectId)
  const discarded = afterAttack.section2_unlocked === false &&
    afterAttack.section2_free_expires_at === before.section2_free_expires_at
  note(`client PATCH -> HTTP ${attack.status}${attack.ok ? ' (accepted, then discarded by the clamp)' : ` (refused: ${attack.text.slice(0, 90)})`}`)
  check('a client write to section2_unlocked and the trial expiry is discarded',
    discarded, JSON.stringify({ before, after: afterAttack }))
  check('the discarded write left no grant behind',
    (await ledger('section2_unlock_paid', subjectId)).length === 0)

  // ---------------------------------- 2. the clamp, with privileges out of the way
  // The chain grants UPDATE per column on public.users and gates the rows with
  // the own-row RLS policy; the clamp trigger is the column guard for the
  // server-owned columns. A database can also arrive with UPDATE revoked
  // entirely, and then the
  // write above is refused one layer earlier and the check below would pass even
  // if the clamp had been deleted — a regression test that cannot see the thing
  // it is named after. So UPDATE is made present for the length of this check,
  // the same attempt is made, and the finally block restores the grant state it
  // found. The clamp is then the only thing between a client and the entitlement
  // columns, and the write must still be discarded and still leave no grant.
  let clampTested = false
  try {
    // has_any_column_privilege, not has_table_privilege: the chain grants
    // UPDATE per column, so the table-level probe reports false on a database
    // that is configured correctly — and the cleanup at the end of this script
    // would then revoke the column grants this run never made.
    hadUpdate = sqlExec("select has_any_column_privilege('authenticated', 'public.users', 'UPDATE')").trim() === 't'
    // "UPDATE exists somewhere on the table" is not this check's precondition:
    // the PATCH below writes section2_unlocked and section2_free_expires_at, and
    // on a database the chain configured, the table grant is replaced by column
    // grants that deliberately omit exactly those two. has_any_column_privilege
    // is therefore true while the columns the check writes are not updatable, and
    // the PATCH is refused one layer before the clamp — a FAIL that would read as
    // being about the clamp while actually being about the grant. The two columns
    // are made updatable for the length of this check only, and the finally block
    // revokes exactly those two, which keeps the sole un-doing rule of this script
    // (put back only what it granted, at the same granularity it granted it).
    const columnsUpdatable = sqlExec(
      "select has_column_privilege('authenticated', 'public.users', 'section2_unlocked', 'UPDATE')"
    ).trim() === 't'
    if (!hadUpdate) {
      sqlExec('grant update on public.users to authenticated')
      grantedUpdate = true
    } else if (!columnsUpdatable) {
      sqlExec('grant update (section2_unlocked, section2_free_expires_at) on public.users to authenticated')
      grantedUpdate = true
      grantedUpdateColumns = true
    }
    clampTested = true
  } catch (e) {
    note(`clamp not tested directly: ${String(e.message || e).slice(0, 120)}`)
  }
  if (clampTested) {
    const before2 = await readRow(subjectId)
    const second = await me(`/rest/v1/users?id=eq.${subjectId}`, token, {
      method: 'PATCH',
      body: { section2_unlocked: true, section2_free_expires_at: '2099-01-01T00:00:00Z' },
      prefer: 'return=minimal'
    })
    const after2 = await readRow(subjectId)
    note(`with UPDATE granted, client PATCH -> HTTP ${second.status}`)
    check('the write reaches the table (so the clamp is what decides)',
      second.status === 200 || second.status === 204,
      `${second.status} ${second.text.slice(0, 120)}`)
    check('the clamp discards it anyway: both values are unchanged',
      after2.section2_unlocked === false && after2.section2_free_expires_at === before2.section2_free_expires_at,
      JSON.stringify({ before2, after2 }))
    check('and a discarded client write is not recorded as a grant',
      (await ledger('section2_unlock_paid', subjectId)).length === 0)
  }

  // ---------------------------------------- 3. the client cannot touch another row
  const otherBefore = await readRow(outsiderId)
  const cross = await me(`/rest/v1/users?id=eq.${outsiderId}`, token, {
    method: 'PATCH',
    body: { section2_unlocked: true },
    prefer: 'return=minimal'
  })
  const otherAfter = await readRow(outsiderId)
  note(`client PATCH of another user -> HTTP ${cross.status}${cross.text ? ` (${cross.text.slice(0, 70)})` : ''}`)
  check("a client cannot unlock somebody else's row",
    otherAfter.section2_unlocked === otherBefore.section2_unlocked &&
      otherAfter.section2_unlocked === false &&
      (await ledger('section2_unlock_paid', outsiderId)).length === 0,
    JSON.stringify({ otherBefore, otherAfter }))

  // ------------------------------------------------- 4. the server still unlocks
  const intent = await asService('/rest/v1/payment_intents', {
    method: 'POST',
    body: {
      user_id: subjectId,
      phone: '254700000000',
      amount: 200,
      status: 'succeeded',
      purpose: 'section2',
      unlock_state: 'applied',
      mpesa_transaction_id: `CLAMP-${stamp}`
    },
    prefer: 'return=representation'
  })
  intentId = intent.json?.[0]?.id
  check('a succeeded, applied intent can be written by the service role',
    intent.status === 201 && typeof intentId === 'string',
    `${intent.status} ${intent.text.slice(0, 200)}`)

  const unlock = await asService(`/rest/v1/users?id=eq.${subjectId}`, {
    method: 'PATCH',
    body: { section2_unlocked: true },
    prefer: 'return=representation'
  })
  const unlocked = await readRow(subjectId)
  check('a service-role write still unlocks',
    unlock.status === 200 && unlocked.section2_unlocked === true,
    `${unlock.status} ${unlock.text.slice(0, 200)}`)

  const grants = await ledger('section2_unlock_paid', subjectId)
  check('the unlock is recorded, pointing at the intent that paid for it',
    grants.length === 1 && grants[0].evidence_id === intentId &&
      ['declared', 'evidence'].includes(grants[0].reason_source) &&
      grants[0].actor_role === 'service_role',
    JSON.stringify(grants))

  const anomalies = (await asService(
    `/rest/v1/entitlement_evidence_anomalies?subject_id=eq.${subjectId}&anomaly=eq.paid_unlock_without_evidence&select=anomaly,subject_id,detail`
  )).json || []
  check('and it is not reported as an entitlement without evidence',
    anomalies.length === 0, JSON.stringify(anomalies))
} catch (e) {
  check('the regression test ran to completion', false, String(e.message || e).slice(0, 400))
} finally {
  // The stack is left as it was found: the test accounts, their grants and their
  // intent go. (The ledger has no cascade delete by design, so its rows are
  // removed explicitly — which is also proof they outlive the account.)
  try {
    if (subjectId || outsiderId) {
      await asService(`/rest/v1/entitlement_grants?subject_id=in.(${[subjectId, outsiderId].filter(Boolean).join(',')})`, { method: 'DELETE' })
      await asService(`/rest/v1/entitlement_grants?evidence_id=eq.${intentId}`, { method: 'DELETE' })
    }
    if (intentId) await asService(`/rest/v1/payment_intents?id=eq.${intentId}`, { method: 'DELETE' })
    // The privilege layer this test touched for the clamp check is put back even
    // if the checks above failed early: revoke only what this run granted, and
    // leave a database that already had UPDATE exactly as it was.
    try {
      // Only the grant this run made is taken back. A table-level revoke here
      // would also drop the column-level UPDATE grants the chain issues.
      if (grantedUpdate) {
        sqlExec(grantedUpdateColumns
          ? 'revoke update (section2_unlocked, section2_free_expires_at) on public.users from authenticated'
          : 'revoke update on public.users from authenticated')
      }
    } catch { /* nothing to undo */ }
    for (const id of created) {
      const res = await asService(`/auth/v1/admin/users/${id}`, { method: 'DELETE' })
      // An account created over SQL when Auth would not answer is cleaned up
      // over SQL for the same reason.
      if (!res.ok) { try { sqlExec(`delete from auth.users where id = '${id}'`, { quiet: true }) } catch { /* reported below */ } }
    }
  } catch (e) {
    note(`cleanup left something behind: ${String(e.message || e).slice(0, 160)}`)
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)
