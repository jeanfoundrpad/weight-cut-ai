import { router } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { putSetting } from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'

export const ROLE_KEY = 'onboarding.role.v1'
export type Role = 'fighter' | 'coach'

/**
 * Asked once, right after Welcome, before anything else -- per Jean
 * directly, after fighters started using the app: onboarding never asked
 * who someone actually is. A fighter needs the body-stats/fight-goal
 * setup that follows this screen; a coach doesn't have a personal cut to
 * track, so they skip straight to account creation instead. Stored
 * locally for now (not yet a server column) -- enough to route this one
 * decision correctly; a real coach-specific surface can read this same
 * key later without a schema change.
 */
export default function Role() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  async function choose(role: Role) {
    await putSetting(ROLE_KEY, role)
    router.push(role === 'fighter' ? '/onboarding/body' : '/onboarding/account')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl }}>
        <Text style={[type.title, { color: theme.text }]}>Who's using this?</Text>
        <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.sm, lineHeight: 24 }]}>
          Fighters get a daily calorie target built around their own weigh-in. Coaches skip straight
          to tracking their team.
        </Text>
      </View>
      <View style={{ padding: spacing.xl, gap: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose('fighter')}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>I'm a fighter</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => choose('coach')}
          style={{ height: 60, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.text, fontSize: 18 }]}>I'm a coach</Text>
        </Pressable>
      </View>
    </View>
  )
}
