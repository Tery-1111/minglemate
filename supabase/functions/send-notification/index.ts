import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// M7: restrict browser callers to our own origins.
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

// H2 fix: callers must be authenticated, and recipients are
// resolved SERVER-side by user id — the client can no longer
// supply player IDs (which were readable off any user's row
// before the column lockdown) or arbitrary target devices.

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) })
  }

  try {
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

    const { recipientIds, message, heading } = await req.json()

    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No recipients provided' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
      })
    }
    if (recipientIds.length > 10) {
      return new Response(JSON.stringify({ error: 'Too many recipients' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
      })
    }
    if (typeof message !== 'string' || message.length > 500) {
      return new Response(JSON.stringify({ error: 'Invalid message' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 400
      })
    }

    // Resolve player IDs from the DB — never from the request.
    const { data: users, error: lookupError } = await admin
      .from('users')
      .select('id, onesignal_player_id')
      .in('id', recipientIds)
    if (lookupError) throw lookupError

    const playerIds = (users || [])
      .map((u: any) => u.onesignal_player_id)
      .filter(Boolean)

    if (playerIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, detail: 'Recipients have no push subscriptions' }), {
        headers: { ...corsFor(req), 'Content-Type': 'application/json' }, status: 200
      })
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Deno.env.get('ONESIGNAL_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: Deno.env.get('ONESIGNAL_APP_ID'),
        include_player_ids: playerIds,
        headings: { en: heading || 'MingleMate' },
        contents: { en: message }
      })
    })

    const data = await response.json()
    return new Response(JSON.stringify(data), {
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
