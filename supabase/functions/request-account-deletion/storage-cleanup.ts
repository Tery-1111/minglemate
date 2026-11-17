// Storage cleanup for account deletion.
//
// The only sanctioned way to remove a user's files: the Supabase Storage API.
// NOT `delete from storage.objects` — that removes metadata and orphans the
// physical object, and it is forbidden by the deletion specification.
//
// Design notes:
//   * Buckets are discovered at call time. Nothing about today's
//     (user-photos: 22, profile_photos: 0) is baked in.
//   * Only files strictly under `<userId>/` are touched. A prefix check runs
//     again on every path before removal; a bucket listing that returns
//     someone else's key is a bug, and it is not acted on.
//   * Deletion mutates the listing, so each pass re-lists from offset 0. That
//     is the safe direction: it can re-see a key, never skip one.
//   * Up to 1000 paths per remove() call (the API maximum).
//   * "not found" from remove() is tolerated (a concurrent retry got there
//     first); any other error fails the whole cleanup loudly.

export type StorageClient = {
  storage: {
    listBuckets: () => PromiseLike<{
      data: Array<{ name: string }> | null
      error: { message: string } | null
    }>
    from: (bucket: string) => {
      list: (
        path: string,
        options?: { limit?: number; offset?: number },
      ) => PromiseLike<{
        data: Array<{ name: string; id?: string | null }> | null
        error: { message: string } | null
      }>
      remove: (paths: string[]) => PromiseLike<{
        data: unknown
        error: { message: string } | null
      }>
    }
  }
}

export type CleanupResult = {
  bucketsScanned: number
  filesRemoved: number
  removedPaths: string[]
}

const PAGE_SIZE = 100
const REMOVE_CHUNK = 1000
const MAX_ATTEMPTS = 4

function isNotFound(message: string): boolean {
  return /not\s*found|does not exist|404/i.test(message)
}

// A key inside `users` that is a folder placeholder rather than a file has
// no metadata id. Supabase returns `null` for the id of a prefix; real
// objects carry one. We also skip empty names.
function isFile(entry: { name: string; id?: string | null }): boolean {
  if (!entry.name) return false
  return entry.id !== null && entry.id !== undefined
}

function ownedBy(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`)
}

/** Recursively collect every object path under `prefix` in one bucket. */
async function listAllUnder(
  client: StorageClient,
  bucket: string,
  prefix: string,
  userId: string,
): Promise<string[]> {
  const found = new Set<string>()
  // A work queue of prefixes to expand. Seeded with the user's root.
  const folders: string[] = [prefix]

  while (folders.length > 0) {
    const folder = folders.shift() as string
    let offset = 0

    for (;;) {
      const { data, error } = await client.storage
        .from(bucket)
        .list(folder, { limit: PAGE_SIZE, offset })

      if (error) {
        throw new Error(`list ${bucket}/${folder}: ${error.message}`)
      }
      const page = data ?? []
      if (page.length === 0) break

      for (const entry of page) {
        const full = folder ? `${folder}/${entry.name}` : entry.name
        if (!ownedBy(full, userId)) continue
        if (isFile(entry)) {
          found.add(full)
        } else {
          // A nested folder: descend into it exactly once.
          if (!folders.includes(full)) folders.push(full)
        }
      }

      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }

  return [...found]
}

/**
 * Remove every object belonging to `userId` across all buckets.
 *
 * Throws (never silently succeeds) if a bucket cannot be listed or a removal
 * fails for a reason other than "already gone".
 */
export async function cleanupUserStorage(
  client: StorageClient,
  userId: string,
  log: (msg: string) => void = () => {},
): Promise<CleanupResult> {
  if (!userId) throw new Error('cleanupUserStorage: userId is required')

  const { data: buckets, error } = await client.storage.listBuckets()
  if (error) throw new Error(`listBuckets: ${error.message}`)
  if (!buckets) throw new Error('listBuckets returned no data')

  const result: CleanupResult = {
    bucketsScanned: buckets.length,
    filesRemoved: 0,
    removedPaths: [],
  }

  for (const bucket of buckets) {
    // Repeatedly list-and-remove from zero until the user's prefix is empty
    // or we exhaust attempts. Removal shrinks the set, so re-listing from
    // offset 0 is what prevents a skip.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const paths = await listAllUnder(client, bucket.name, userId, userId)
      if (paths.length === 0) break

      log(`bucket ${bucket.name}: removing ${paths.length} object(s) (attempt ${attempt})`)

      for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
        const chunk = paths.slice(i, i + REMOVE_CHUNK)
        const { error: removeError } = await client.storage
          .from(bucket.name)
          .remove(chunk)

        if (removeError && !isNotFound(removeError.message)) {
          throw new Error(`remove ${bucket.name}: ${removeError.message}`)
        }
      }

      result.filesRemoved += paths.length
      result.removedPaths.push(...paths)

      if (attempt === MAX_ATTEMPTS) {
        // Re-check before declaring victory; a straggler is an error.
        const remaining = await listAllUnder(client, bucket.name, userId, userId)
        if (remaining.length > 0) {
          throw new Error(
            `${bucket.name}: ${remaining.length} object(s) still present after ${MAX_ATTEMPTS} attempts`,
          )
        }
      }
    }
  }

  return result
}
