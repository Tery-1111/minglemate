import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cleanupUserStorage, type StorageClient } from './storage-cleanup.ts'

// Orchestrates two-phase account deletion for the signed-in user.
//
// ORDER (fixed; each step only runs if the previous one succeeded):
//   1. verify the Bearer token                 -> the ONLY source of identity
//   2. request_account_deletion()  (as user)   -> record, pause, mute. No deletes
//   3. Storage API cleanup         (service)   -> remove the user's files
//   4. finalize_account_deletion() (service)   -> anonymise, detach, drop public row
//   5. delete the auth user (service)          -> LAST destructive step
//      (an explicit session revoke runs only AFTER this succeeds; revoking
//       first destroyed the session and broke retry after a failed delete)
//
// Two clients on purpose. The request RPC must run as the real user so the
// server derives identity from auth.uid(); everything after needs the
// service role. A body-supplied user id is never read for authorisation.
//
// Failure is retryable and truthful: a failure at step k leaves the request
// row, keeps the profile paused, and returns { success: false, pending: true }.
// The finalizer is idempotent, so a retry after step 4 landed is safe — and
// because the auth user is deleted last and the session is never revoked
// early, a retry still has a valid session.
//
// LOST RESPONSE: if a previous attempt completed the database finalisation and
// the auth delete but the client never received the 200, the next request
// arrives with a token whose user no longer exists. `getUser()` fails, so the
// function falls back to recoverAfterLostResponse(), which identifies the
// caller from the token's own signed `sub` claim and requires a db_finalized
// request row for that exact subject before reporting success.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Safe to show a user; never contains SQL, stack traces or secrets.
function fail(status: number, code: string): Response {
  return json({ success: false, pending: true, error: code }, status)
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('service credentials unavailable')
  return createClient(url, key, { auth: { persistSession: false } })
}

function userClient(token: string) {
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) throw new Error('anon credentials unavailable')
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // ---- 1. identity from the verified token only ----
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return json({ success: false, pending: true, error: 'unauthenticated' }, 401)

  let admin
  let userId: string
  try {
    admin = serviceClient()
  } catch (err) {
    console.error('config', (err as Error).message)
    return fail(500, 'server_misconfigured')
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token)

  if (userError || !userData?.user?.id) {
    // ---- Loss-of-response recovery ----
    // A previous attempt may have completed everything except the HTTP reply
    // (or deleted the auth user but the client never saw the 200). In that
    // case getUser() fails because the USER IS GONE, not because the caller is
    // untrusted. We still must not trust a client-supplied id, so the caller is
    // identified from the token's own `sub` claim, and only then may we finish.
    // Nothing here can delete a different account: the sub is signed by Supabase
    // and the request row proves this exact user already asked to be deleted.
    const recovered = await recoverAfterLostResponse(admin, token)
    if (recovered) return recovered

    return json({ success: false, pending: true, error: 'unauthenticated' }, 401)
  }

  userId = userData.user.id

  // ---- 2. phase 1: authenticated request RPC ----
  try {
    const asUser = userClient(token)
    const { error } = await asUser.rpc('request_account_deletion')
    if (error) {
      console.error('request rpc failed', { user: userId, error: error.message })
      // 401-ish means the session lapsed; tell the user to sign in again.
      if (/jwt|unauthor|not authenticated|28000/i.test(error.message)) {
        return json({ success: false, pending: true, error: 'session_expired' }, 401)
      }
      return fail(500, 'request_failed')
    }
  } catch (err) {
    console.error('request rpc threw', { user: userId, error: (err as Error).message })
    return fail(500, 'request_failed')
  }

  // ---- 3. storage cleanup (before any DB finalisation) ----
  try {
    const cleanup = await cleanupUserStorage(
      admin as unknown as StorageClient,
      userId,
      (msg) => console.log(msg),
    )
    console.log(`storage: ${cleanup.filesRemoved} object(s) across ${cleanup.bucketsScanned} bucket(s)`)
  } catch (err) {
    const message = (err as Error).message
    console.error('storage cleanup failed', { user: userId, error: message })
    await recordFailure(admin, userId, `storage: ${message}`)
    return fail(502, 'storage_cleanup_failed')
  }

  // ---- 4. database finalisation ----
  try {
    const { data, error } = await admin.rpc('finalize_account_deletion', {
      p_user_id: userId,
    })
    if (error || data !== true) {
      console.error('finalize failed', { user: userId, error: error?.message ?? 'returned false' })
      await recordFailure(admin, userId, `finalize: ${error?.message ?? 'false'}`)
      return fail(500, 'finalize_failed')
    }
  } catch (err) {
    console.error('finalize threw', { user: userId, error: (err as Error).message })
    await recordFailure(admin, userId, `finalize: ${(err as Error).message}`)
    return fail(500, 'finalize_failed')
  }

  // ---- 5. delete the auth user LAST ----
  // Revocation deliberately does NOT happen before this point. Revoking first
  // destroyed the session, so a failed deleteUser() left the user unable to
  // authenticate and retry. Deleting the user invalidates every session
  // anyway, so an explicit revoke is not needed for the success path.
  try {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      console.error('auth delete failed', { user: userId, error: error.message })
      // db_finalized is preserved and the session is still alive, so the user
      // can genuinely retry this same request.
      await recordFailure(admin, userId, `auth_delete: ${error.message}`)
      return fail(500, 'auth_delete_failed')
    }
  } catch (err) {
    console.error('auth delete threw', { user: userId, error: (err as Error).message })
    await recordFailure(admin, userId, `auth_delete: ${(err as Error).message}`)
    return fail(500, 'auth_delete_failed')
  }

  // Best-effort: the user is gone, so this only tidies any other device's
  // refresh token. A failure here must never turn a completed deletion into an
  // error response.
  try {
    await admin.auth.admin.signOut(token, 'global')
  } catch {
    // ignore
  }

  return json({ success: true, pending: false }, 200)
}

