// Health check: one trivial read query. 200 {"ok":true} when the
// database answers; 503 with no details when it doesn't. No secrets,
// no version info, no timing data in the response. Designed for
// uptime monitors (UptimeRobot etc.).
//
// Deploy (run yourself — not deployed by this task):
//   supabase functions deploy health --project-ref ifiewinipbxxfvzpzezd
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const { error } = await supabase.rpc('admin_stats_counts')
    if (error) {
      // Fall back to the simplest possible read if the RPC is absent.
      const { error: pingErr } = await supabase
        .from('app_settings')
        .select('maintenance_message')
        .limit(1)
      if (pingErr) return new Response(JSON.stringify({ ok: false }), { status: 503 })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 503 })
  }
})
