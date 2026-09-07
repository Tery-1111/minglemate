import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { calculateCompatibility, UserProfile } from '../_shared/compatibilityEngine.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

serve(async () => {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, gender')
    .eq('section1_complete', true)

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

  const matches = []
  for (let firstIndex = 0; firstIndex < (users || []).length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < (users || []).length; secondIndex++) {
      const firstUser = users[firstIndex]
      const secondUser = users[secondIndex]

      if (firstUser.gender === secondUser.gender) continue

      const firstProfile = profiles.get(firstUser.id)
      const secondProfile = profiles.get(secondUser.id)
      if (!firstProfile || !secondProfile) continue

      const [userA, userB] = firstProfile.id < secondProfile.id
        ? [firstProfile, secondProfile]
        : [secondProfile, firstProfile]
      const result = calculateCompatibility(userA, userB)
      if (result.dealbreakers.length > 0) continue

      matches.push({
        user_a_id: userA.id,
        user_b_id: userB.id,
        compatibility_score: Math.round(result.overall),
        compatibility_drivers: {
          dimensions: result.dimensions,
          dealbreakers: result.dealbreakers
        },
        status: 'pending',
        is_visible: true
      })
    }
  }

  for (let batchStart = 0; batchStart < matches.length; batchStart += 500) {
    const batch = matches.slice(batchStart, batchStart + 500)
    const { error: upsertError } = await supabase
      .from('matches')
      .upsert(batch, { onConflict: 'user_a_id,user_b_id' })

    if (upsertError) {
      return new Response(JSON.stringify({ error: upsertError.message }), { status: 400 })
    }
  }

  return new Response(JSON.stringify({ success: true, matchesProcessed: matches.length }), { status: 200 })
})
