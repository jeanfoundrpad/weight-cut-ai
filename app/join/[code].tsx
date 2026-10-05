import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { joinGroupByCode } from '../../lib/groupsClient'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

/** Opened via a shared invite link (weightcutai://join/ABC123). */
export default function JoinGroup() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { code } = useLocalSearchParams<{ code: string }>()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [status, setStatus] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle')

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setSignedIn(false)
      return
    }
    void supabase.auth.getUser().then(({ data }) => setSignedIn(data.user != null))
  }, [])

  async function join() {
    setStatus('joining')
    const group = await joinGroupByCode(code)
    if (group) {
      setStatus('joined')
      router.replace({ pathname: '/group/[id]', params: { id: group.id } })
    } else {
      setStatus('error')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.title, { color: theme.text, textAlign: 'center' }]}>Join group {code}?</Text>

      {/* Checking !== true (not === false) so the still-loading null state
          also shows "Create account" rather than briefly flashing a Join
          button that would fail with a misleading "bad code" error before
          the auth check resolves — same pattern as refer/[code].tsx. */}
      {signedIn !== true ? (
        <>
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.md }]}>
            Create an account first, then use this same link again.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/onboarding/account')}
            style={{ marginTop: spacing.xl, height: 56, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Create account</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={status === 'joining'}
          onPress={join}
          style={{ marginTop: spacing.xl, height: 56, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Join</Text>
        </Pressable>
      )}

      {status === 'error' ? (
        <Text style={[type.caption, { color: theme.danger, marginTop: spacing.lg }]}>
          Couldn't find that group. Check the code and try again.
        </Text>
      ) : null}
    </View>
  )
}
