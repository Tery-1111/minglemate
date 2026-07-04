import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// Log match actions
export const logMatchAction = async (matchId, action) => {
  const { data, error } = await supabase
    .from('match_history')
    .insert([{ match_id: matchId, action: action }]);
  if (error) throw error;
  return data;
};

// Save OneSignal Player ID
export const saveOneSignalPlayerId = async (userId, playerId) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ onesignal_player_id: playerId })
    .eq('id', userId);
  if (error) throw error;
  return data;
};
