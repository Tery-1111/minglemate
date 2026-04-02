import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizeAnswer } from './normalize.ts'
import { categoryWeights } from './weights.ts'
import { cosineSimilarity, jaccardSimilarity, complementarityScore } from './similarity.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getWeekId(): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${week}`
}

function getPreviousWeekId(): string {
  const now = new Date()
  now.setDate(now.getDate() - 7)
  const start = new Date(now.getFullYear(), 0, 1)
  const week = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
  return `${now.getFullYear()}-W${week}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    )

    const weekId = getWeekId()
    const prevWeekId = getPreviousWeekId()

    const { data: campuses } = await supabase
      .from('campuses')
      .select('id')
      .eq('matching_enabled', true)
      .eq('is_active', true)

    if (!campuses || campuses.length === 0) {
      return new Response(JSON.stringify({ message: 'No active campuses' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let totalMatches = 0

    for (const campus of campuses) {
      const matchesCreated = await runMatchingForCampus(supabase, campus.id, weekId, prevWeekId)
      totalMatches += matchesCreated
    }

    return new Response(JSON.stringify({ success: true, totalMatches, weekId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Matching error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

async function runMatchingForCampus(supabase: any, campusId: string, weekId: string, prevWeekId: string): Promise<number> {
  const { data: users } = await supabase
    .from('users')
    .select('id, gender, interests')
    .eq('campus_id', campusId)
    .eq('profile_status', 'active')

  if (!users || users.length < 2) return 0

  const userIds = users.map((u: any) => u.id)

  const { data: responses } = await supabase
    .from('section1_responses')
    .select('user_id, question_number, answer_value, category')
    .in('user_id', userIds)

  const vectors: Record<string, number[]> = {}
  for (const userId of userIds) {
    const userResponses = (responses || []).filter((r: any) => r.user_id === userId)
    const vector: number[] = []
    for (let q = 1; q <= 40; q++) {
      const response = userResponses.find((r: any) => r.question_number === q)
      if (response) {
        const normalized = normalizeAnswer(q, response.answer_value)
        const weight = categoryWeights[response.category] || 1.0
        vector.push(normalized * weight)
      } else {
        vector.push(0.5)
      }
    }
    vectors[userId] = vector
  }

  const { data: lastWeekMatches } = await supabase
    .from('match_history')
    .select('user_id, tier1_match_id, tier2_match_id')
    .in('user_id', userIds)
    .eq('week_id', prevWeekId)

  const previousPairs = new Set<string>()
  for (const match of (lastWeekMatches || [])) {
    if (match.tier1_match_id) previousPairs.add(`${match.user_id}-${match.tier1_match_id}`)
    if (match.tier2_match_id) previousPairs.add(`${match.user_id}-${match.tier2_match_id}`)
  }

  const { data: engagement } = await supabase
    .from('engagement_metrics')
    .select('user_id, tier3_score')
    .in('user_id', userIds)
    .eq('week_id', prevWeekId)

  const engagementMap: Record<string, number> = {}
  for (const e of (engagement || [])) {
    engagementMap[e.user_id] = e.tier3_score || 1.0
  }

  let matchesCreated = 0

  for (const user of users) {
    const candidates = users.filter((u: any) =>
      u.id !== user.id && u.gender !== user.gender
    )

    if (candidates.length === 0) continue

    const scored = candidates.map((candidate: any) => {
      const vecA = vectors[user.id] || []
      const vecB = vectors[candidate.id] || []

      const simScore = cosineSimilarity(vecA, vecB)
      const tagBoost = jaccardSimilarity(user.interests || [], candidate.interests || []) * 0.2
      const engMultiplier = engagementMap[candidate.id] || 1.0
      const tier1Score = (simScore + tagBoost) * engMultiplier

      const compScore = complementarityScore(vecA, vecB)
      const tier2Score = (simScore * 0.5 + compScore * 0.5 + tagBoost) * engMultiplier

      const wasMatchedBefore = previousPairs.has(`${user.id}-${candidate.id}`)

      return { id: candidate.id, tier1Score, tier2Score, wasMatchedBefore, interests: candidate.interests }
    })

    const tier1Sorted = [...scored]
      .filter(c => !c.wasMatchedBefore)
      .sort((a, b) => b.tier1Score - a.tier1Score)

    const tier1Candidates = tier1Sorted.length > 0
      ? tier1Sorted
      : scored.sort((a, b) => b.tier1Score - a.tier1Score)

    const tier1Match = tier1Candidates[0]
    if (!tier1Match) continue

    const tier2Sorted = scored
      .filter(c => c.id !== tier1Match.id)
      .sort((a, b) => b.tier2Score - a.tier2Score)

    const tier2Match = tier2Sorted[0] || tier1Candidates[1]

    await supabase.from('match_history').upsert({
      user_id: user.id,
      week_id: weekId,
      tier1_match_id: tier1Match.id,
      tier2_match_id: tier2Match?.id || null,
      delivered_at: new Date().toISOString()
    }, { onConflict: 'user_id,week_id' })

    await supabase.from('compatibility_scores').upsert({
      user_id_a: user.id,
      user_id_b: tier1Match.id,
      tier1_score: tier1Match.tier1Score,
      tier2_score: tier2Match?.tier2Score || 0,
      tier4_boost: jaccardSimilarity(user.interests || [], tier1Match.interests || []) * 0.2,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id_a,user_id_b' })

    matchesCreated++
  }

  return matchesCreated
}