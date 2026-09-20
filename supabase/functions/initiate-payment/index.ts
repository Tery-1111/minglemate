import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// M7: restrict browser callers to our own origins. Server-to-server
// (M-Pesa callback) is unaffected by CORS — it's not a browser.
const ALLOWED_ORIGINS = [
  'https://minglemate.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
]

function corsFor(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin'
  }
}

// Server-enforced product prices — the client can NEVER set these. (C2)
const PRICES: Record<string, number> = {
  section2: 200,
  force_connect: 80,
  connect_tier1: 70,
  connect_tier2: 50,
  connect_qrashe: 50
}
const KENYAN_PHONE = /^(?:\+?254|0)(?:7\d|1\d)\d{7}$/
// STK push throttle: max pushes per user per rolling window. (C4)
const MAX_PUSHES_PER_WINDOW = 5
const WINDOW_MINUTES = 60

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) })
  }

  try {
    // --- AUTH: user identity comes from their JWT, never the body. (C2/C4)
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 401
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const { data: userData, error: authError } = await admin.auth.getUser(token)
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 401
      })
    }
    const userId = userData.user.id

    // --- INPUT: phone + purpose + optional recipient. Prices are
    //     server constants; recipient is looked up server-side. (C2)
    const { phone: rawPhone, purpose: rawPurpose, recipientId: rawRecipient } = await req.json()
    const purpose = String(rawPurpose || 'section2')
    if (!PRICES[purpose]) {
      return new Response(JSON.stringify({ error: 'Unknown payment purpose' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
      })
    }

    const phone = String(rawPhone || '').replace(/[\s-]/g, '')
    if (!KENYAN_PHONE.test(phone)) {
      return new Response(JSON.stringify({ error: 'Enter a valid Kenyan phone number e.g. 0712345678' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
      })
    }
    const msisdn = phone.startsWith('0') ? `254${phone.slice(1)}` : phone.replace(/^\+/, '')

    // --- CONNECT PURPOSES: validate the recipient is a real profile.
    let recipientId: string | null = null
    if (purpose !== 'section2') {
      if (!rawRecipient || typeof rawRecipient !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing recipient' }), {
          headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
        })
      }
      const { data: recipient } = await admin
        .from('users')
        .select('id')
        .eq('id', rawRecipient)
        .maybeSingle()
      if (!recipient) {
        return new Response(JSON.stringify({ error: 'Recipient not found' }), {
          headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
        })
      }
      recipientId = recipient.id

      if (recipientId === userId) {
        return new Response(JSON.stringify({ error: 'Cannot connect with yourself' }), {
          headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
        })
      }

      // Connect (paid contact unlock): requires an actual pair and no
      // prior unlock. Force Connect must not already exist either.
      if (purpose !== 'force_connect') {
        const { data: paired } = await admin.rpc('users_are_paired', {
          a: userId, b: recipientId
        })
        if (!paired) {
          return new Response(JSON.stringify({ error: 'You are not matched with this user' }), {
            headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
          })
        }
        const { data: existing } = await admin
          .from('connect_unlocks')
          .select('id')
          .eq('buyer_id', userId)
          .eq('seller_id', recipientId)
          .maybeSingle()
        if (existing) {
          return new Response(JSON.stringify({ error: 'Contact details already unlocked' }), {
            headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
          })
        }
      } else {
        const { data: existingMatch } = await admin
          .from('matches')
          .select('id')
          .or(`and(user_a_id.eq.${userId},user_b_id.eq.${recipientId}),and(user_a_id.eq.${recipientId},user_b_id.eq.${userId})`)
          .maybeSingle()
        if (existingMatch) {
          return new Response(JSON.stringify({ error: 'You are already matched with this user' }), {
            headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
          })
        }
      }
    }

    // --- SECTION2 short-circuit: already unlocked, don't charge again.
    if (purpose === 'section2') {
      const { data: profile } = await admin
        .from('users')
        .select('section2_unlocked')
        .eq('id', userId)
        .single()
      if (profile?.section2_unlocked) {
        return new Response(JSON.stringify({ error: 'Section 2 is already unlocked.' }), {
          headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
        })
      }
    }

    // --- RATE LIMIT: rolling window counted from payment_intents. (C4)
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()
    const { count } = await admin
      .from('payment_intents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since)
    if ((count ?? 0) >= MAX_PUSHES_PER_WINDOW) {
      return new Response(JSON.stringify({ error: 'Too many payment attempts. Please try again later.' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 429
      })
    }

    // --- PAYMENT INTENT: binds user + phone + SERVER-side price +
    //     purpose + recipient. The callback consumes this row;
    //     nothing unlocks without one.
    const { data: intent, error: intentError } = await admin
      .from('payment_intents')
      .insert({
        user_id: userId,
        phone: msisdn,
        amount: PRICES[purpose],
        status: 'pending',
        purpose,
        recipient_user_id: recipientId
      })
      .select('id')
      .single()
    if (intentError) throw intentError

    // --- M-PESA STK PUSH
    const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY')
    const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET')
    const shortcode = Deno.env.get('MPESA_SHORTCODE')
    const passkey = Deno.env.get('MPESA_PASSKEY')
    const callbackUrl = Deno.env.get('MPESA_CALLBACK_URL')

    const auth = btoa(`${consumerKey}:${consumerSecret}`)
    const tokenRes = await fetch(
      'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      { headers: { Authorization: `Basic ${auth}` } }
    )
    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token

    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)
    const password = btoa(`${shortcode}${passkey}${timestamp}`)

    const descriptions: Record<string, string> = {
      section2: 'Section 2 Unlock',
      force_connect: 'Force Connect',
      connect_tier1: 'Connect Tier 1',
      connect_tier2: 'Connect Tier 2',
      connect_qrashe: 'Connect Qrashe'
    }

    const stkRes = await fetch(
      'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: PRICES[purpose],
          PartyA: msisdn,
          PartyB: shortcode,
          PhoneNumber: msisdn,
          CallBackURL: `${callbackUrl}${callbackUrl?.includes('?') ? '&' : '?'}intent=${intent.id}`,
          AccountReference: 'MingleMate',
          TransactionDesc: descriptions[purpose]
        })
      }
    )

    const stkData = await stkRes.json()

    // Record checkout id so the callback can match the intent even
    // if the query param is stripped by a relay; mark failures so
    // the rate-limit window isn't poisoned by dead intents.
    if (stkData?.CheckoutRequestID) {
      await admin
        .from('payment_intents')
        .update({ checkout_request_id: stkData.CheckoutRequestID })
        .eq('id', intent.id)
    } else {
      await admin
        .from('payment_intents')
        .update({ status: 'failed' })
        .eq('id', intent.id)
    }

    return new Response(JSON.stringify({ ...stkData, amount: PRICES[purpose] }), {
      headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsFor(req), 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
