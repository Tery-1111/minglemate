import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildTransactionStatusQuery,
  decideStkAction,
  parseCallbackBody,
  readTransactionStatusAck,
  statusResultPatch,
  verificationFromStatusResult,
  type ExpiryState,
  type IntentRow,
  type StatusResult
} from './ticket.ts'

// Consumes Safaricom Daraja callbacks for STK payments.
//
// WHAT ACTUALLY GATES AN UNLOCK — and nothing else does:
//   1. the ticket. The caller must present the per-intent key that
//      initiate-payment bound into the STK CallBackURL (?ck=...). It is
//      checked on the FAILURE branch and the SUCCESS branch alike, before
//      any payload field is trusted, and an intent with no key to compare
//      against refuses too. (The key column arrives with
//      payment_intent_lifecycle.sql / harden_resilience.sql; where it is
//      missing, `intent.callback_key` is undefined and this refuses —
//      fail-closed, not skipped.)
//   2. the window. The intent must still be inside payment_intents
//      .expires_at — and the VERDICT IS THE DATABASE'S. This function asks
//      public.payment_intent_expiry_state() and acts on the answer; it never
//      compares timestamps itself, because expire_stale_payment_intents()
//      and payment_intent_anomalies ask the same function. One rule, three
//      callers. A genuine callback that lands after the window is recorded
//      (late_callback_at + status_reason) and unlocks NOTHING; a human
//      reconciles it from payment_intent_anomalies.
//   3. the amount. It must equal the SERVER-set price on the intent.
//   4. the consume. A status-guarded UPDATE moves pending -> succeeded
//      exactly once, and a unique row in processed_payment_callbacks
//      serialises concurrent retries. Only a unique violation counts as
//      "someone else won"; any other cache failure is logged and the
//      unlock proceeds, because mistaking an infrastructure error for a
//      race silently abandoned paid unlocks.
//
// WHAT DELIBERATELY DOES NOT GATE AN UNLOCK:
//   * The async transactionstatus re-verify. Daraja's status query is
//     asynchronous and its result lands on a URL carrying no intent key,
//     so it cannot authenticate a caller. It is also only sent when
//     MPESA_INITIATOR / MPESA_SECURITY_CREDENTIAL / MPESA_SHORTCODE and
//     SUPABASE_FUNCTION_URL are all configured; until then the intent
//     records verification_state='unavailable' and names what is missing. Its outcome is recorded as
//     corroboration (verification_state / verification_detail /
//     verified_at) and a contradiction is surfaced in
//     payment_intent_anomalies for a human. Blocking the unlock on it
//     would strand paid users whenever Daraja, the token, or
//     SUPABASE_FUNCTION_URL is unavailable — which is what the previous
//     "nothing unlocks until then" comment claimed while the next
//     statement unlocked anyway.
//   * Daraja signatures: STK callbacks are unsigned, so the per-intent key
//     is the whole of the genuineness story.
//
// THE ORDERING LIVES IN ticket.ts (decideStkAction) so every branch is
// asserted by scripts/verify-payment-ticket.mjs rather than described here.
// This file only performs the I/O those decisions call for.
//
// EVERY UNLOCK IS VERIFIED, NOT ASSUMED. After the RPC or update, the
// effect is read back — the match row, the connect_unlocks row, the
// section2 flag and purchase row — and recorded as unlock_state
// ('applied' | 'no_effect' | 'failed') with unlock_applied_at /
// unlock_error. complete_force_connect and complete_connect_unlock return
// silently when they decline (not paired, recipient gone), so "the RPC
// returned without an error" is not evidence that anything happened. A
// re-delivered callback for an intent whose unlock never applied retries
// it, since the old ordering made that state permanently unrecoverable.

const APPSUPA = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Sandbox vs production Daraja base (transaction status re-verify).
const MPESA_ENV = Deno.env.get('MPESA_ENV') === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

function adminClient() {
  return createClient(APPSUPA, SERVICE_ROLE)
}

function ok() {
  return new Response('ok', { status: 200 })
}

function retry() {
  // Ask Daraja to redeliver instead of reporting a success that did not
  // happen. The intent's own state makes the redelivery safe.
  return new Response('retry', { status: 500 })
}

