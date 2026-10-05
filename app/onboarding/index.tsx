import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ONBOARDING_DONE_KEY } from '../_layout'
import { setting } from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'

/**
 * If this device already finished onboarding once, landing here at all
 * means app/_layout.tsx's useLaunchRoute() found no live session for it
 * (see that file's comment) -- skip straight to sign in instead of
 * making a returning user sit through the "what is this app" pitch and
 * body-stats questions again for an account that already exists.
 */
export default function Welcome() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    void setting(ONBOARDING_DONE_KEY, '').then((done) => {
      if (!alive) return
      if (done === 'true') {
        router.replace({ pathname: '/onboarding/account', params: { mode: 'signin' } })
        return
      }
      setChecking(false)
    })
    return () => {
      alive = false
    }
  }, [])

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
        <Text style={[type.title, { color: theme.text, fontSize: 40 }]}>Weight Cut AI</Text>
        <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.md, lineHeight: 24 }]}>
          Photo-based calorie tracking built for fighters. Tell us your weigh-in weight and
          date, and every day gets a real number to hit, not a generic diet plan.
        </Text>
      </View>
      <View style={{ padding: spacing.xl }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/role')}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Get started</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/onboarding/account', params: { mode: 'signin' } })}
          style={{ marginTop: spacing.lg, alignSelf: 'center' }}
        >
          <Text style={[type.body, { color: theme.textMuted }]}>
            Already have an account? <Text style={{ color: theme.primary, fontWeight: '700' }}>Sign in</Text>
          </Text>
        </Pressable>
      </View>
    </View>
  )
}
