import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ONBOARDING_DONE_KEY } from './_layout'
import { getPendingDeepLink, waitForInitialDeepLink } from '../lib/pendingDeepLink'
import { setting } from '../lib/repo'
import { supabase, supabaseConfigured } from '../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../lib/theme'

/**
 * Supabase's recovery link puts the session tokens in the URL fragment
 * (after #), not the query string — expo-router's own param parsing only
 * covers the query side, so this reads the raw URL directly rather than
 * relying on useLocalSearchParams.
 */
function parseAuthParams(url: string): Record<string, string> {
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')
  const paramsPart = hashIndex >= 0 ? url.slice(hashIndex + 1) : queryIndex >= 0 ? url.slice(queryIndex + 1) : ''
  return Object.fromEntries(new URLSearchParams(paramsPart))
}

/**
 * Reached only via the password-reset email link
 * (weightcutai://reset-password#access_token=...&type=recovery), never
 * navigated to directly from inside the app. The Supabase client here has
 * detectSessionInUrl off (correct for RN — there's no window.location to
 * auto-read), so nothing turns that URL into a real session automatically;
 * this screen's first job is doing that by hand before it can let the user
 * set a new password.
 */
export default function ResetPassword() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [url, setUrl] = useState<string | null>(() => getPendingDeepLink())
  const [status, setStatus] = useState<'working' | 'ready' | 'invalid'>('working')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Runs once, not keyed on `url` -- a version keyed on `url` stops
  // re-subscribing the moment the first link arrives (even an invalid
  // one), so a second link tapped while this screen is still mounted (a
  // fresh request after the first one failed, without leaving the screen)
  // would go unheard. The one-time initial-deep-link lookup only needs to
  // run if nothing was captured before this screen even mounted.
  useEffect(() => {
    let alive = true
    if (!getPendingDeepLink()) {
      void waitForInitialDeepLink().then((initial) => {
        if (alive && initial) setUrl(initial)
      })
    }
    const sub = Linking.addEventListener('url', ({ url: incoming }) => setUrl(incoming))
    return () => {
      alive = false
      sub.remove()
    }
  }, [])

  useEffect(() => {
    if (!url || !supabaseConfigured || !supabase) return
    let alive = true
    const params = parseAuthParams(url)
    if (params.type !== 'recovery' || !params.access_token || !params.refresh_token) {
      setStatus('invalid')
      return
    }
    void supabase.auth
      .setSession({ access_token: params.access_token, refresh_token: params.refresh_token })
      .then(({ error: sessionError }) => {
        if (alive) setStatus(sessionError ? 'invalid' : 'ready')
      })
    return () => {
      alive = false
    }
  }, [url])

  // Some mail apps open links in an in-app browser that swallows the
  // access_token/refresh_token fragment before handing off to the app, so
  // `url` (or its params) can simply never arrive. Without this, that leaves
  // the screen stuck on "Verifying..." forever instead of telling the user
  // to try again.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setStatus((s) => (s === 'working' ? 'invalid' : s))
    }, 8000)
    return () => clearTimeout(timeout)
  }, [])

  async function submit() {
    if (saving || !supabase) return
    setError(null)
    if (password.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    setSaving(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }
      // Mirrors _layout.tsx's own useLaunchRoute() logic — a password
      // reset can happen on a reinstall or a second device before
      // onboarding ever ran locally (found by a Fable 5 review). Dropping
      // straight into '/(tabs)' there left ONBOARDING_DONE_KEY unset, so
      // the very next cold launch bounced back to onboarding despite a
      // live session, even though this screen had just put the user "in
      // the app."
      const onboardingDone = (await setting(ONBOARDING_DONE_KEY, '')) === 'true'
      router.replace(onboardingDone ? '/(tabs)' : '/onboarding')
    } catch (e) {
      console.error('[reset-password] updateUser failed', e)
      setError("Couldn't reset your password. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>Reset your password</Text>

      {status === 'working' ? (
        <Text style={[type.body, { color: theme.textMuted, padding: spacing.lg }]}>Verifying your reset link…</Text>
      ) : status === 'invalid' ? (
        <View style={{ padding: spacing.lg }}>
          <Text style={[type.body, { color: theme.textMuted }]}>
            This reset link didn't come through. Request a new one from the sign-in screen, then
            long press the link in your email and choose Open in Safari instead of tapping it
            directly. Some mail apps open links in a way that blocks the handoff back to this app.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/onboarding/account')}
            style={{
              marginTop: spacing.lg, height: 52, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Back to sign in</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ padding: spacing.lg }}>
          <Text style={[type.body, { color: theme.textMuted, marginBottom: spacing.md }]}>Choose a new password.</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="New password"
            placeholderTextColor={theme.textFaint}
            secureTextEntry
            style={{
              backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
              padding: spacing.md, color: theme.text, fontSize: 17,
            }}
          />
          {error ? (
            <View style={{ backgroundColor: theme.danger + '22', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
              <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={submit}
            style={{
              marginTop: spacing.lg, height: 56, borderRadius: radius.pill, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 17 }]}>
              {saving ? 'Please wait…' : 'Set new password'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}