/**
 * Bookkeeping write. Never fatal: an audit column that fails to record
 * must not turn a paid unlock into a failure. Failures are loud instead.
 */
async function record(supabase: any, intentId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('payment_intents').update(patch).eq('id', intentId)
  if (error) {
    console.error('intent bookkeeping failed', { intent: intentId, patch, error: error.message })
  }
}

async function resolveIntent(
  supabase: any,
  intentId: string | null,
  checkoutId: string | null
): Promise<IntentRow | null> {
  if (intentId) {
    const { data } = await supabase.from('payment_intents').select('*').eq('id', intentId).maybeSingle()
    if (data) return data as IntentRow
  }
  if (checkoutId) {
    const { data } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('checkout_request_id', checkoutId)
      .maybeSingle()
    if (data) return data as IntentRow
  }
  return null
}

/** pending -> failed, only ever from pending, with the reason recorded. */
async function markFailed(supabase: any, intentId: string, reason: string) {
  console.error('Payment failed:', reason, { intent: intentId })
  const { error } = await supabase
    .from('payment_intents')
    .update({ status: 'failed', status_reason: reason })
    .eq('id', intentId)
    .eq('status', 'pending')
  if (error) console.error('mark failed write error', { intent: intentId, error: error.message })
}

// ---------- Daraja token (status query) ----------
async function darajaToken(): Promise<string | null> {
  const key = Deno.env.get('MPESA_CONSUMER_KEY')
  const secret = Deno.env.get('MPESA_CONSUMER_SECRET')
  if (!key || !secret) return null
  try {
    const res = await fetch(
      `${MPESA_ENV}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` } }
    )
    const data = await res.json()
    return data?.access_token || null
  } catch {
    return null
  }
}

// ---------- Expiry verdict (the database owns the rule) ----------
/**
 * Ask the database whether the window has closed for this intent.
 *
 * Deliberately NOT reimplemented here: `expires_at` is not read, no interval
 * is written down, and no clock is passed in — the database uses its own
 * now(). A client-side copy of the rule is what the sweep and the audit view
 * would silently drift away from, and it would also let the edge function
 * decide on a value it had just parsed out of an untrusted payload.
 *
 * A failure to answer is NOT a licence to guess: it is reported as
 * 'unavailable' and logged, and expiryBlocksUnlock() still lets the genuine
 * payment through rather than stranding money on a transient error — the same
 * choice this file makes for a failed idempotency insert.
 */
async function resolveExpiryState(supabase: any, intentId: string): Promise<ExpiryState> {
  const { data, error } = await supabase.rpc('payment_intent_expiry_state', {
    p_intent_id: intentId
  })
  if (error) {
    console.error('Expiry verdict unavailable — window not enforced for this intent', {
      intent: intentId,
      error: error.message
    })
    return 'unavailable'
  }
  const state = String(data ?? 'no_window') as ExpiryState
  if (!['live', 'expired', 'no_window', 'no_intent'].includes(state)) {
    console.error('Expiry verdict not understood', { intent: intentId, state })
    return 'unavailable'
  }
  return state
}

// ---------- Result URL for the async status query ----------
// The status result arrives here without any intent key, so it is recorded
// as corroboration and never passed through the ticket guards. This comment
// previously claimed it "flows through the exact same verification guards",
// which was never true.
function statusResultUrl(): string | null {
  const url = Deno.env.get('SUPABASE_FUNCTION_URL') || null
  return url ? `${url.replace(/\/$/, '')}/payment-callback` : null
}

/**
 * Enqueue the transactionstatus query and record that it was asked for.
 * The ACK carries the ConversationID the async result quotes back, which
 * is the only correlator available when the answer is "no such
 * transaction" (a contradiction has no receipt to match on).
 */
