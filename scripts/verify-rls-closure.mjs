// Regression test: the four precondition tables really are locked, and the
// reads the product needs still work.
//
//   supabase start
//   node scripts/verify-rls-closure.mjs
//
// It runs against a local Supabase stack over the same interface the app uses —
// PostgREST, with the anon key for an anonymous client, a real user JWT for a
// signed-in one, and the service role key for the server — because the property
// under test is not the policy text alone. It is the whole path: the table
// privileges, the RLS enablement, the policies, and the claim PostgREST actually
// sets (auth.uid()).
//
// What it pins, against supabase/migrations/20261015120000_rls_closure_precondition_tables.sql:
//   * photos        — any authenticated user may READ any row (this is what
//                     Discover, the weekly matches and the celebration need);
//                     nobody may read the table anonymously; and a write only
//                     ever lands on the caller's own row;
//   * notifications — a user reads its OWN rows (the path Home.jsx:28 subscribes
//                     to through Realtime) and never another user's; no client
//                     can create one, so no match alert can be forged;
//   * token_purchases — no client can read, insert or alter a purchase; the
//                     service role (payment-callback) still can;
//   * campuses      — an authenticated user reads the directory (the
//                     ProfileSetup lookup) and no client can write it.
//
// Every check asserts the EFFECT — it reads the row back through the service
// role after the attempt — rather than the HTTP status, because what matters is
// whether the row changed, not which of 401/403/empty PostgREST chose.
//
// A regression that dropped a policy, re-created the legacy permissive policies
// ("System can insert notifications", "Public can read campuses") or removed the
// RLS enablement would turn one of these red. Applying the chain WITHOUT the
// closure migration above leaves every table RLS-off, which fails the anonymous
// reads and the forged-insert checks — that is the gap this test exists for.
//
// Connection details come from the environment, or from `supabase status`, so a
// fresh `supabase start` needs no arguments. No dependencies: global fetch only.
//
// Getting a stack to run this against: `supabase start`, then apply the schema.
// The chain converges a database rather than creating one — its header lists the
// app's original tables as preconditions — so on a brand-new stack those come
// first (supabase/.temp/preconditions.sql was used for the run recorded in
// DEPLOYMENT-CHECKLIST.md step 6.12), then the chain, then
// 20261015120000_rls_closure_precondition_tables.sql.

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
  // Several ways to ask, because which one works depends on the machine (an npm
  // shim plus a standalone binary is a real setup, and a bare execFile on Windows
  // skips the npm shim). Mirrors scripts/verify-entitlement-clamp.mjs.
  const commands = ['supabase']
  if (process.platform === 'win32') commands.push('supabase.cmd')
  const attempts = []
  for (const args of [['status', '-o', 'env'], ['status']]) {
    for (const command of commands) {
      attempts.push({ args, command, shell: false })
      attempts.push({ args, command, shell: true })
    }
  }
  for (const { args, command, shell } of attempts) {
    let text = ''
    try {
      // Bounded on purpose: `supabase status` talks to the Docker daemon, and a
      // half-started engine leaves it blocked rather than failing.
      text = shell
        ? execFileSync(`${command} ${args.join(' ')}`, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL', shell: true
          })
        : execFileSync(command, args, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL'
          })
    } catch (e) {
      // A non-zero exit is NOT failure here: `supabase status` exits non-zero
      // while still printing the keys whenever any optional service is stopped.
      text = String(e.stdout || '')
      lastError = String(e.stderr || e.message || '').trim().split('\n').filter((l) => l.trim())[0] || ''
    }
    const parsed = parse(text)
    if (parsed.anon && parsed.service) {
      if (!process.env.SUPABASE_ANON_KEY) {
        console.log(`stack ${parsed.url || DEFAULT_URL} (keys from \`${command} ${args.join(' ')}\`)\n`)
      }
      return { url: parsed.url || DEFAULT_URL, ...parsed }
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
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  return { status: res.status, ok: res.ok, json, text }
}

const asService = (path, opts = {}) => api(path, { ...opts, key: stack.service })
const asAnon = (path, opts = {}) => api(path, { ...opts, key: stack.anon })
const asUser = (path, token, opts = {}) => api(path, { ...opts, key: stack.anon, token })

