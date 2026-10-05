import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentFightGoal, type FightGoal } from '../../lib/repo'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

function MathRow({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm }}>
      <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

export default function PlanReveal() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [goal, setGoal] = useState<FightGoal | null>(null)

  useEffect(() => {
    void currentFightGoal().then(setGoal)
  }, [])

  async function finish() {
    // This screen is also reached by re-editing an existing goal (Profile
    // -> "Edit goal" -> fight-goal -> here), not just first-time onboarding
    // — only route to account creation when there's actually no session yet.
    //
    // ONBOARDING_DONE_KEY is deliberately NOT set here anymore. It used to
    // be set unconditionally on this screen, before account creation even
    // happened -- so someone who backed out of signup, or just closed the
    // app on that screen, got treated as fully onboarded on every future
    // launch (useLaunchRoute, app/_layout.tsx, skips straight past
    // onboarding once this flag is true) with no real account ever
    // created, and the paywall itself never checks for a session either.
    // Real access without ever signing up. It's set in account.tsx now,
    // only once signUp/signIn actually succeeds.
    if (supabaseConfigured && supabase) {
      const { data } = await supabase.auth.getUser()
      if (data.user != null) {
        router.replace('/(tabs)')
        return
      }
    }
    router.replace('/onboarding/account')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        <Text style={[type.title, { color: theme.text }]}>Your daily target</Text>
        {goal ? (
          <>
            <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
              <Text style={{ fontSize: 48, fontWeight: '800', color: theme.text, letterSpacing: -1 }}>
                {Math.round(goal.targetKcal)}
              </Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>kcal / day</Text>
              <View style={{ marginTop: spacing.md }}>
                <MathRow label="Protein" value={`${Math.round(goal.proteinG)} g`} theme={theme} />
                <MathRow label="Fat" value={`${Math.round(goal.fatG)} g`} theme={theme} />
                <MathRow label="Carbs" value={`${Math.round(goal.carbsG)} g`} theme={theme} />
              </View>
            </View>
            <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.lg, lineHeight: 18 }]}>
              Based on standard sports-nutrition formulas and your target date. Not medical advice.
              Check with a doctor or dietitian before {goal.goalType === 'gain' ? 'an aggressive bulk' : 'an aggressive cut'}.
            </Text>
          </>
        ) : null}
      </ScrollView>
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          onPress={finish}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Let's go</Text>
        </Pressable>
      </View>
    </View>
  )
}