async function enqueueStatusCheck(supabase: any, intent: IntentRow, receipt: string | null) {
  const nowIso = new Date().toISOString()
  if (!receipt) {
    await record(supabase, intent.id, {
      verification_state: 'unavailable',
      verification_detail: 'no MpesaReceiptNumber on the callback to query'
    })
    return
  }

  // Daraja's transactionstatus request needs more than a URL: an initiator,
  // the encrypted security credential, the command id, the short code and a
  // queue-timeout URL. The previous version sent only
  // BusinessShortCode/CheckoutRequestID/ResultURL, which Daraja rejects — so
  // the second verification could not have produced an answer even if its
  // result had been parsed. Whatever is missing is named in the record
  // instead of being skipped silently.
  const initiator = Deno.env.get('MPESA_INITIATOR')
  const credential = Deno.env.get('MPESA_SECURITY_CREDENTIAL')
  const shortcode = Deno.env.get('MPESA_SHORTCODE')
  const token = await darajaToken()
  const resultUrl = statusResultUrl()
  const missing = [
    !initiator && 'MPESA_INITIATOR',
    !credential && 'MPESA_SECURITY_CREDENTIAL',
    !shortcode && 'MPESA_SHORTCODE',
    !token && 'MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET',
    !resultUrl && 'SUPABASE_FUNCTION_URL'
  ].filter(Boolean)

  if (missing.length > 0) {
    console.error('Status re-verify unavailable — missing config', { intent: intent.id, missing })
    await record(supabase, intent.id, {
      verification_requested_at: nowIso,
      verification_state: 'unavailable',
      verification_detail: `not requested — missing ${missing.join(', ')}`
    })
    return
  }

  await record(supabase, intent.id, {
    verification_requested_at: nowIso,
    verification_state: 'pending'
  })

  try {
    // The body comes from ticket.ts rather than being spelled out here, so
    // the payload this branch sends is byte-for-byte the payload
    // scripts/sandbox-transactionstatus.mjs captures from the real sandbox.
    // `missing` above guarantees these are set; the assertions are for tsc.
    const query = buildTransactionStatusQuery({
      initiator: initiator!,
      credential: credential!,
      shortcode: shortcode!,
      resultUrl: resultUrl!,
      // The receipt the callback itself carried is the documented lookup
      // key for a status query (CheckoutRequestID is not one).
      receipt,
      remark: `minglemate ${intent.id}`
    })
    const res = await fetch(`${MPESA_ENV}/mpesa/transactionstatus/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(query)
    })
    const ack = await res.json().catch(() => ({}))
    const outcome = readTransactionStatusAck(ack)
    if (outcome.conversationId) {
      await record(supabase, intent.id, { verification_conversation_id: outcome.conversationId })
    }
    if (outcome.rejected) {
      await record(supabase, intent.id, {
        verification_state: 'unavailable',
        verification_detail: outcome.rejected
      })
    }
  } catch (e) {
    console.error('Status re-verify request failed:', e)
    await record(supabase, intent.id, {
      verification_state: 'unavailable',
      verification_detail: `status query errored: ${e instanceof Error ? e.message : String(e)}`
    })
  }
}

/**
 * Apply the unlock the intent paid for, then CONFIRM the effect exists.
 * Returns what was observed, never what was merely attempted.
 */
async function applyUnlock(
  supabase: any,
  intent: IntentRow
): Promise<{ state: 'applied' | 'no_effect' | 'failed'; detail: string }> {
  const recipient = (intent as any).recipient_user_id as string | null
  const target = (() => {
    if (intent.purpose === 'force_connect') return 'force_connect'
    if (intent.purpose === 'connect_tier1' || intent.purpose === 'connect_tier2' || intent.purpose === 'connect_qrashe') {
      return 'contact_unlock'
    }
    if (intent.purpose === 'section2') return 'section2'
    return 'unknown'
  })()

  if (target === 'unknown') {
    return { state: 'no_effect', detail: `no unlock path for purpose '${intent.purpose}'` }
  }

  if (target === 'force_connect') {
    if (!recipient) return { state: 'no_effect', detail: 'intent has no recipient' }
    const { error } = await supabase.rpc('complete_force_connect', { intent_id: intent.id })
    if (error) return { state: 'failed', detail: `complete_force_connect: ${error.message}` }

    // Effect: a pair row for buyer+recipient. complete_force_connect returns
    // silently when the pair already exists (fine) or when a user is gone
    // (not fine), so the row is the evidence.
    const { data: row, error: readErr } = await supabase
      .from('matches')
      .select('id')
      .or(`and(user_a_id.eq.${intent.user_id},user_b_id.eq.${recipient}),and(user_a_id.eq.${recipient},user_b_id.eq.${intent.user_id})`)
      .maybeSingle()
    if (readErr) return { state: 'failed', detail: `verify read failed: ${readErr.message}` }
    if (!row) return { state: 'no_effect', detail: 'complete_force_connect left no match row for this pair' }
    return { state: 'applied', detail: `match ${row.id}` }
  }

  if (target === 'contact_unlock') {
    if (!recipient) return { state: 'no_effect', detail: 'intent has no recipient' }
    const { error } = await supabase.rpc('complete_connect_unlock', { intent_id: intent.id })
    if (error) return { state: 'failed', detail: `complete_connect_unlock: ${error.message}` }

    // Effect: the buyer's snapshot row. The RPC declines silently when the
    // two are no longer paired, which must read as no_effect, not success.
    const { data: row, error: readErr } = await supabase
      .from('connect_unlocks')
      .select('id')
      .eq('buyer_id', intent.user_id)
      .eq('seller_id', recipient)
      .maybeSingle()
    if (readErr) return { state: 'failed', detail: `verify read failed: ${readErr.message}` }
    if (!row) return { state: 'no_effect', detail: 'complete_connect_unlock left no unlock row (pair no longer matched?)' }
    return { state: 'applied', detail: `connect_unlock ${row.id}` }
  }

  // section2: unlock the buyer that OWNS the intent (never by phone).
  const { error: updateError } = await supabase
    .from('users')
    .update({ section2_unlocked: true })
    .eq('id', intent.user_id)
  if (updateError) return { state: 'failed', detail: `section2 flag: ${updateError.message}` }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('section2_unlocked')
    .eq('id', intent.user_id)
    .maybeSingle()
  if (profileError) return { state: 'failed', detail: `verify read failed: ${profileError.message}` }
  if (!profile?.section2_unlocked) {
    return { state: 'no_effect', detail: 'section2_unlocked is still false for the intent owner' }
  }

  // Purchase record. A duplicate receipt means it is already recorded.
  const txn = (intent as any).mpesa_transaction_id
  if (txn) {
    const { error: purchaseError } = await supabase
      .from('token_purchases')
      .insert({ user_id: intent.user_id, mpesa_transaction_id: String(txn), amount: intent.amount })
    if (purchaseError && String(purchaseError.code) !== '23505') {
      return { state: 'failed', detail: `token_purchases: ${purchaseError.message}` }
    }
  }

  return { state: 'applied', detail: 'section2_unlocked true' }
}

/** Record the async status result against its intent. Advisory only. */
async function recordStatusResult(supabase: any, result: StatusResult) {
  const { state, detail } = verificationFromStatusResult(result)

  let intent: IntentRow | null = null
  if (result.transactionId) {
    const { data } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('mpesa_transaction_id', result.transactionId)
      .maybeSingle()
    intent = (data as IntentRow) || null
  }
  if (!intent && result.conversationId) {
    const { data } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('verification_conversation_id', result.conversationId)
      .maybeSingle()
    intent = (data as IntentRow) || null
  }
  if (!intent && result.originatorConversationId) {
    const { data } = await supabase
      .from('payment_intents')
      .select('*')
      .eq('verification_conversation_id', result.originatorConversationId)
      .maybeSingle()
    intent = (data as IntentRow) || null
  }

  if (!intent) {
    console.error('Status result for an unknown intent', {
      conversationId: result.conversationId,
      transactionId: result.transactionId
    })
    return
  }

  if (state === 'contradicted') {
    console.error('Transaction status contradicts the callback', { intent: intent.id, detail })
  }
  await record(supabase, intent.id, statusResultPatch(result, new Date()))
}

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const parsed = parseCallbackBody(body)
    const supabase = adminClient()

    if (parsed.kind === 'unknown') {
      console.error('Unrecognised callback body', { keys: Object.keys(body || {}) })
      return ok()
    }

    // --- Async transaction-status result: corroboration, never authority.
    if (parsed.kind === 'status') {
      await recordStatusResult(supabase, parsed)
      return ok()
    }

    // --- STK callback.
    const intent = await resolveIntent(supabase, url.searchParams.get('intent'), parsed.checkoutId)
    if (!intent) {
      // No intent = no proof this payment came from our flow.
      console.error('Callback without matching intent', {
        checkoutId: parsed.checkoutId,
        txnId: parsed.receipt
      })
      return ok()
    }

    const now = new Date()
    // The window is the database's decision, asked once, before any branch.
    const expiryState = await resolveExpiryState(supabase, intent.id)
    if (expiryState !== 'live' && expiryState !== 'expired') {
      // Say it out loud rather than treating "cannot tell" as "fine":
      // a guard that silently stops guarding is the defect this replaced.
      console.warn('Expiry window not enforced for this intent', {
        intent: intent.id,
        expiryState
      })
    }
    const action = decideStkAction(intent, parsed, url.searchParams.get('ck'), now, expiryState)

    // The ticket is the first decision, so reaching past it means the caller
    // proved possession of the per-intent key.
    if (action.type === 'reject_ticket') {
      await record(supabase, intent.id, { ticket_state: action.ticketState })
      console.error('Callback rejected: ticket not verified', {
        intent: intent.id,
        reason: action.reason
      })
      return new Response('Unauthorized', { status: action.httpStatus })
    }
    await record(supabase, intent.id, { ticket_state: 'verified' })

    switch (action.type) {
      case 'noop':
        return ok()

      case 'record_failed':
        await markFailed(supabase, intent.id, action.reason)
        return ok()

      case 'amount_mismatch':
        await markFailed(supabase, intent.id, action.reason)
        return ok()

      case 'late_callback':
        await record(supabase, intent.id, action.patch)
        console.error('Callback arrived after expiry — NOT unlocked', {
          intent: intent.id,
          receipt: parsed.receipt,
          genuine: action.genuine
        })
        return ok()

      case 'retry_unlock': {
        // The intent was consumed but the unlock never landed (e.g. the
        // process died, or an RPC error the old code swallowed). Both unlock
        // RPCs are idempotent, so re-apply and re-verify.
        const retried = await applyUnlock(supabase, intent)
        await record(supabase, intent.id, {
          unlock_state: retried.state,
          unlock_applied_at: retried.state === 'applied' ? now.toISOString() : null,
          unlock_error: retried.state === 'applied' ? null : `retry: ${retried.detail}`
        })
        if (retried.state !== 'applied') {
          console.error('Unlock retry did not apply', { intent: intent.id, detail: retried.detail })
        }
        return retried.state === 'failed' ? retry() : ok()
      }

      case 'process': {
        // --- IDEMPOTENCE: serialise concurrent/retried callbacks for this
        //     intent. Only a duplicate row means another caller is working
        //     on it; anything else is an infrastructure error and must not
        //     be mistaken for a race.
        const cache = await supabase
          .from('processed_payment_callbacks')
          .insert({ cache_key: `intent:${intent.id}` })
        if (cache.error) {
          const code = String(cache.error.code ?? '')
          const status = Number(cache.error.status ?? 0)
          if (code === '23505' || status === 409) return ok()
          console.error('Idempotency cache insert failed — continuing to unlock', {
            intent: intent.id,
            error: cache.error.message
          })
        }

        // --- Corroboration: ask Daraja to confirm the receipt. The answer
        //     is recorded as evidence, never used as a gate (see header).
        await enqueueStatusCheck(supabase, intent, parsed.receipt)

        // --- Consume the intent FIRST (atomic against replays), then unlock.
        const { error: consumeError } = await supabase
          .from('payment_intents')
          .update({ status: 'succeeded', mpesa_transaction_id: String(parsed.receipt) })
          .eq('id', intent.id)
          .eq('status', 'pending')
        if (consumeError) throw consumeError

        const unlock = await applyUnlock(supabase, intent)
        await record(supabase, intent.id, {
          unlock_state: unlock.state,
          unlock_applied_at: unlock.state === 'applied' ? now.toISOString() : null,
          unlock_error: unlock.state === 'applied' ? null : unlock.detail
        })

        if (unlock.state !== 'applied') {
          // 'no_effect' is a decision (no longer paired, recipient gone) and
          // redelivery cannot change it — surface it instead of looping.
          // 'failed' is infrastructure, so ask Daraja to redeliver.
          console.error('Unlock did not apply', {
            intent: intent.id,
            state: unlock.state,
            detail: unlock.detail
          })
        }
        return unlock.state === 'failed' ? retry() : ok()
      }
    }

    return ok()
  } catch (error) {
    console.error('Callback error:', error)
    return retry()
  }
})