// ---------------------------------------------------------------- connectivity
{
  const health = await asService('/rest/v1/', { timeoutMs: 2000 }).catch((e) => ({ status: 0, text: String(e) }))
  if (health.status === 0) {
    console.log(`No reachable stack at ${URL_} (${health.text}). Is it running? try: supabase start`)
    process.exit(2)
  }
  // The closure targets precondition tables, so their absence is a setup problem
  // to report, not a failure of the test. Reported per table, because a project
  // without public.campuses is a real, supported state.
  for (const table of ['photos', 'notifications', 'token_purchases', 'campuses']) {
    const probe = await asService(`/rest/v1/${table}?select=*&limit=1`)
    if (probe.status === 404 || /relation .* does not exist/i.test(probe.text)) {
      console.log(`${URL_} answers, but public.${table} does not exist. The closure migration guards each ` +
        'table and skips the ones that are missing, so this run would prove less than it claims. Apply the ' +
        "app's base tables first (supabase/.temp/preconditions.sql), then the chain and the closure.")
      process.exit(2)
    }
  }
  const who = await asService('/rest/v1/users?select=id&limit=1')
  if (who.status === 404 || /relation .* does not exist/i.test(who.text)) {
    console.log(`${URL_} answers, but the app's tables are not there: apply the schema chain first ` +
      '(supabase/migrations/20261014150000_consolidated_schema_chain.sql) and then the closure migration.')
    process.exit(2)
  }
}

// ---------------------------------------------------------------- fixture users
// Created the way the product does it (an auth.users row, so the app's own
// on_auth_user_created trigger runs) and the client then presents a real user
// JWT to PostgREST. Two routes, in this order: the Auth admin API when it
// answers, and the row written over SQL plus a token signed with the stack's own
// JWT secret when Auth cannot complete the request. The fallback is not a
// shortcut around the property under test — RLS, the grants and the policies are
// all still exercised through PostgREST — and which route was taken is printed
// rather than hidden.
const stamp = Date.now()
const subjectEmail = `rls-subject-${stamp}@example.test`
const outsiderEmail = `rls-outsider-${stamp}@example.test`
const PASSWORD = 'rls-closure-test-password-1'
const CAMPUS_DOMAIN = `rls-${stamp}.example.test`

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

// --------------------------------------------------------------------- fixtures
let subjectId = null       // the signed-in client under test
let outsiderId = null      // a second user, whose rows must not be reachable
let campusId = null
let photoId = null
let purchaseId = null

// Read back through the service role: the effect, not the status code.
const rows = async (path) => {
  const res = await asService(path)
  return res.json || []
}

