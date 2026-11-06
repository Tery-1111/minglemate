import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { calculateCompatibility, UserProfile } from '../_shared/compatibilityEngine.ts'
import { areEligibleCandidates, pairKey } from '../_shared/matchingEligibility.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// verify_jwt is enabled for this function, so the gateway has already verified
// the signature of the Authorization bearer token before this code runs. Here
// we only read its role claim to recognise the cron/service caller.
function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace('Bearer ', '').trim()
    const segment = token.split('.')[1]
    if (!segment) return null
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=')
    return JSON.parse(atob(padded))?.role ?? null
  } catch {
    return null
  }
}

// Weekly release time: matches generated at 17:30 UTC are released at 18:00 UTC
// the same day. match_history RLS only exposes rows whose delivered_at <= now(),
// so stamping delivered_at is what releases them. A run after 18:00 UTC (for
// example a manual re-run) releases immediately.
function releaseTimestamp(now = new Date()): string {
  const release = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0, 0))
  return (now.getTime() < release.getTime() ? release : now).toISOString()
}

serve(async (req) => {
  // H5 fix: only admins or the cron/service may run the generator.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const presentedKey = req.headers.get('apikey') || ''
  const authHeader = req.headers.get('Authorization') || ''
  const isService = (serviceKey !== '' && presentedKey === serviceKey) || bearerRole(authHeader) === 'service_role'
  if (!isService) {
    const token = authHeader.replace('Bearer ', '').trim()
    let authorized = false
    if (token) {
      try {
        const { data } = await supabase.auth.getUser(token)
        if (data?.user) {
          const { data: member } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', data.user.id)
            .maybeSingle()
          authorized = Boolean(member)
        }
      } catch {
        authorized = false
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    }
  }

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, gender, campus_id')
    .eq('section1_complete', true)
    // Account states: paused/pending-deletion profiles leave matching
    .eq('profile_status', 'active')

  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 400 })
  }

  const userIds = (users || []).map(user => user.id)
  if (userIds.length === 0) {
    return new Response(JSON.stringify({ success: true, matchesProcessed: 0 }), { status: 200 })
  }

  const { data: responses, error: responsesError } = await supabase
    .from('user_responses')
    .select('user_id, responses_array')
    .in('user_id', userIds)

  if (responsesError) {
    return new Response(JSON.stringify({ error: responsesError.message }), { status: 400 })
  }

  const profiles = new Map<string, UserProfile>()
  for (const response of responses || []) {
    const answers: Record<number, string> = {}
    for (let questionNumber = 1; questionNumber <= 50; questionNumber++) {
      answers[questionNumber] = response.responses_array[questionNumber - 1]
    }
    profiles.set(response.user_id, { id: response.user_id, answers })
  }

  // Load block relationships once; skip blocked pairs during pairing.
  const { data: blockRows } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
  const blockedPairs = new Set<string>()
  for (const b of blockRows || []) {
    blockedPairs.add(pairKey(b.blocker_id, b.blocked_id))
  }

  // Weekly compatibility pairs, held in memory only. These are NOT
  // `matches` rows: that table holds Qrashe pairs created by the paid
  // Force Connect flow, and the app reads every status='active' row
  // there as a Qrashe match — writing a weekly pair into it would
  // mislabel that pair. Weekly delivery below goes to match_history,
  // which is what the Matches screen and Match Celebration read.
  const pairs = []
  for (let firstIndex = 0; firstIndex < (users || []).length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < (users || []).length; secondIndex++) {
      const firstUser = users[firstIndex]
      const secondUser = users[secondIndex]

      // Campus equality is strict: matching-campus users and unaffiliated
      // null/null users may pair, but no cross-campus or mixed-null pair can.
      // Gender and block exclusions remain part of the same eligibility rule.
      if (!areEligibleCandidates(firstUser, secondUser, blockedPairs)) continue

      const firstProfile = profiles.get(firstUser.id)
      const secondProfile = profiles.get(secondUser.id)
      if (!firstProfile || !secondProfile) continue

      const [userA, userB] = firstProfile.id < secondProfile.id
        ? [firstProfile, secondProfile]
        : [secondProfile, firstProfile]
      const result = calculateCompatibility(userA, userB)

      // Score is kept for this run's ranking only.
      pairs.push({
        user_a_id: userA.id,
        user_b_id: userB.id,
        compatibility_score: Math.round(result.overall)
      })
    }
  }

  // Deliver weekly Tier 1 / Tier 2 matches per user, compatible with the existing
  // match_history read path used by the Matches page. Tier 1 = highest overall
  // compatibility; Tier 2 = next-best distinct partner. Previous-week partners are
  // skipped when alternatives exist so users see fresh matches.
  const weekId = getWeekId()
  const { data: lastWeek } = await supabase
    .from('match_history')
    .select('user_id, tier1_match_id, tier2_match_id')
    .eq('week_id', getPreviousWeekId(weekId))

  const previousPartners = new Set<string>()
  for (const row of lastWeek || []) {
    if (row.tier1_match_id) previousPartners.add(`${row.user_id}:${row.tier1_match_id}`)
    if (row.tier2_match_id) previousPartners.add(`${row.user_id}:${row.tier2_match_id}`)
  }

  // Index the pairs by participant for fast top-2 lookup
  const byUser: Record<string, { partnerId: string; score: number }[]> = {}
  for (const m of pairs) {
    for (const [self, partner] of [[m.user_a_id, m.user_b_id], [m.user_b_id, m.user_a_id]] as const) {
      if (!byUser[self]) byUser[self] = []
      byUser[self].push({ partnerId: partner, score: m.compatibility_score })
    }
  }

  const deliveredAt = releaseTimestamp()
  const historyRows = []
  for (const user of users || []) {
    const ranked = (byUser[user.id] || [])
      .filter(entry => !previousPartners.has(`${user.id}:${entry.partnerId}`))
      .sort((a, b) => b.score - a.score)
    const fallback = (byUser[user.id] || []).sort((a, b) => b.score - a.score)
    const pool = ranked.length > 0 ? ranked : fallback
    if (pool.length === 0) continue

    historyRows.push({
      user_id: user.id,
      week_id: weekId,
      tier1_match_id: pool[0].partnerId,
      tier2_match_id: pool[1]?.partnerId ?? null,
      delivered_at: deliveredAt
    })
  }

  for (let batchStart = 0; batchStart < historyRows.length; batchStart += 500) {
    const batch = historyRows.slice(batchStart, batchStart + 500)
    const { error: historyError } = await supabase
      .from('match_history')
      .upsert(batch, { onConflict: 'user_id,week_id' })
    if (historyError) {
      return new Response(JSON.stringify({ error: historyError.message }), { status: 400 })
    }
  }

  return new Response(JSON.stringify({ success: true, matchesProcessed: pairs.length, usersDelivered: historyRows.length, deliveredAt }), { status: 200 })
})

function getWeekId(date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7)
  return `${date.getFullYear()}-W${week}`
}

function getPreviousWeekId(current: string): string {
  const [year, week] = current.split('-W').map(Number)
  const prevDate = new Date(year, 0, 1 + (week - 1) * 7 - 7)
  return getWeekId(prevDate)
}
