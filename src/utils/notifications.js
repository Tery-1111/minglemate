import { supabase } from '../supabaseClient'

export async function sendPushNotification(recipientUserId, message, heading = 'MingleMate') {
  try {
    // Get recipient's OneSignal player ID
    const { data: user } = await supabase
      .from('users')
      .select('onesignal_player_id')
      .eq('id', recipientUserId)
      .single()

    if (!user?.onesignal_player_id) return

    await supabase.functions.invoke('send-notification', {
      body: {
        playerIds: [user.onesignal_player_id],
        message,
        heading
      }
    })
  } catch (error) {
    console.error('Notification error:', error)
  }
}