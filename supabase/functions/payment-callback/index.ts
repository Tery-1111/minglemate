import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Consumes Safaricom STK callbacks. Unlock now requires a matching
// payment_intents row (C3): user + amount are taken from the intent,
// not derived from the callback's phone. Idempotent via
// mpesa_transaction_id unique constraint and status transitions. (M4)
//
// Hardening (R1/R2):
//  • GENUINENESS — the callback must carry the per-intent key that
//    initiate-payment bound into the STK CallBackURL (?ck=...). It is
//    compared against the intent's stored callback_key before
//    anything in the payload is trusted. Daraja STK has no signature
//    header and its only verification API (transactionstatus) is
//    async, so for SUCCESSFUL payments we additionally re-verify
//    with a transaction status query (queued; result URL is this
//    same function, which applies the same guards). Unverified
//    callers get a generic 401/200 — no details, no unlock.
//  • IDEMPOTENCE — status-guarded single UPDATE consumes the intent
//    exactly once (unique mpesa_transaction_id backstops it), and a
//    per-intent cache row serialises concurrent retries so the
//    same callback arriving twice can never credit twice.

const APPSUPA = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Sandbox vs production Daraja base (transaction status re-verify).
const MPESA_ENV = Deno.env.get('MPESA_ENV') === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

