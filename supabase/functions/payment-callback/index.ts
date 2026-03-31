import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const body = await req.json()
    const result = body?.Body?.stkCallback

    if (!result) {
      return new Response('ok', { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Payment failed
    if (result.ResultCode !== 0) {
      console.log('Payment failed:', result.ResultDesc)
      return new Response('ok', { status: 200 })
    }

    // Payment succeeded
    const metadata = result.CallbackMetadata?.Item || []
    const txnId = metadata.find((i: any) => i.Name === 'MpesaReceiptNumber')?.Value
    const amount = metadata.find((i: any) => i.Name === 'Amount')?.Value
    const phone = metadata.find((i: any) => i.Name === 'PhoneNumber')?.Value

    // Find user by phone and unlock Section 2
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('phone', String(phone))
      .single()

    if (user) {
      await supabase
        .from('users')
        .update({ section2_unlocked: true })
        .eq('id', user.id)

      await supabase
        .from('token_purchases')
        .insert({
          user_id: user.id,
          mpesa_transaction_id: txnId,
          amount: amount
        })
    }

    return new Response('ok', { status: 200 })

  } catch (error) {
    console.error('Callback error:', error)
    return new Response('ok', { status: 200 })
  }
})