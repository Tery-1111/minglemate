import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { calculateCompatibility, UserProfile } from '../_shared/compatibilityEngine.ts'
import { areEligibleCandidates, isMatchableGender, pairKey } from '../_shared/matchingEligibility.ts'
import { allocateTiers, MIN_ELIGIBLE_SCORE, type ScoredEdge } from '../_shared/matchingAllocation.ts'

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

// jsonb ignores key order but not array order, so the payload is compared the
// same way the database stores it.
function canonicalPayload(rows: unknown): string {
  const list = Array.isArray(rows) ? rows : []
  return JSON.stringify(
    list.map((row) => {
      const record = (row ?? {}) as Record<string, unknown>
      return Object.keys(record).sort().map((key) => [key, record[key]])
    })
  )
}

// A publish error can arrive without a usable message: the database raises the
// fence verdicts with SQLSTATE 40001, and PostgREST responds to that class by
// dropping the connection. Whatever the transport said, the fence row holds the
// verdict, so it is read back and interpreted exactly like the SQL does.
// Returns 'stale_generation' or 'generation_conflict' when this run was fenced
// out, 'replayed' when the identical allocation is already published, and null
// when the failure is a genuine fault.
async function classifyPublishFailure(
  weekId: string,
  generation: number,
  rows: unknown[]
): Promise<'stale_generation' | 'generation_conflict' | 'replayed' | null> {
  try {
    const { data, error } = await supabase
      .from('match_week_generations')
      .select('latest_generation, latest_published_generation, published_rows')
      .eq('week_id', weekId)
      .maybeSingle()

    if (error || !data) return null

    const fence = data as {
      latest_generation?: number | string | null
      latest_published_generation?: number | string | null
      published_rows?: unknown
    }

    const latestGeneration = Number(fence.latest_generation ?? 0)
    if (generation < latestGeneration) return 'stale_generation'

    const publishedGeneration = fence.latest_published_generation
    if (publishedGeneration !== null && publishedGeneration !== undefined && Number(publishedGeneration) === generation) {
      return canonicalPayload(fence.published_rows) === canonicalPayload(rows)
        ? 'replayed'
        : 'generation_conflict'
    }

    return null
  } catch {
    return null
  }
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

  // R4 — generation fencing starts here. The generation is minted BEFORE any
  // data is read, so it orders runs by authorization rather than by arrival at
  // the write. Only the newest authorized generation may publish: the check
  // happens inside `publish_week_allocation`, in the same transaction as the
  // week replacement, so a stale run is rejected without touching anything.
  const weekId = getWeekId()
  const { data: generation, error: generationError } = await supabase
    .rpc('begin_match_generation', { p_week_id: weekId })

  if (generationError || generation === null || generation === undefined) {
    return new Response(JSON.stringify({
      error: 'generation_begin_failed',
      detail: generationError?.message ?? 'no generation returned'
    }), { status: 500 })
  }

  // Eligibility is decided by the database, not by the caller: only accounts
  // that are active on BOTH state axes and have finished Section 1 may be
  // matched. `status` is the administrator axis ('suspended' is set by the
  // admin RPC and can no longer be cleared by the client), `profile_status` is
  // the user axis ('paused' is the user's own pause). A suspended or paused
  // account must not be selected as either side of a pair.
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, gender, campus_id')
    .eq('section1_complete', true)
    .eq('status', 'active')
    .eq('profile_status', 'active')

  if (usersError) {
    return new Response(JSON.stringify({ error: usersError.message }), { status: 400 })
  }

  const userIds = (users || []).map(user => user.id)
  if (userIds.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      generation,
      matchesProcessed: 0,
      eligibleUsers: 0,
      tier1Pairs: 0,
      unmatchedUsers: 0,
      tier2Pairs: 0,
      usersWithNoPartner: 0,
      excludedBlankCampus: 0,
      excludedInvalidGender: 0,
      invalidQuestionnaires: 0
    }), { status: 200 })
  }

  const { data: responses, error: responsesError } = await supabase
    .from('user_responses')
    .select('user_id, responses_array')
    .in('user_id', userIds)

  if (responsesError) {
    return new Response(JSON.stringify({ error: responsesError.message }), { status: 400 })
  }

  // `responses_array` is a nullable text[] written by the client, so a row can be
  // absent, NULL, empty or hold non-string entries. A malformed row must NEVER be
  // read as a valid answer set, and must never abort the week: the participant is
  // excluded and counted, and everyone else is still matched. (R1 of
  // docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md.)
  const invalidQuestionnaires: string[] = []
  const profiles = new Map<string, UserProfile>()
  for (const response of responses || []) {
    const raw: unknown = response.responses_array
    if (!Array.isArray(raw)) {
      invalidQuestionnaires.push(response.user_id)
      continue
    }
    const answers: Record<number, string> = {}
    for (let questionNumber = 1; questionNumber <= 50; questionNumber++) {
      const value = raw[questionNumber - 1]
      if (typeof value === 'string' && value.trim() !== '') {
        answers[questionNumber] = value
      }
    }
    if (Object.keys(answers).length === 0) {
      invalidQuestionnaires.push(response.user_id)
      continue
    }
    profiles.set(response.user_id, { id: response.user_id, answers })
  }
  if (invalidQuestionnaires.length > 0) {
    console.warn('skipped malformed questionnaires', {
      count: invalidQuestionnaires.length,
      userIds: invalidQuestionnaires
    })
  }

  // Load block relationships once; skip blocked pairs during pairing.
  // A failure here is NOT an empty result. Treating it as one would pair users
  // who blocked each other, so the run aborts before anything is allocated.
  const { data: blockRows, error: blocksError } = await supabase
    .from('user_blocks')
    .select('blocker_id, blocked_id')
  if (blocksError) {
    return new Response(JSON.stringify({ error: 'restriction_query_failed', detail: blocksError.message }), { status: 500 })
  }
  const blockedPairs = new Set<string>()
  for (const b of blockRows || []) {
    blockedPairs.add(pairKey(b.blocker_id, b.blocked_id))
  }

  // Campus eligibility is unchanged from the original predicate: strict equality
  // of campus_id, so two null-campus users may pair and null/'' (or any
  // different value) may not. Blank-campus users therefore stay in the run; the
  // count below is reported as information only.
  const isBlankCampus = (campus: string | null | undefined): boolean =>
    typeof campus !== 'string' || campus.trim() === ''
  const excludedBlankCampus = (users || []).filter(user => isBlankCampus(user.campus_id)).length
  const excludedInvalidGender = (users || []).filter(user => !isMatchableGender(user.gender)).length
  const eligibleUsers = (users || []).filter(user => isMatchableGender(user.gender))

  // Weekly compatibility pairs, held in memory only. These are NOT
  // `matches` rows: that table holds Qrashe pairs created by the paid
  // Force Connect flow, and the app reads every status='active' row
  // there as a Qrashe match — writing a weekly pair into it would
  // mislabel that pair. Weekly delivery below goes to match_history,
  // which is what the Matches screen and Match Celebration read.
  const scored: ScoredEdge[] = []
  for (let firstIndex = 0; firstIndex < eligibleUsers.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < eligibleUsers.length; secondIndex++) {
      const firstUser = eligibleUsers[firstIndex]
      const secondUser = eligibleUsers[secondIndex]

      // Campus equality is strict: matching-campus users and two unaffiliated
      // null/null users may pair, but no cross-campus or mixed-null pair can.
      // Gender (exactly male/female) and block exclusions are part of the same
      // eligibility rule.
      if (!areEligibleCandidates(firstUser, secondUser, blockedPairs)) continue

      const firstProfile = profiles.get(firstUser.id)
      const secondProfile = profiles.get(secondUser.id)
      if (!firstProfile || !secondProfile) continue

      const [userA, userB] = firstProfile.id < secondProfile.id
        ? [firstProfile, secondProfile]
        : [secondProfile, firstProfile]
      const result = calculateCompatibility(userA, userB)

      // Score is kept for the allocator's ranking only. Below the 5% floor a
      // pair is never an edge in either tier: 5% is a coverage fallback, not
      // real compatibility.
      const score = Math.round(result.overall)
      if (score < MIN_ELIGIBLE_SCORE) continue

      scored.push({ a: userA.id, b: userB.id, score })
    }
  }

  // Deliver weekly Tier 1 / Tier 2 matches per user, compatible with the
  // existing match_history read path used by the Matches page.
  //
  // Tier 1 is one global MUTUAL matching: as many users as possible receive a
  // first match, then total compatibility decides who pairs, then repeat
  // avoidance. Tier 2 is a RECOVERY pass, not a second full matching: it only
  // considers pairs that include a user left without a Tier 1 partner, so two
  // already-matched users never pair again and Tier 1 is never displaced.
  // Last week's partner is a soft preference, never a hard exclusion, so it can
  // never reduce coverage.
  const { data: lastWeek, error: lastWeekError } = await supabase
    .from('match_history')
    .select('user_id, tier1_match_id, tier2_match_id')
    .eq('week_id', getPreviousWeekId(weekId))

  if (lastWeekError) {
    // Same reasoning as the block list: an unreadable history must not be read
    // as "nobody matched last week", or we would silently serve repeats.
    return new Response(JSON.stringify({ error: 'repeat_query_failed', detail: lastWeekError.message }), { status: 500 })
  }

  // Repeat pairs are stored in the canonical, direction-free `a|b` form so a
  // row on either side of last week's pair marks both users.
  const previousPartners = new Set<string>()
  for (const row of lastWeek || []) {
    if (row.tier1_match_id) previousPartners.add(pairKey(row.user_id, row.tier1_match_id))
    if (row.tier2_match_id) previousPartners.add(pairKey(row.user_id, row.tier2_match_id))
  }

  // Only users with a questionnaire can be scored; that is unchanged from the
  // old pair builder, which skipped any pair missing a profile.
  const participants = eligibleUsers.filter(user => profiles.has(user.id)).map(user => user.id)

  let allocation
  try {
    allocation = allocateTiers(participants, scored, previousPartners)
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'allocation_failed'
    console.error('allocation failed', { error: (err as Error).message, code })
    return new Response(JSON.stringify({ error: code, detail: (err as Error).message }), { status: 500 })
  }

  const deliveredAt = releaseTimestamp()

  // Final pre-publish gate: besides the allocator's own structural validation,
  // re-check every published pair against the rules the database and the
  // eligibility predicate impose. Any violation aborts before the write.
  const eligibleById = new Set(participants)
  const campusOf = new Map((users || []).map(user => [user.id, user.campus_id]))
  const genderOf = new Map((users || []).map(user => [user.id, user.gender]))
  const publishedPairs: Array<[string, string, string]> = [
    ...allocation.tier1Pairs.map(pair => ['tier1', pair[0], pair[1]] as [string, string, string]),
    ...allocation.tier2Pairs.map(pair => ['tier2', pair[0], pair[1]] as [string, string, string])
  ]
  for (const [tier, a, b] of publishedPairs) {
    if (!eligibleById.has(a) || !eligibleById.has(b)) {
      return new Response(JSON.stringify({ error: 'validation_failed', detail: `${tier} ${a}/${b} is outside the eligible population` }), { status: 500 })
    }
    if (blockedPairs.has(pairKey(a, b))) {
      return new Response(JSON.stringify({ error: 'validation_failed', detail: `${tier} ${a}/${b} is a blocked pair` }), { status: 500 })
    }
    if (campusOf.get(a) !== campusOf.get(b)) {
      return new Response(JSON.stringify({ error: 'validation_failed', detail: `${tier} ${a}/${b} is not a same-campus pair` }), { status: 500 })
    }
    if (!areEligibleCandidates(
      { id: a, gender: genderOf.get(a) ?? null, campus_id: campusOf.get(a) ?? null },
      { id: b, gender: genderOf.get(b) ?? null, campus_id: campusOf.get(b) ?? null },
      blockedPairs
    )) {
      return new Response(JSON.stringify({ error: 'validation_failed', detail: `${tier} ${a}/${b} is not an eligible pair` }), { status: 500 })
    }
  }

  const historyRows = []
  for (const user of eligibleUsers) {
    const tier1Partner = allocation.tier1.get(user.id)
    const tier2Partner = allocation.tier2.get(user.id)
    if (!tier1Partner && !tier2Partner) continue

    historyRows.push({
      user_id: user.id,
      week_id: weekId,
      tier1_match_id: tier1Partner ?? null,
      tier2_match_id: tier2Partner ?? null,
      delivered_at: deliveredAt
    })
  }

  // Publish in ONE fenced, atomic, week-scoped replacement. The database
  // function checks the generation fence, deletes this week's rows and inserts
  // the new allocation in a single transaction: a stale run is rejected before
  // any write, and a failure rolls the delete back so the previously published
  // allocation survives. Historical weeks are never touched.
  if (historyRows.length === 0) {
    console.warn('week cleared', { weekId, generation, participants: participants.length })
  }

  let publishResult: unknown = null
  let historyError: { message?: string; code?: string } | null = null
  try {
    const published = await supabase
      .rpc('publish_week_allocation', {
        p_week_id: weekId,
        p_generation: generation,
        p_rows: historyRows
      })
    publishResult = published.data
    historyError = published.error
  } catch (err) {
    // A transport failure (connection reset, gateway timeout) carries no
    // database verdict. The fence row is read back below in that case only.
    historyError = { message: (err as Error)?.message ?? '' }
  }

  if (historyError) {
    const code = String(historyError.code ?? '')
    const message = String(historyError.message ?? '')

    // Both rejections are fence verdicts, not faults: the database refused the
    // write and nothing was published. The database raises them as PT409, which
    // PostgREST passes through unchanged, so they are answered immediately and
    // nothing else is ever promoted to a conflict.
    let fenced: 'stale_generation' | 'generation_conflict' | null =
      code === 'PT409' && message === 'stale_generation'
        ? 'stale_generation'
        : code === 'PT409' && message === 'generation_conflict'
          ? 'generation_conflict'
          : null

    if (!fenced && code === '') {
      // No code at all means the response never arrived: the verdict, if there
      // is one, has to be read back from the fence row. A coded database error
      // is never reinterpreted here — it stays a failure.
      const verdict = await classifyPublishFailure(weekId, generation, historyRows)
      if (verdict === 'replayed') {
        // The write did land before the connection failed. Treat it as the
        // idempotent replay it is instead of reporting a failure.
        publishResult = { published: historyRows.length, generation, replayed: true }
        historyError = null
      } else if (verdict) {
        fenced = verdict
      }
    }

    if (historyError) {
      return new Response(JSON.stringify({
        error: fenced ?? 'publish_failed',
        detail: message,
        generation
      }), { status: fenced ? 409 : 500 })
    }
  }

  const published = (publishResult as { published?: number } | null)?.published
  if (typeof published === 'number' && published !== historyRows.length) {
    console.error('publish count mismatch', {
      weekId,
      generation,
      expected: historyRows.length,
      published
    })
    return new Response(JSON.stringify({
      error: 'publish_count_mismatch',
      detail: `${published} rows published, ${historyRows.length} expected`,
      generation
    }), { status: 500 })
  }

  return new Response(JSON.stringify({
    success: true,
    generation,
    published: historyRows.length,
    matchesProcessed: scored.length,
    usersDelivered: historyRows.length,
    eligibleUsers: participants.length,
    tier1Pairs: allocation.tier1Pairs.length,
    unmatchedUsers: allocation.unmatched.length,
    tier2Pairs: allocation.tier2Pairs.length,
    usersWithNoPartner: allocation.noPartner.length,
    excludedBlankCampus,
    excludedInvalidGender,
    invalidQuestionnaires: invalidQuestionnaires.length,
    deliveredAt
  }), { status: 200 })
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
