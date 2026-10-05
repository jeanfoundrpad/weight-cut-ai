import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { currentFightGoal, type FightGoal } from '../lib/repo'
import { radius, spacing, type, useTheme, type Theme } from '../lib/theme'

const DAY_MS = 24 * 60 * 60 * 1000

function daysUntil(ms: number): number {
  return Math.ceil((ms - Date.now()) / DAY_MS)
}

function Phase({ title, days, children, theme }: { title: string; days: string; children: React.ReactNode; theme: Theme }) {
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Text style={[type.bodyStrong, { color: theme.text, fontSize: 18 }]}>{title}</Text>
        <Text style={[type.caption, { color: theme.textFaint }]}>{days}</Text>
      </View>
      {children}
    </View>
  )
}

function Bullet({ text, theme }: { text: string; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
      <Text style={{ color: theme.textMuted }}>{'•'}</Text>
      <Text style={[type.body, { color: theme.textMuted, flex: 1, lineHeight: 20 }]}>{text}</Text>
    </View>
  )
}

/**
 * Educational checklist only, deliberately not a calculator. The weeks-long
 * calorie cut already has real math behind it (weightCutMath.ts), but the
 * final-24-to-36-hour water manipulation phase is a different, more acute
 * risk: getting a specific water/sodium number wrong can cause
 * hyponatremia, a genuine medical emergency. Auto-prescribing exact amounts
 * without a coach or medical professional actually watching the athlete is
 * a real safety liability this app should not take on. This screen states
 * general, widely-published safe practice and hard caps, then defers the
 * specific numbers to a professional — same posture as the BMI and macro
 * disclaimers already used elsewhere in the app.
 */
export default function FightWeek() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [goal, setGoal] = useState<FightGoal | null>(null)

  useEffect(() => {
    void currentFightGoal().then(setGoal)
  }, [])

  const days = goal ? daysUntil(goal.weighInDateMs) : null

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, padding: spacing.lg, paddingBottom: 140 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Fight week</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      {days != null ? (
        <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.xs }]}>
          {days > 0 ? `${days} days until weigh-in` : 'Weigh-in day'}
        </Text>
      ) : (
        <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.xs }]}>
          No weigh-in date set yet.
        </Text>
      )}

      <View style={{ marginTop: spacing.lg, borderWidth: 1, borderColor: theme.danger, borderRadius: radius.md, padding: spacing.md }}>
        <Text style={[type.caption, { color: theme.danger, lineHeight: 18 }]}>
          This is general education, not a personal prescription. Water and sodium manipulation this close to a
          weigh-in carries real risk, including hyponatremia. Do this only with a coach, athletic trainer, or
          doctor who can watch you in person, especially the first time.
        </Text>
      </View>

      <Phase title="Water load" days="Days 6 to 3 out" theme={theme}>
        <Bullet text="Gradually increase water intake above your normal daily amount over several days, not all at once." theme={theme} />
        <Bullet text="The goal is to prime your body to flush water faster once intake drops, not to gain weight." theme={theme} />
        <Bullet text="Keep sodium roughly normal during this phase; sodium changes matter more in the next phase." theme={theme} />
      </Phase>

      <Phase title="Water cut" days="Final 24 to 36 hours" theme={theme}>
        <Bullet text="Water and sodium intake drop sharply, following a plan a coach or dietitian has already reviewed with you." theme={theme} />
        <Bullet text="A widely cited safe ceiling is cutting no more than 5 to 8% of bodyweight through water in this window. More than that sharply raises real risk, not just discomfort." theme={theme} />
        <Bullet text="Stop and seek medical help for confusion, severe headache, cramping that doesn't resolve, or dizziness that doesn't improve with rest." theme={theme} />
      </Phase>

      <Phase title="Rehydration" days="After weigh-in" theme={theme}>
        <Bullet text="Rehydrate gradually with fluids and electrolytes, not all at once, over several hours before competing." theme={theme} />
        <Bullet text="Pair fluids with easily digested carbs and sodium to help your body actually retain what you drink." theme={theme} />
        <Bullet text="How you feel matters more than the scale number here. Don't compete if you still feel impaired." theme={theme} />
      </Phase>

      <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
        General safe-practice information only. Not medical advice, and not a substitute for in-person supervision
        from a coach, athletic trainer, or doctor.
      </Text>
    </ScrollView>
  )
}