try {
  subjectId = await createUser(subjectEmail)
  outsiderId = await createUser(outsiderEmail)
  const token = await clientSession(subjectEmail, subjectId)
  note(`accounts: ${routes.join(', ')}`)

  const own = await asUser(`/rest/v1/users?id=eq.${subjectId}&select=id`, token)
  check('the client presents a token the API accepts, as that user',
    own.status === 200 && own.json?.[0]?.id === subjectId,
    `${own.status} ${own.text.slice(0, 200)}`)
  if (!(own.status === 200 && own.json?.[0]?.id === subjectId)) throw new Error('the client session does not identify the test user')

  // Seed one row per table through the service role (the shape the server writes).
  const photo = await asService('/rest/v1/photos', {
    method: 'POST',
    body: { user_id: outsiderId, photo_url: `https://example.test/${stamp}.jpg`, photo_type: 'facial' },
    prefer: 'return=representation'
  })
  photoId = photo.json?.[0]?.id
  check('a photo row can be seeded by the service role', photo.status === 201 && typeof photoId === 'string',
    `${photo.status} ${photo.text.slice(0, 200)}`)

  const notification = await asService('/rest/v1/notifications', {
    method: 'POST',
    body: { user_id: subjectId, message: 'rls closure fixture' },
    prefer: 'return=representation'
  })
  const notificationId = notification.json?.[0]?.id
  const outsiderNotification = await asService('/rest/v1/notifications', {
    method: 'POST',
    body: { user_id: outsiderId, message: 'rls closure fixture (outsider)' },
    prefer: 'return=representation'
  })
  const outsiderNotificationId = outsiderNotification.json?.[0]?.id

  const campus = await asService('/rest/v1/campuses', {
    method: 'POST',
    body: { name: `RLS Test Campus ${stamp}`, email_domain: CAMPUS_DOMAIN },
    prefer: 'return=representation'
  })
  campusId = campus.json?.[0]?.id
  check('a campus row can be seeded by the service role (the admin_add_campus path)',
    campus.status === 201 && typeof campusId === 'string', `${campus.status} ${campus.text.slice(0, 200)}`)

  const purchase = await asService('/rest/v1/token_purchases', {
    method: 'POST',
    body: { user_id: outsiderId, amount: 200, mpesa_transaction_id: `RLS-${stamp}`, status: 'completed' },
    prefer: 'return=representation'
  })
  purchaseId = purchase.json?.[0]?.id
  check('a purchase row can be written by the service role (the payment-callback path)',
    purchase.status === 201 && typeof purchaseId === 'string', `${purchase.status} ${purchase.text.slice(0, 200)}`)

  // ---------------------------------------------------------------- anonymous
  const anonPhotos = await asAnon('/rest/v1/photos?select=id')
  check('an anonymous client cannot read photos',
    anonPhotos.status >= 400 || (anonPhotos.json || []).length === 0,
    `${anonPhotos.status} ${anonPhotos.text.slice(0, 200)}`)

  const anonNotifications = await asAnon('/rest/v1/notifications?select=id')
  check('an anonymous client cannot read notifications',
    anonNotifications.status >= 400 || (anonNotifications.json || []).length === 0,
    `${anonNotifications.status} ${anonNotifications.text.slice(0, 200)}`)

  const anonPurchases = await asAnon('/rest/v1/token_purchases?select=id')
  check('an anonymous client cannot read token_purchases',
    anonPurchases.status >= 400 || (anonPurchases.json || []).length === 0,
    `${anonPurchases.status} ${anonPurchases.text.slice(0, 200)}`)

  // ------------------------------------------------------------------- photos
  // The read every card, the celebration and the weekly matches depend on.
  const readOtherPhoto = await asUser(
    `/rest/v1/photos?id=eq.${photoId}&select=id,user_id,photo_url`, token)
  check('an authenticated user can read another user\'s photo row (Discover, the weekly matches, the celebration)',
    readOtherPhoto.status === 200 && readOtherPhoto.json?.[0]?.id === photoId,
    `${readOtherPhoto.status} ${readOtherPhoto.text.slice(0, 200)}`)

  // A write aimed at someone else's row must not land.
  const forgePhoto = await asUser('/rest/v1/photos', token, {
    method: 'POST',
    body: { user_id: outsiderId, photo_url: 'https://example.test/forged.jpg', photo_type: 'full_body' },
    prefer: 'return=representation'
  })
  const forgedRows = await rows(`/rest/v1/photos?user_id=eq.${outsiderId}&photo_type=eq.full_body&select=id`)
  check('a client cannot insert a photo row for another user',
    forgedRows.length === 0,
    `${forgePhoto.status} ${forgePhoto.text.slice(0, 200)}`)

  const repoint = await asUser(`/rest/v1/photos?id=eq.${photoId}`, token, {
    method: 'PATCH',
    body: { photo_url: 'https://example.test/stolen.jpg' },
    prefer: 'return=representation'
  })
  const stillOriginal = await rows(`/rest/v1/photos?id=eq.${photoId}&select=photo_url`)
  check('a client cannot update another user\'s photo row',
    stillOriginal[0]?.photo_url === `https://example.test/${stamp}.jpg`,
    `${repoint.status} ${repoint.text.slice(0, 200)} ${JSON.stringify(stillOriginal)}`)

  const removeOther = await asUser(`/rest/v1/photos?id=eq.${photoId}`, token, { method: 'DELETE' })
  const survivedDelete = await rows(`/rest/v1/photos?id=eq.${photoId}&select=id`)
  check('a client cannot delete another user\'s photo row',
    survivedDelete.length === 1,
    `${removeOther.status} ${removeOther.text.slice(0, 200)}`)

  // The owner's own upsert (PhotoUpload.jsx:82 / Photos.jsx:106) must still work.
  const ownUpsert = await asUser('/rest/v1/photos?on_conflict=user_id,photo_type', token, {
    method: 'POST',
    body: { user_id: subjectId, photo_url: `https://example.test/own-${stamp}.jpg`, photo_type: 'facial' },
    prefer: 'resolution=merge-duplicates,return=representation'
  })
  const ownRows = await rows(`/rest/v1/photos?user_id=eq.${subjectId}&select=id,photo_url`)
  check('the owner can still upsert their own photo row',
    ownUpsert.status < 300 && ownRows.length === 1 && /own-/.test(ownRows[0]?.photo_url || ''),
    `${ownUpsert.status} ${ownUpsert.text.slice(0, 200)} ${JSON.stringify(ownRows)}`)

  // ------------------------------------------------------------ notifications
  const ownNotification = await asUser(`/rest/v1/notifications?id=eq.${notificationId}&select=id,user_id`, token)
  check('a user reads their own notifications (the Home.jsx alert path)',
    ownNotification.status === 200 && ownNotification.json?.[0]?.id === notificationId,
    `${ownNotification.status} ${ownNotification.text.slice(0, 200)}`)

  const otherNotification = await asUser(`/rest/v1/notifications?id=eq.${outsiderNotificationId}&select=id`, token)
  check('a user cannot read another user\'s notifications',
    otherNotification.status >= 400 || (otherNotification.json || []).length === 0,
    `${otherNotification.status} ${otherNotification.text.slice(0, 200)}`)

  const forgeNotification = await asUser('/rest/v1/notifications', token, {
    method: 'POST',
    body: { user_id: outsiderId, message: 'New Match Alert: forged' },
    prefer: 'return=representation'
  })
  const forgedNotifications = await rows(
    `/rest/v1/notifications?user_id=eq.${outsiderId}&message=eq.New Match Alert: forged&select=id`)
  check('no client can forge a notification (the legacy "System can insert notifications" policy is gone)',
    forgedNotifications.length === 0,
    `${forgeNotification.status} ${forgeNotification.text.slice(0, 200)}`)

  // ----------------------------------------------------------- token_purchases
  const readPurchase = await asUser(`/rest/v1/token_purchases?id=eq.${purchaseId}&select=id,amount`, token)
  check('a client cannot read a purchase row',
    readPurchase.status >= 400 || (readPurchase.json || []).length === 0,
    `${readPurchase.status} ${readPurchase.text.slice(0, 200)}`)

  const forgePurchase = await asUser('/rest/v1/token_purchases', token, {
    method: 'POST',
    body: { user_id: subjectId, amount: 200, mpesa_transaction_id: `FORGED-${stamp}`, status: 'completed' },
    prefer: 'return=representation'
  })
  const forgedPurchases = await rows(
    `/rest/v1/token_purchases?mpesa_transaction_id=eq.FORGED-${stamp}&select=id`)
  check('no client can insert a purchase (a completed payment cannot be forged)',
    forgedPurchases.length === 0,
    `${forgePurchase.status} ${forgePurchase.text.slice(0, 200)}`)

  const tamper = await asUser(`/rest/v1/token_purchases?id=eq.${purchaseId}`, token, {
    method: 'PATCH', body: { amount: 1 }, prefer: 'return=representation'
  })
  const amountAfter = await rows(`/rest/v1/token_purchases?id=eq.${purchaseId}&select=amount`)
  check('no client can alter a purchase amount',
    Number(amountAfter[0]?.amount) === 200,
    `${tamper.status} ${tamper.text.slice(0, 200)} ${JSON.stringify(amountAfter)}`)

  // ------------------------------------------------------------------ campuses
  const campusLookup = await asUser(
    `/rest/v1/campuses?email_domain=eq.${CAMPUS_DOMAIN}&select=id,name`, token)
  check('the authenticated campus lookup still resolves (ProfileSetup.jsx:45)',
    campusLookup.status === 200 && campusLookup.json?.[0]?.id === campusId,
    `${campusLookup.status} ${campusLookup.text.slice(0, 200)}`)

  const forgeCampus = await asUser('/rest/v1/campuses', token, {
    method: 'POST',
    body: { name: 'Forged Campus', email_domain: `forged-${stamp}.example.test` },
    prefer: 'return=representation'
  })
  const forgedCampuses = await rows(
    `/rest/v1/campuses?email_domain=eq.forged-${stamp}.example.test&select=id`)
  check('no client can insert a campus',
    forgedCampuses.length === 0,
    `${forgeCampus.status} ${forgeCampus.text.slice(0, 200)}`)

  const flipCampus = await asUser(`/rest/v1/campuses?id=eq.${campusId}`, token, {
    method: 'PATCH', body: { matching_enabled: false }, prefer: 'return=representation'
  })
  const campusAfter = await rows(`/rest/v1/campuses?id=eq.${campusId}&select=matching_enabled`)
  check('no client can flip a campus flag (the admin_* RPCs still can)',
    campusAfter[0]?.matching_enabled !== false,
    `${flipCampus.status} ${flipCampus.text.slice(0, 200)} ${JSON.stringify(campusAfter)}`)
} catch (e) {
  check('the regression test ran to completion', false, String(e.message || e).slice(0, 400))
} finally {
  // The stack is left as it was found. Anonymising rather than deleting the
  // auth rows would leave the fixture content behind, so the seeded rows and the
  // test accounts all go.
  try {
    if (photoId) await asService(`/rest/v1/photos?id=eq.${photoId}`, { method: 'DELETE' })
    if (subjectId) await asService(`/rest/v1/photos?user_id=eq.${subjectId}`, { method: 'DELETE' })
    if (subjectId) await asService(`/rest/v1/notifications?user_id=eq.${subjectId}`, { method: 'DELETE' })
    if (outsiderId) await asService(`/rest/v1/notifications?user_id=eq.${outsiderId}`, { method: 'DELETE' })
    if (purchaseId) await asService(`/rest/v1/token_purchases?id=eq.${purchaseId}`, { method: 'DELETE' })
    if (campusId) await asService(`/rest/v1/campuses?id=eq.${campusId}`, { method: 'DELETE' })
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
