import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests smoothly
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Initialize Supabase service role client to bypass RLS during match generation
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Fetch all active users with complete Section 2 response profiles
    const { data: users, error: userError } = await supabaseClient
      .from('users')
      .select('id, gender, section2_responses')
      .not('section2_responses', 'is', null)

    if (userError) throw userError

    // Separate active candidate pools by gender vectors
    const guys = users.filter(u => u.gender?.toLowerCase() === 'male' || u.gender?.toLowerCase() === 'man')
    const girls = users.filter(u => u.gender?.toLowerCase() === 'female' || u.gender?.toLowerCase() === 'woman')

    const currentYear = new Date().getFullYear()
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
    const weekId = `${currentYear}-W${weekNum}`

    const insertionPayloads = []

    // 3. Simple Matrix Matching Loop (Guy-to-Girl routing)
    for (const guy of guys) {
      let bestTier1MatchId = null
      let highestOverlapScore = -1
      
      let bestTier2MatchId = null
      let secondHighestOverlapScore = -1

      const guyResponses = guy.section2_responses || []

      for (const girl of girls) {
        let currentOverlapScore = 0
        const girlResponses = girl.section2_responses || []

        // Calculate direct response index overlaps across all 10 questions
        for (let i = 0; i < 10; i++) {
          if (guyResponses[i] !== null && guyResponses[i] === girlResponses[i]) {
            currentOverlapScore++
          }
        }

        // Rank the matrix outputs
        if (currentOverlapScore > highestOverlapScore) {
          secondHighestOverlapScore = highestOverlapScore
          bestTier2MatchId = bestTier1MatchId

          highestOverlapScore = currentOverlapScore
          bestTier1MatchId = girl.id
        } else if (currentOverlapScore > secondHighestOverlapScore) {
          secondHighestOverlapScore = currentOverlapScore
          bestTier2MatchId = girl.id
        }
      }

      // Append mutual matching payload records for the guy's timeline
      if (bestTier1MatchId) {
        insertionPayloads.push({
          user_id: guy.id,
          week_id: weekId,
          tier1_match_id: bestTier1MatchId,
          tier2_match_id: bestTier2MatchId,
          delivered_at: new Date().toISOString()
        })

        // Mirror the match record back to the girl's timeline for symmetrical access
        insertionPayloads.push({
          user_id: bestTier1MatchId,
          week_id: weekId,
          tier1_match_id: guy.id,
          tier2_match_id: bestTier2MatchId || guy.id, // Fallback safety
          delivered_at: new Date().toISOString()
        })
      }
    }

    // 4. Batch insert calculated pairs into match_history, handling identical week conflicts cleanly
    if (insertionPayloads.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('match_history')
        .upsert(insertionPayloads, { onConflict: 'user_id, week_id' })

      if (insertError) throw insertError
    }

    return new Response(
      JSON.stringify({ success: true, records_generated: insertionPayloads.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    )
  }
})