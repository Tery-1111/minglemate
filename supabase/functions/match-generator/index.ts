import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

serve(async (req) => {
  const { userA, userB } = await req.json();

  const calculateScore = (a, b) => 0.85;
  const sharedInterests = ["coding", "latin-urban"];

  const { data: match, error } = await supabase
    .from("matches")
    .insert([{
      user_a: userA.id,
      user_b: userB.id,
      status: "pending",
      compatibility_drivers: {
        match_logic_version: "v1.0",
        shared_interests: sharedInterests,
        compatibility_score: calculateScore(userA, userB),
        drivers: [
          "Shared academic goal",
          "Alignment on relationship intent"
        ]
      }
    }]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ data: match }), { status: 200 });
});