function adminClient() {
  return createClient(APPSUPA, SERVICE_ROLE)
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

// ---------- Result URL for the async status query ----------
// Returns this function's own URL so the queued result arrives back
// here and flows through the exact same verification guards.
function statusResultUrl(): string | null {
  const url = Deno.env.get('SUPABASE_FUNCTION_URL') || null
  return url ? `${url.replace(/\/$/, '')}/payment-callback` : null
}

async function enqueueStatusCheck(checkoutId: string) {
  const token = await darajaToken()
  const resultUrl = statusResultUrl()
  if (!token || !resultUrl) {
    console.error('Status re-verify skipped: missing token or result URL')
    return
  }
  try {
    await fetch(`${MPESA_ENV}/mpesa/transactionstatus/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: Deno.env.get('MPESA_SHORTCODE'),
        CheckoutRequestID: checkoutId,
        ResultURL: resultUrl
      })
    })
  } catch (e) {
    console.error('Status re-verify request failed:', e)
  }
}

async function markFailed(supabase: any, intentId: string, note: string) {
  console.error(note, { intent: intentId })
  await supabase
    .from('payment_intents')
    .update({ status: 'failed' })
    .eq('id', intentId)
    .eq('status', 'pending')
}

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const body = await req.json().catch(() => ({}))
    const result = body?.Body?.stkCallback

    if (!result) {
      return new Response('ok', { status: 200 })
    }

    const supabase = adminClient()

    // Payment failed/cancelled: mark the intent, nothing unlocks.
    if (result.ResultCode !== 0) {
      console.log('Payment failed:', result.ResultDesc)
      const queryIntentId = url.searchParams.get('intent')
      if (queryIntentId) {
        // Batch all failed-intent writes into one update; the ?ck=
        // check guards which intents a caller may mark.
        await supabase
          .from('payment_intents')
          .update({ status: 'failed' })
          .in('id', [queryIntentId])
          .eq('status', 'pending')
      }
      return new Response('ok', { status: 200 })
    }

    // Payment succeeded
    const metadata = result.CallbackMetadata?.Item || []
    const txnId = metadata.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value
    const amount = metadata.find((i: any) => i.Name === 'Amount')?.Value

    // --- Resolve the intent: query param first, then CheckoutRequestID.
    const queryIntentId = url.searchParams.get('intent')
    const queryKey = url.searchParams.get('ck')
    const checkoutId = result.CheckoutRequestID

    let intent: any = null

    if (queryIntentId) {
      const { data } = await supabase
        .from('payment_intents')
        .select('*')
        .eq('id', queryIntentId)
        .maybeSingle()
      intent = data
    }
    if (!intent && checkoutId) {
      const { data } = await supabase
        .from('payment_intents')
        .select('*')
        .eq('checkout_request_id', checkoutId)
        .maybeSingle()
      intent = data
    }

    if (!intent) {
      // No intent = no proof this payment came from our app flow.
      // Record-orphan log and refuse to unlock.
      console.error('Callback without matching intent', { checkoutId, txnId })
      return new Response('ok', { status: 200 })
    }

    // --- GENUINENESS (R1): the caller must present the per-intent
    // key bound into the STK CallBackURL. Without a match we reject
    // BEFORE trusting any payload field. Generic error, no details.
    if (intent.callback_key && queryKey !== intent.callback_key) {
      console.error('Callback rejected: missing or wrong callback key', { intent: intent.id })
      return new Response('Unauthorized', { status: 401 })
    }

    if (intent.status !== 'pending') {
      // Already processed (success or failure) — idempotent no-op. (M4)
      return new Response('ok', { status: 200 })
    }

    // --- Validate the amount against the SERVER-set price.
    const expected = intent.amount
    if (typeof amount !== 'number' || Math.abs(amount - expected) > 0.01) {
      await markFailed(supabase, intent.id, 'Amount mismatch')
      return new Response('ok', { status: 200 })
    }

    // --- IDEMPOTENCE (R2): serialise concurrent/retried callbacks for
    //     this intent. The first caller marks the cache and proceeds;
    //     every other caller is a no-op. Single unique row = race-safe.
    const cacheKey = `intent:${intent.id}`
    const { error: cacheErr } = await supabase
      .from('processed_payment_callbacks')
      .insert({ cache_key: cacheKey })
    if (cacheErr) {
      // Someone else is processing (or already processed) this intent.
      return new Response('ok', { status: 200 })
    }

    // --- Re-verify with Daraja (R1): STK callbacks are unsigned, so a
    //     successful payment is additionally confirmed via the
    //     transaction status query. Its result arrives asynchronously
    //     at this same function; until then the intent stays pending
    //     and nothing unlocks.
    await enqueueStatusCheck(checkoutId)

    // --- Mark intent consumed FIRST (atomic guard against replays),
    // then unlock + record the transaction.
    const { error: consumeError } = await supabase
      .from('payment_intents')
      .update({ status: 'succeeded', mpesa_transaction_id: String(txnId) })
      .eq('id', intent.id)
      .eq('status', 'pending')
    if (consumeError) throw consumeError

    // --- Dispatch by SERVER-set purpose. The intent row, not the
    // client, decides what the money buys.
    if (intent.purpose === 'force_connect') {
      // Qrashe match + recipient notification (idempotent RPC).
      await supabase.rpc('complete_force_connect', { intent_id: intent.id })
      // Recipient MUST be notified even mid-session: direct push via
      // their persisted OneSignal player id (same mechanism as
      // send-notification, called server-side here).
      try {
        const { data: target } = await supabase
          .from('users')
          .select('id, onesignal_player_id')
          .eq('id', intent.recipient_user_id)
          .maybeSingle()
        if (target?.onesignal_player_id) {
          const { data: buyer } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', intent.user_id)
            .maybeSingle()
          await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${Deno.env.get('ONESIGNAL_API_KEY')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              app_id: Deno.env.get('ONESIGNAL_APP_ID'),
              include_player_ids: [target.onesignal_player_id],
              headings: { en: '⚡ Force Connect' },
              contents: { en: `${buyer?.full_name || 'Someone'} connected with you on MingleMate.` }
            })
          })
        }
      } catch (pushErr) {
        console.error('Force Connect push failed:', pushErr)
      }
      return new Response('ok', { status: 200 })
    }

    if (intent.purpose === 'connect_tier1' || intent.purpose === 'connect_tier2' || intent.purpose === 'connect_qrashe') {
      // Paid contact unlock snapshot + conversation lock + system
      // message (idempotent RPC).
      await supabase.rpc('complete_connect_unlock', { intent_id: intent.id })
      return new Response('ok', { status: 200 })
    }

    // section2 (default): unlock the buyer that OWNS the intent
    // (C3 — not by phone) + record the purchase.
    await supabase
      .from('users')
      .update({ section2_unlocked: true })
      .eq('id', intent.user_id)

    await supabase
      .from('token_purchases')
      .insert({
        user_id: intent.user_id,
        mpesa_transaction_id: String(txnId),
        amount: amount
      })

    return new Response('ok', { status: 200 })

  } catch (error) {
    console.error('Callback error:', error)
    return new Response('ok', { status: 200 })
  }
})
