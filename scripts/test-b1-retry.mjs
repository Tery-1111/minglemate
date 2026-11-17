// B1 tests for the Edge Function's account-deletion orchestration.
//
//   node scripts/test-b1-retry.mjs
//
// The function imports Deno-only modules, so this loads a mechanically
// transformed copy of the REAL file (imports stripped, serve() tail dropped,
// serviceClient() allowed to return an injected fake). The transformation is
// asserted below, so a future edit cannot silently make these tests vacuous.
// No logic is re-implemented here: every scenario calls the real handle().

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const REAL = new URL('../supabase/functions/request-account-deletion/index.ts', import.meta.url)
const src = readFileSync(REAL, 'utf8')

const serveIdx = src.indexOf('serve(async (req)')
assert.ok(serveIdx > 0, 'serve() entrypoint must exist in the real file')
assert.ok(src.includes('async function handle(req: Request)'), 'handle() must exist')

const transformed = src
  .slice(0, serveIdx)
  .replace(/import .*?from 'https:\/\/[^']+'\n/g, '')
  .replace(/import .*?from '\.\/storage-cleanup\.ts'\n/g, '')
  // Let the test inject the admin client instead of reading Deno env.
  .replace(
    'function serviceClient() {\n  const url = Deno.env.get',
    'function serviceClient() {\n  if (globalThis.__admin) return globalThis.__admin\n  const url = Deno.env.get',
  )
  // The authenticated client is used only to call request_account_deletion().
  // Point it at the same fake so the RPC sequence is observable in the tests.
  .replace(
    'function userClient(token: string) {',
    'function userClient(token: string) {\n  if (globalThis.__admin) return globalThis.__admin\n  return userClientReal(token)\n}\nfunction userClientReal(token: string) {',
  )

assert.ok(transformed.includes('globalThis.__admin'), 'injection point must exist — update this test if serviceClient() changes')
assert.ok(!transformed.includes("from 'https://"), 'all remote imports must be stripped')

const dir = mkdtempSync(join(tmpdir(), 'b1-'))
writeFileSync(join(dir, 'package.json'), '{"type":"module"}', 'utf8')
const modPath = join(dir, 'fn.ts')
writeFileSync(
  modPath,
  `globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://fake.local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' })[k] ?? null } }
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary')
// storage-cleanup has its own suite; here it only needs to succeed so the
// orchestration under test can run. Its real behaviour is NOT re-tested here.
async function cleanupUserStorage(client, userId) {
  const { data, error } = await client.storage.listBuckets()
  if (error) throw new Error('listBuckets: ' + error.message)
  for (const b of data ?? []) {
    const check = client.storage.from(b.name)
    const listed = await check.list(userId)
    if (listed.error) throw new Error('list: ' + listed.error.message)
    const paths = (listed.data ?? []).map((e) => userId + '/' + e.name)
    if (paths.length) await check.remove(paths)
  }
  return { filesRemoved: 0, bucketsScanned: (data ?? []).length, removedPaths: [] }
}
const m = (async () => {
${transformed}
  return { handle }
})()
export default (await m)
`,
  'utf8',
)
const { handle } = (await import(pathToFileURL(modPath).href)).default
rmSync(dir, { recursive: true, force: true })

