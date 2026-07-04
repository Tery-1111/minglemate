import { createClient } from '@supabase/supabase-js'

// --- CONFIGURATION ---
// Go to Supabase Dashboard -> Project Settings -> API
// Replace the values below with your specific project details
const supabaseUrl = 'https://mhdjnhiqahsllbczbzpk.supabase.co.supabase.co'
const supabaseAnonKey = 'sb_publishable_BSTqcjS73latRPIFi3-vmQ_LLkFNqHH'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// --- ANALYTICS & LOGGING ENGINE ---
// This function captures user behavior to feed your success metrics dashboard
export const logMatchAction = async (matchId, userId, action) => {
  try {
    const { error } = await supabase
      .from('match_interactions')
      .insert([{ 
        match_id: matchId, 
        user_id: userId, 
        action: action,
        created_at: new Date().toISOString()
      }])
    
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("Match Action Logging Failed:", err.message);
    return { success: false, error: err.message };
  }
}

// --- IDENTITY & INTEGRATION ---
export const saveOneSignalPlayerId = async (userId) => {
  // Add your OneSignal integration logic here
  console.log("Syncing OneSignal for:", userId);
};

// --- SYSTEM HEALTH CHECK ---
export const checkConnection = async () => {
  const { data, error } = await supabase.from('users').select('id').limit(1);
  if (error) console.error("Database connection failure:", error);
  else console.log("Database connection established.");
};