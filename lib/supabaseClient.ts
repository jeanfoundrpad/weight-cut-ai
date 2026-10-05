import Constants from 'expo-constants'
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string }

export const supabaseConfigured = Boolean(extra.supabaseUrl && extra.supabaseAnonKey)

/**
 * Session/refresh tokens were sitting in plaintext AsyncStorage while
 * expo-secure-store sat installed and unused (found by an independent
 * code review) -- SecureStore backs onto the device Keychain (iOS) /
 * Keystore (Android), the standard place for this, not app-sandbox files
 * a backup extraction or a compromised/jailbroken device can read
 * directly.
 *
 * Not the full encrypt-AsyncStorage-with-a-Keychain-held-key pattern
 * Supabase's own docs describe for React Native -- that needs
 * react-native-get-random-values, a native module, which would force a
 * fresh EAS build for a JS-only change this session has otherwise
 * avoided. This is the simpler version: write straight to SecureStore,
 * and only fall back to AsyncStorage for a value that actually exceeds
 * its ~2KB per-key limit (a real constraint on this exact table, not
 * theoretical) so a large session can never silently fail to persist.
 * The common case (a normal-sized session) gets the full Keychain
 * protection; the rare oversized one degrades to what this already had,
 * never gets worse.
 */
const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const fromSecure = await SecureStore.getItemAsync(key).catch(() => null)
    if (fromSecure !== null) return fromSecure
    return AsyncStorage.getItem(key)
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value)
      await AsyncStorage.removeItem(key).catch(() => {})
    } catch (e) {
      console.error('[supabaseClient] SecureStore write failed, falling back to AsyncStorage', e)
      await AsyncStorage.setItem(key, value)
    }
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key).catch(() => {})
    await AsyncStorage.removeItem(key).catch(() => {})
  },
}

/**
 * Null until app.json's expo.extra.supabaseUrl/supabaseAnonKey are set (see
 * backend/README.md step 6) — every call site checks `supabaseConfigured`
 * first and falls back gracefully, same reasoning as the AI proxy and
 * entitlement mocks: this app is fully demoable before a real backend
 * exists.
 */
export const supabase = supabaseConfigured
  ? createClient(extra.supabaseUrl!, extra.supabaseAnonKey!, {
      auth: { storage: secureSessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    })
  : null
