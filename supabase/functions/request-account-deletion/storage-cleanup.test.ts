// Run with:  deno test supabase/functions/request-account-deletion/storage-cleanup.test.ts
// (also runs under Node 24 via the scripts/run-storage-tests.mjs shim, which
// provides the two asserts used here.)

import { cleanupUserStorage, type StorageClient } from './storage-cleanup.ts'

// ---------- tiny assert helpers (Deno-compatible) ----------

function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`)
}

function assertRejects(fn: () => Promise<unknown>, match: RegExp) {
  return fn().then(
    () => {
      throw new Error(`expected rejection matching ${match}`)
    },
    (err: Error) => {
      if (!match.test(err.message)) {
        throw new Error(`rejection "${err.message}" did not match ${match}`)
      }
    },
  )
}

// ---------- an in-memory Storage API ----------
//
// Mirrors the parts of the Supabase Storage JS client the helper uses:
// listBuckets / from(bucket).list(folder, {limit, offset}) / remove(paths).
// Folder placeholders carry id === null, exactly like the real API.

type FakeOptions = {
  listError?: string
  removeErrorFor?: (path: string) => string | undefined
  pageCap?: number // force small pages to exercise pagination
}

function fakeStorage(
  bucketFiles: Record<string, string[]>,
  opts: FakeOptions = {},
): { client: StorageClient; removed: string[]; calls: string[] } {
  const files = new Map<string, Set<string>>()
  for (const [b, list] of Object.entries(bucketFiles)) files.set(b, new Set(list))
  const removed: string[] = []
  const calls: string[] = []
  const pageCap = opts.pageCap ?? 1000

  const client: StorageClient = {
    storage: {
      listBuckets: async () => ({
        data: Object.keys(bucketFiles).map((name) => ({ name })),
        error: null,
      }),
      from: (bucket: string) => ({
        list: async (folder: string, options?: { limit?: number; offset?: number }) => {
          calls.push(`list:${bucket}:${folder}:${options?.offset ?? 0}`)
          if (opts.listError) return { data: null, error: { message: opts.listError } }

          const set = files.get(bucket) ?? new Set<string>()
          const prefix = folder ? `${folder}/` : ''
          // Immediate children only, like the real API.
          const children = new Map<string, { name: string; id: string | null }>()
          for (const path of set) {
            if (!path.startsWith(prefix)) continue
            const rest = path.slice(prefix.length)
            if (!rest) continue
            const slash = rest.indexOf('/')
            if (slash === -1) children.set(rest, { name: rest, id: `id-${rest}` })
            else {
              const folderName = rest.slice(0, slash)
              children.set(folderName, { name: folderName, id: null })
            }
          }
          const all = [...children.values()]
          const limit = Math.min(options?.limit ?? 100, pageCap)
          const offset = options?.offset ?? 0
          return { data: all.slice(offset, offset + limit), error: null }
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            const custom = opts.removeErrorFor?.(p)
            if (custom) return { data: null, error: { message: custom } }
            files.get(bucket)?.delete(p)
            removed.push(p)
          }
          return { data: paths.map((p) => ({ name: p })), error: null }
        },
      }),
    },
  }
  return { client, removed, calls }
}

const U = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

// ---------- tests ----------

Deno.test('empty bucket: nothing removed, reports bucket scanned', async () => {
  const { client, removed } = fakeStorage({ 'user-photos': [] })
  const out = await cleanupUserStorage(client, U)
  assertEquals(removed, [], 'no removals')
  assertEquals(out.bucketsScanned, 1, 'scanned one bucket')
  assertEquals(out.filesRemoved, 0, 'removed none')
})

Deno.test('no buckets at all', async () => {
  const { client } = fakeStorage({})
  const out = await cleanupUserStorage(client, U)
  assertEquals(out.bucketsScanned, 0, 'no buckets')
  assertEquals(out.filesRemoved, 0, 'removed none')
})

Deno.test('one file', async () => {
  const { client, removed } = fakeStorage({ 'user-photos': [`${U}/a.jpg`] })
  const out = await cleanupUserStorage(client, U)
  assertEquals(removed, [`${U}/a.jpg`], 'removed the file')
  assertEquals(out.filesRemoved, 1, 'count is 1')
})

Deno.test('multiple files', async () => {
  const files = [1, 2, 3, 4, 5].map((n) => `${U}/p${n}.jpg`)
  const { client, removed } = fakeStorage({ 'user-photos': files })
  const out = await cleanupUserStorage(client, U)
  assertEquals([...removed].sort(), [...files].sort(), 'all five')
  assertEquals(out.filesRemoved, 5, 'count is 5')
})

Deno.test('nested directories are descended recursively', async () => {
  const files = [`${U}/top.jpg`, `${U}/album/one.jpg`, `${U}/album/deep/two.jpg`]
  const { client, removed } = fakeStorage({ 'profile_photos': files })
  await cleanupUserStorage(client, U)
  assertEquals([...removed].sort(), [...files].sort(), 'every nested file')
})

Deno.test('more than 100 objects are all removed (pagination)', async () => {
  const files = Array.from({ length: 250 }, (_, i) => `${U}/f${i}.jpg`)
  const { client, removed, calls } = fakeStorage({ 'user-photos': files }, { pageCap: 100 })
  await cleanupUserStorage(client, U)
  assertEquals(removed.length, 250, 'all 250 removed')
  const sawOffset = calls.some((c) => !c.endsWith(':0'))
  assertEquals(sawOffset, true, 'paged past the first page')
})

Deno.test('more than 1000 objects chunk removals but remove everything', async () => {
  const files = Array.from({ length: 1200 }, (_, i) => `${U}/g${i}.jpg`)
  const { client, removed } = fakeStorage({ 'user-photos': files }, { pageCap: 100 })
  const out = await cleanupUserStorage(client, U)
  assertEquals(removed.length, 1200, 'all removed across chunks')
  assertEquals(out.filesRemoved, 1200, 'count matches')
})

Deno.test('does NOT touch another user\'s files', async () => {
  const mine = [`${U}/mine.jpg`]
  const theirs = [`${OTHER}/theirs.jpg`, `x${U}/lookalike.jpg`, `${U}-suffix/evil.jpg`]
  const { client, removed } = fakeStorage({ 'user-photos': [...mine, ...theirs] })
  await cleanupUserStorage(client, U)
  assertEquals(removed, mine, 'only the exact user prefix')
})

Deno.test('listing failure throws and removes nothing', async () => {
  const { client, removed } = fakeStorage({ 'user-photos': [`${U}/a.jpg`] }, {
    listError: 'network down',
  })
  await assertRejects(() => cleanupUserStorage(client, U), /list user-photos/)
  assertEquals(removed, [], 'nothing was removed')
})

Deno.test('removal failure throws (no false success)', async () => {
  const { client } = fakeStorage({ 'user-photos': [`${U}/a.jpg`, `${U}/b.jpg`] }, {
    removeErrorFor: (p) => (p.endsWith('a.jpg') ? 'permission denied' : undefined),
  })
  await assertRejects(() => cleanupUserStorage(client, U), /remove user-photos/)
})

Deno.test('"not found" on removal is tolerated (concurrent retry)', async () => {
  const { client, removed } = fakeStorage({ 'user-photos': [`${U}/gone.jpg`] }, {
    removeErrorFor: () => 'Object not found',
  })
  // remove() rejects nothing, so the set never shrinks; the retry loop must
  // still terminate with the explicit "still present" error rather than hang.
  await assertRejects(() => cleanupUserStorage(client, U), /still present/)
  assertEquals(removed, [], 'the API removed nothing')
})

Deno.test('retry after partial cleanup succeeds (idempotent)', async () => {
  const files = [`${U}/1.jpg`, `${U}/2.jpg`]
  const first = fakeStorage({ 'user-photos': files })
  await cleanupUserStorage(first.client, U)

  // Second run against the now-empty bucket is a clean no-op.
  const second = fakeStorage({ 'user-photos': [] })
  const out = await cleanupUserStorage(second.client, U)
  assertEquals(out.filesRemoved, 0, 'second run removes nothing')
})

Deno.test('scans every bucket, not just the known ones', async () => {
  const { client, removed } = fakeStorage({
    'user-photos': [`${U}/a.jpg`],
    'profile_photos': [],
    'a-bucket-added-later': [`${U}/later.jpg`],
  })
  const out = await cleanupUserStorage(client, U)
  assertEquals(out.bucketsScanned, 3, 'discovered all three')
  assertEquals([...removed].sort(), [`${U}/a.jpg`, `${U}/later.jpg`], 'both buckets cleaned')
})