// ---------------------------------------------------------------------
const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function jwt(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`
}

function makeAdmin(s) {
  const admin = {
    auth: {
      getUser: async () => { s.calls.push('getUser'); return s.getUser },
      admin: {
        deleteUser: async (id) => {
          s.calls.push(`deleteUser:${id}`)
          return s.onDelete ? s.onDelete(id) : (s.deleteUser ?? { data: {}, error: null })
        },
        signOut: async () => { s.calls.push('signOut'); return { data: null, error: null } },
      },
    },
    rpc: async (fn, args) => {
      s.calls.push(`rpc:${fn}`)
      return (s.rpc && s.rpc[fn]) ?? { data: null, error: null }
    },
    // storage is exercised by its own suite; here it must simply succeed so the
    // orchestration under test can proceed.
    storage: {
      listBuckets: async () => { s.calls.push('storage:listBuckets'); return { data: [{ name: 'user-photos' }], error: null } },
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
    from: (table) => {
      s.calls.push(`from:${table}`)
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: async () => s.requestRow ?? { data: null, error: null },
      }
      return c
    },
  }
  return admin
}

async function call(token) {
  const req = {
    method: 'POST',
    headers: { get: (k) => (k.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
  }
  const res = await handle(req)
  return { status: res.status, body: JSON.parse(await res.text()) }
}

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`FAIL  ${name}\n      ${e.message}`)
  }
}

const token = jwt(USER)

await test('B1-1 successful deletion: delete happens, success is reported', async () => {
  const s = {
    calls: [],
    getUser: { data: { user: { id: USER } }, error: null },
    rpc: { finalize_account_deletion: { data: true, error: null } },
  }
  globalThis.__admin = makeAdmin(s)
  const resRaw = await call(token)
  const { status, body } = resRaw
  if (status !== 200) console.error('DEBUG B1-1 status', status, JSON.stringify(body))
  assert.equal(status, 200)
  assert.deepEqual(body, { success: true, pending: false })
  assert.ok(s.calls.includes(`deleteUser:${USER}`), 'auth user deleted')
  const del = s.calls.findIndex((c) => c.startsWith('deleteUser'))
  const rev = s.calls.indexOf('signOut')
  if (rev !== -1) assert.ok(rev > del, 'revocation must run AFTER deletion, never before')
})

await test('B1-2 auth delete fails, then a genuine retry succeeds', async () => {
  let attempt = 0
  const s = {
    calls: [],
    getUser: { data: { user: { id: USER } }, error: null },
    rpc: { finalize_account_deletion: { data: true, error: null } },
    onDelete: () => {
      attempt++
      return attempt === 1
        ? { error: { message: 'transient auth outage' } }
        : { data: {}, error: null }
    },
  }
  globalThis.__admin = makeAdmin(s)

  const first = await call(token)
  assert.equal(first.status, 500)
  assert.deepEqual(first.body, { success: false, pending: true, error: 'auth_delete_failed' })
  assert.ok(!s.calls.includes('signOut'), 'session must NOT be revoked on failure (this was the B1 defect)')

  const second = await call(token)
  assert.equal(second.status, 200)
  assert.deepEqual(second.body, { success: true, pending: false }, 'retry with the same live session completes')
})

await test('B1-3 lost response after successful auth delete is recovered without re-auth', async () => {
  // The user is already gone, so getUser() fails. The request row says db_finalized.
  const s = {
    calls: [],
    getUser: { data: null, error: { message: 'User not found' } },
    requestRow: { data: { status: 'db_finalized' }, error: null },
    onDelete: () => ({ error: { message: 'not found' } }), // already deleted
  }
  globalThis.__admin = makeAdmin(s)
  const { status, body } = await call(token)
  assert.equal(status, 200)
  assert.deepEqual(body, { success: true, pending: false }, 'completed deletion is reported truthfully')
  assert.ok(s.calls.includes('from:account_deletion_requests'), 'recovery consulted the deletion state')
})

await test('B1-3b lost response with unfinished work asks for re-auth, never claims success', async () => {
  const s = {
    calls: [],
    getUser: { data: null, error: { message: 'User not found' } },
    requestRow: { data: { status: 'processing' }, error: null },
  }
  globalThis.__admin = makeAdmin(s)
  const { status, body } = await call(token)
  assert.equal(status, 401)
  assert.equal(body.success, false)
  assert.equal(body.pending, true)
  assert.equal(body.error, 'session_expired')
})

await test('B1-3c a token whose subject has NO deletion request is simply unauthenticated', async () => {
  const s = {
    calls: [],
    getUser: { data: null, error: { message: 'User not found' } },
    requestRow: { data: null, error: null },
  }
  globalThis.__admin = makeAdmin(s)
  const { status, body } = await call(token)
  assert.equal(status, 401)
  assert.equal(body.error, 'unauthenticated')
})

await test('B1-4 duplicate deletion request is idempotent', async () => {
  let n = 0
  const s = {
    calls: [],
    getUser: { data: { user: { id: USER } }, error: null },
    rpc: { finalize_account_deletion: { data: true, error: null } },
    onDelete: () => {
      n++
      return n === 1 ? { data: {}, error: null } : { error: { message: 'not found' } }
    },
    requestRow: { data: { status: 'db_finalized' }, error: null },
  }
  globalThis.__admin = makeAdmin(s)

  // First run deletes. Second run: auth already gone -> recovery path.
  const first = await call(token)
  assert.equal(first.status, 200)

  s.getUser = { data: null, error: { message: 'User not found' } }
  const second = await call(token)
  assert.equal(second.status, 200)
  assert.deepEqual(second.body, { success: true, pending: false }, 'repeat is a safe no-op')
})

await test('B1-5 the function never deletes an account other than the token subject', async () => {
  const s = {
    calls: [],
    getUser: { data: { user: { id: OTHER } }, error: null },
    rpc: { finalize_account_deletion: { data: true, error: null } },
  }
  globalThis.__admin = makeAdmin(s)
  // A token for OTHER is presented; USER must never be touched.
  const { body } = await call(jwt(OTHER))
  assert.equal(body.success, true)
  assert.ok(s.calls.includes(`deleteUser:${OTHER}`))
  assert.ok(!s.calls.includes(`deleteUser:${USER}`), 'no cross-account deletion')
  // Every finalize call targets the token subject only.
  assert.deepEqual(
    s.calls.filter((c) => c.startsWith('rpc:finalize_account_deletion')),
    ['rpc:finalize_account_deletion'],
  )
})

await test('B1-6 a request with no Bearer token is rejected without touching anything', async () => {
  const s = { calls: [], getUser: { data: { user: { id: USER } }, error: null } }
  globalThis.__admin = makeAdmin(s)
  const res = await handle({ method: 'POST', headers: { get: () => null } })
  assert.equal(res.status, 401)
  assert.equal(s.calls.length, 0, 'no admin call is made for an unauthenticated request')
})

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log('==================================')
console.log(`Passed: ${passed}   Failed: ${failed}   Total: ${results.length}`)
process.exit(failed === 0 ? 0 : 1)