/**
 * Finish a deletion whose outcome the client never observed.
 *
 * Only reached when `getUser(token)` failed. We read the `sub` claim from the
 * bearer token (Supabase signs it; we never read an id out of the request
 * body) and require that BOTH:
 *   1. the token is for that exact subject, and
 *   2. account_deletion_requests has a row for it that is already db_finalized.
 *
 * A db_finalized row means the database side completed in an earlier call, so
 * the only remaining work is the auth deletion. Returning success here is
 * therefore truthful, not optimistic. If either check fails, this is just an
 * ordinary unauthenticated request and we return null.
 */
async function recoverAfterLostResponse(admin: any, token: string): Promise<Response | null> {
  const sub = decodeJwtSubject(token)
  if (!sub) return null

  try {
    const { data, error } = await admin
      .from('account_deletion_requests')
      .select('status')
      .eq('user_id', sub)
      .maybeSingle()

    if (error || !data) return null

    // Not yet finalized: there is real work left, but the user has no session,
    // so they must sign in again. Do not pretend deletion is complete.
    if (data.status !== 'db_finalized') {
      return json({ success: false, pending: true, error: 'session_expired' }, 401)
    }

    // Already finalized. Attempt the auth delete; if the user is already gone,
    // Auth returns a not-found error, which is the desired end state.
    const { error: deleteError } = await admin.auth.admin.deleteUser(sub)
    if (deleteError && !/not\s*found|does not exist|404/i.test(deleteError.message)) {
      console.error('recovery auth delete failed', { user: sub, error: deleteError.message })
      await recordFailure(admin, sub, `auth_delete(recovery): ${deleteError.message}`)
      return fail(500, 'auth_delete_failed')
    }

    return json({ success: true, pending: false }, 200)
  } catch (err) {
    console.error('recovery threw', { user: sub, error: (err as Error).message })
    return null
  }
}

/** Read `sub` from a JWT payload without verifying a signature.
 *
 * This is NOT the authorisation check — Supabase's gateway already verified the
 * signature (`verify_jwt = true`), and we additionally require a db_finalized
 * deletion request for this exact subject. It only tells us who the token is
 * for so we can look up whether that user's deletion already completed. */
function decodeJwtSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    // base64url -> base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded))
    return typeof claims?.sub === 'string' && claims.sub.length > 0 ? claims.sub : null
  } catch {
    return null
  }
}

async function recordFailure(admin: any, userId: string, message: string) {
  try {
    await admin.rpc('record_account_deletion_failure', {
      p_user_id: userId,
      p_error: message,
    })
  } catch (err) {
    console.error('could not record failure', { user: userId, error: (err as Error).message })
  }
}

serve(async (req) => {
  try {
    return await handle(req)
  } catch (err) {
    console.error('unhandled', (err as Error).message)
    // Retryable, and never leaks internals.
    return fail(500, 'unexpected_error')
  }
})
