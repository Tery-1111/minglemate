import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

export async function saveOneSignalPlayerId(userId) {
  try {
    await window.OneSignalDeferred?.push(async function(OneSignal) {
      const playerId = await OneSignal.User.PushSubscription.id
      if (playerId && userId) {
        await supabase
          .from('users')
          .update({ onesignal_player_id: playerId })
          .eq('id', userId)
      }
    })
  } catch (error) {
    console.error('OneSignal player ID save error:', error)
  }
}