import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { supabase, supabaseConfigured } from './supabaseClient'

/**
 * "Your result is in" pushes for a claimed fighter (see 0030's
 * push_notification_outbox + trigger). A real, known limitation, stated
 * plainly rather than glossed over: getExpoPushTokenAsync() needs an EAS
 * project id (Constants.expoConfig.extra.eas.projectId) to mint a real
 * token, and this app has never been connected to an EAS project — the
 * same "Apple Developer account still an open blocker" gap noted
 * elsewhere in this project. Expo Go itself also dropped remote push
 * support (Android entirely, iOS effectively) as of SDK 53, so even with
 * a project id this can't be end-to-end tested outside a real development
 * build. Everything here is real, working infrastructure ready for that
 * moment — it just can't be exercised on this device today.
 */
export async function registerForPushNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false, error: 'Not connected.' }

  const permission = await Notifications.requestPermissionsAsync()
  if (permission.status !== 'granted') {
    return { ok: false, error: 'Notification permission was denied. You can turn it on later in your device Settings.' }
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.DEFAULT })
  }

  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  if (!projectId) {
    return { ok: false, error: "Push isn't set up for this build yet." }
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    const { error } = await supabase.rpc('save_push_token', { p_token: token })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (e) {
    console.error('[notifications] registerForPushNotifications failed', e)
    return { ok: false, error: "Couldn't get a push token on this device." }
  }
}

export async function disablePushNotifications(): Promise<{ ok: boolean }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('disable_push_notifications')
  return { ok: !error }
}

/** profiles has a plain SELECT policy for a user's own row (0001) — unlike every write on this table, reading notify_on_result doesn't need an RPC. */
export async function getNotificationPreference(): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false
  const { data } = await supabase.from('profiles').select('notify_on_result').eq('id', userData.user.id).maybeSingle()
  return data?.notify_on_result ?? false
}
