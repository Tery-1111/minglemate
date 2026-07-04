import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const url = new URL(req.url)
    const body = await req.json()

    // PATH 1: INITIALIZE STK PUSH (Triggered by your Payment.jsx page)
    if (url.pathname.endsWith('/request-stk')) {
      const { userId, phone, amount } = body

      const intasendResponse = await fetch("https://sandbox.intasend.com/api/v1/payment/mpesa-stk-push/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get('INTASEND_SECRET_KEY')}`
        },
        body: JSON.stringify({
          public_key: Deno.env.get('INTASEND_PUBLIC_KEY'),
          first_name: "MingleMate",
          last_name: "Subscriber",
          email: "billing@minglemate.com",
          phone_number: phone,
          amount: amount,
          host: "https://minglemate.com",
          api_ref: userId 
        })
      })

      const intasendData = await intasendResponse.json()
      
      if (!intasendResponse.ok) throw new Error(intasendData.errors?.[0]?.detail || "IntaSend failed")

      return new Response(JSON.stringify({ success: true, invoice: intasendData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }

    // PATH 2: WEBHOOK CALLBACK (Triggered automatically by IntaSend on payment success)
    if (url.pathname.endsWith('/callback')) {
      const { invoice_id, state, api_ref } = body

      if (state === "COMPLETE" && api_ref) {
        const userId = api_ref

        // FLIP MASTER ACCESS SWITCH FOR THE USER
        const { error: updateError } = await supabaseClient
          .from('users')
          .update({ section2_unlocked: true })
          .eq('id', userId)

        if (updateError) throw updateError
      }

      return new Response(JSON.stringify({ status: "processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }

    return new Response("Not Found", { status: 404 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400
    })
  }
})