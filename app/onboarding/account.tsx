import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ONBOARDING_DONE_KEY } from '../_layout'
import { saveFullName } from '../../lib/accountClient'
import { claimPendingReferral } from '../../lib/referralClient'
import { LOCAL_DATA_OWNER_KEY, putSetting, setting, wipeAllLocalData } from '../../lib/repo'
import { ROLE_KEY } from './role'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

type Mode = 'signup' | 'signin' | 'reset'

export default function CreateAccount() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  // Lets Profile's "Sign in" entry point land directly in sign-in mode
  // (where "Forgot password?" already lives) instead of forcing every
  // visit through signup first — onboarding itself never passes this, so
  // fresh onboarding is unaffected.
  const params = useLocalSearchParams<{ mode?: string }>()
  const initialMode: Mode = params.mode === 'signin' ? 'signin' : params.mode === 'reset' ? 'reset' : 'signup'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  async function sendResetLink() {
    if (saving || !supabase) return
    setError(null)
    setInfo(null)
    if (!email.includes('@')) {
      setError('Enter the email on your account.')
      return
    }
    setSaving(true)
    try {
      // Supabase deliberately doesn't reveal whether an email is
      // registered — showing a different message for "sent" vs "not
      // found" would leak that, so this message stays the same either way.
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'weightcutai://reset-password' })
      setInfo(`If an account exists for ${email}, a reset link is on its way. Open it on this device to set a new password.`)
    } catch (e) {
      console.error('[onboarding/account] resetPasswordForEmail failed', e)
      setError("Couldn't send a reset link. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    if (saving) return
    setError(null)

    if (!supabaseConfigured || !supabase) {
      // Backend isn't deployed yet — let onboarding continue rather than
      // dead-end here. See backend/README.md step 6.
      router.push('/onboarding/claim')
      return
    }

    if (mode === 'reset') {
      await sendResetLink()
      return
    }

    if (mode === 'signup' && (!firstName.trim() || !lastName.trim())) {
      setError('Enter your first and last name.')
      return
    }
    if (!email.includes('@') || password.length < 8) {
      setError('Enter a valid email and a password of at least 8 characters.')
      return
    }

    setSaving(true)
    try {
      let uid: string | null = null
      if (mode === 'signup') {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) {
          // A previously-confirmed email hitting signUp again is a sign-in,
          // not a sign-up — this screen had no way to tell the user that
          // until now, so retrying with the same email just dead-ended on
          // a raw "already registered" error with no path forward.
          if (signUpError.message.toLowerCase().includes('already registered')) {
            setMode('signin')
            setError('That email already has an account. Enter your password to sign in.')
            return
          }
          setError(signUpError.message)
          return
        }
        uid = signUpData.user?.id ?? null
        await saveFullName(`${firstName.trim()} ${lastName.trim()}`)
      } else {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) {
          setError(signInError.message)
          return
        }
        uid = signInData.user?.id ?? null
      }
      // Local data (profile, body stats, fight goal, meal/weight history)
      // is scoped to this device, not the account -- so before trusting
      // any of it as belonging to whoever just signed up/in, confirm it
      // actually is. Signing back into the SAME account that already owns
      // this device's local data (the ordinary sign-out-then-back-in case)
      // keeps everything as-is; landing here as a genuinely different
      // account -- switching accounts on a shared phone, or signing up
      // fresh on a device where a previous account's data was never wiped
      // because it never went through the full onboarding questionnaire
      // (e.g. the "Sign in" shortcut's own "Need an account? Sign up"
      // toggle, which skips role/body/goal entirely) -- wipes first so
      // that account starts genuinely clean on this device instead of
      // silently inheriting someone else's.
      if (uid) {
        const priorOwner = await setting(LOCAL_DATA_OWNER_KEY, '')
        if (priorOwner && priorOwner !== uid) {
          await wipeAllLocalData()
        }
        await putSetting(LOCAL_DATA_OWNER_KEY, uid)
      }
      // Only set once a real account actually exists (a fresh signUp, or a
      // successful signIn) -- this is the fix for the real access-without-
      // signup gap: see plan.tsx's finish() for the full story of why this
      // moved here.
      await putSetting(ONBOARDING_DONE_KEY, 'true')
      await claimPendingReferral() // best-effort, no-ops if no link was followed
      // A fresh fighter signup (not coach, not a returning sign-in) gets
      // routed through claim.tsx next -- this used to be reachable, but
      // only through a dead `!supabaseConfigured` branch above, which
      // never fires now that the backend is actually deployed. That left
      // claim.tsx (a fully built screen) completely stranded: no signed-up
      // fighter ever saw it. claim.tsx itself now carries the
      // cut-together/tabs routing forward once it's done (see its next()).
      if (mode === 'signup') {
        const role = await setting(ROLE_KEY, '')
        if (role === 'fighter') {
          router.replace('/onboarding/claim')
          return
        }
      }
      // Straight into the app, not /paywall -- free launch (Jean's call,
      // 2026-09-21), see app/_layout.tsx's useLaunchRoute() for the same
      // reasoning.
      router.replace('/(tabs)')
    } catch (e) {
      // Without this, a thrown (not just returned-error) auth/referral
      // failure left `saving` stuck true forever — same bug class fixed
      // elsewhere in onboarding.
      console.error('[onboarding/account] auth failed', e)
      setError(mode === 'signup' ? "Couldn't create your account. Try again." : "Couldn't sign in. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>
        {mode === 'signup' ? 'Create your account' : mode === 'signin' ? 'Sign in' : 'Reset your password'}
      </Text>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        {mode === 'signup'
          ? 'So your goal and history are never tied to just this one phone.'
          : mode === 'signin'
            ? 'Enter the email and password from when you first signed up.'
            : "We'll email you a link to set a new one."}
      </Text>

      <View style={{ padding: spacing.lg }}>
        {mode === 'signup' ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={theme.textFaint}
              style={{
                flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text, fontSize: 17,
              }}
            />
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor={theme.textFaint}
              style={{
                flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text, fontSize: 17,
              }}
            />
          </View>
        ) : null}
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text, fontSize: 17, marginBottom: spacing.md,
          }}
        />
        {mode !== 'reset' ? (
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={theme.textFaint}
            secureTextEntry
            style={{
              backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
              padding: spacing.md, color: theme.text, fontSize: 17,
            }}
          />
        ) : null}
        {info ? (
          <View style={{ backgroundColor: theme.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
            <Text style={[type.caption, { color: theme.textMuted }]}>{info}</Text>
          </View>
        ) : null}
        {error ? (
          <View style={{ backgroundColor: theme.danger + '22', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
            <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>
          </View>
        ) : null}
        {!supabaseConfigured ? (
          <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.md }]}>
            Backend not connected yet. This step is a placeholder for now.
          </Text>
        ) : null}

        {mode === 'signin' ? (
          <Pressable accessibilityRole="button" onPress={() => switchMode('reset')} style={{ marginTop: spacing.md, alignSelf: 'center' }}>
            <Text style={[type.caption, { color: theme.textMuted }]}>Forgot password?</Text>
          </Pressable>
        ) : null}

        {mode === 'reset' ? (
          <Pressable accessibilityRole="button" onPress={() => switchMode('signin')} style={{ marginTop: spacing.lg, alignSelf: 'center' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>
              Back to <Text style={{ color: theme.primary, fontWeight: '700' }}>sign in</Text>
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
            style={{ marginTop: spacing.lg, alignSelf: 'center' }}
          >
            <Text style={[type.body, { color: theme.textMuted }]}>
              {mode === 'signup' ? 'Already have an account? ' : 'Need an account? '}
              <Text style={{ color: theme.primary, fontWeight: '700' }}>
                {mode === 'signup' ? 'Sign in' : 'Sign up'}
              </Text>
            </Text>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={next}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>
            {saving ? 'Please wait…' : mode === 'signup' ? 'Continue' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
