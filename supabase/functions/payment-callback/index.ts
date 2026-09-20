import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Consumes Safaricom STK callbacks. Unlock now requires a matching
// payment_intents row (C3): user + amount are taken from the intent,
// not derived from the callback's phone. Idempotent via
// mpesa_transaction_id unique constraint and status transitions. (M4)

serve(async (req) => {
  try {
    const url = new URL(req.url)
    const body = await req.json()
    const result = body?.Body?.stkCallback

    if (!result) {
      return new Response('ok', { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Payment failed/cancelled: mark the intent, nothing unlocks.
    if (result.ResultCode !== 0) {
      console.log('Payment failed:', result.ResultDesc)
      const queryIntentId = url.searchParams.get('intent')
      if (queryIntentId) {
        await supabase
          .from('payment_intents')
          .update({ status: 'failed' })
          .eq('id', queryIntentId)
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

    if (intent.status !== 'pending') {
      // Already processed (success or failure) — idempotent no-op. (M4)
      return new Response('ok', { status: 200 })
    }

    // --- Validate the amount against the SERVER-set price.
    const expected = intent.amount
    if (typeof amount !== 'number' || Math.abs(amount - expected) > 0.01) {
      console.error('Amount mismatch', { expected, got: amount, intent: intent.id })
      await supabase
        .from('payment_intents')
        .update({ status: 'failed' })
        .eq('id', intent.id)
        .eq('status', 'pending')
      return new Response('ok', { status: 200 })
    }

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
