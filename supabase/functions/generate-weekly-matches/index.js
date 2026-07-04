import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get('SUPABASE_URL'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
)

serve(async (req) => {
  // 1. Fetch Users
  const { data: users } = await supabase.from('users').select('id, section2_responses').not('section2_responses', 'is', null);
  
  // 2. Fetch AI Weights
  const { data: weights } = await supabase.from('compatibility_weights').select('*');

  // 3. Simple Match Loop (For Demonstration)
  let generatedCount = 0;
  
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const userA = users[i];
      const userB = users[j];
      
      let score = 0;
      // Calculate Weighted Score
      for (let q = 0; q < 10; q++) {
        if (userA.section2_responses[q] === userB.section2_responses[q]) {
          const w = weights.find(x => x.question_index === q);
          score += (1.0 * (w ? w.weight_factor : 1.0));
        }
      }

      // If score meets threshold, save to match_history
      if (score > 5.0) {
        await supabase.from('match_history').insert({
          user_id: userA.id,
          tier1_match_id: userB.id,
          week_id: '2026-W22' // Adjust as needed
        });
        generatedCount++;
      }
    }
  }

  return new Response(JSON.stringify({ records_generated: generatedCount }), { 
    headers: { "Content-Type": "application/json" } 
  });
})