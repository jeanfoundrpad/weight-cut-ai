import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { stashPendingReferral } from '../../lib/referralClient'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

/** Opened via a shared referral link (weightcutai://refer/ABC123). */
export default function ReferralLanding() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { code } = useLocalSearchParams<{ code: string }>()
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setSignedIn(false)
      return
    }
    void supabase.auth.getUser().then(({ data }) => setSignedIn(data.user != null))
  }, [])

  async function continueToSignup() {
    await stashPendingReferral(code)
    router.push('/onboarding/account')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.xl, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[type.title, { color: theme.text, textAlign: 'center' }]}>You've been invited to Weight Cut AI</Text>

      {signedIn ? (
        <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.md }]}>
          You're already signed in. Referral links only apply to new accounts.
        </Text>
      ) : (
        <>
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.md }]}>
            Create your account to get started.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={continueToSignup}
            style={{ marginTop: spacing.xl, height: 56, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Create account</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}
