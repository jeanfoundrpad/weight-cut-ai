import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { promptAddMeal } from '../../lib/addMeal'
import { ProgressRing } from '../../lib/components/ProgressRing'
import { ensureDailyReminders } from '../../lib/dailyReminder'
import {
  dayExerciseCalories, dayTotals, dayWaterMl, endOfLocalDateMs, EXCLUDE_EXERCISE_CALORIES_KEY, fightGoalAsOf,
  loggingStreak, localDateFrom, logWater, recentMeals, setting, type DayTotals, type FightGoal, type MealSummary, type Streak,
} from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { ML_PER_FL_OZ } from '../../lib/units'

const QUICK_ADD_FL_OZ = [8, 16, 24]
const DAY_MS = 24 * 60 * 60 * 1000

// Signed on purpose (found by a Fable 5 review, 2026-08-10): clamping to 0
// made "10 days past the date" indistinguishable from "today is the day,"
// so a fighter who never edited their goal after competing saw "Weigh-in
// in 0 days" and the fight-week banner forever. Callers that only care
// about "how many days until" for a still-future date should treat a
// negative result as "already passed," not clamp it away here.
function daysUntil(ms: number): number {
  return Math.ceil((ms - Date.now()) / DAY_MS)
}

function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function MacroRing({ label, value, target, color, theme }: {
  label: string; value: number; target: number; color: string; theme: ReturnType<typeof useTheme>
}) {
  const remaining = Math.max(0, Math.round(target - value))
  const progress = target > 0 ? value / target : 0
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
      <ProgressRing size={64} strokeWidth={6} progress={progress} trackColor={theme.border} fillColor={color}>
        <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>{remaining}g</Text>
      </ProgressRing>
      <Text style={[type.caption, { color: theme.textMuted }]}>{label} left</Text>
    </View>
  )
}

// Editable only when browsing today — past days stay read-only on this
// screen (matching WaterCard/ExerciseCard's own `editable={isToday}`),
// since Progress's day-detail screen is the dedicated place to edit a past
// entry. Without this, today's own meals — the ones a user is most likely
// to want to fix right after logging — had no edit path anywhere at all.
function MealRow({ meal, editable, theme }: { meal: MealSummary; editable: boolean; theme: ReturnType<typeof useTheme> }) {
  const content = (
    <>
      {meal.photoUri ? (
        <Image source={{ uri: meal.photoUri }} style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: theme.surfaceRaised }} />
      ) : (
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: theme.surfaceRaised }} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>{meal.title}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          {timeOfDay(meal.loggedAt)} · {Math.round(meal.calories)} cal
        </Text>
      </View>
      {editable ? <Ionicons name="chevron-forward" size={18} color={theme.textFaint} /> : null}
    </>
  )
  const rowStyle = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md,
    backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md,
  }
  if (!editable) return <View style={rowStyle}>{content}</View>
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/camera', params: { editMealId: String(meal.id) } })}
      style={rowStyle}
    >
      {content}
    </Pressable>
  )
}

/** Last 6 days plus today — matches nut-ai's Mon-Sun home strip, tap to browse a past day read-only. */
function WeekStrip({ selectedDate, onSelect, theme }: {
  selectedDate: string; onSelect: (localDate: string) => void; theme: ReturnType<typeof useTheme>
}) {
  const today = new Date()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i))
    return { date: d, localDate: localDateFrom(d.getTime()) }
  })

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg }}>
      {days.map(({ date, localDate }) => {
        const active = localDate === selectedDate
        return (
          <Pressable
            key={localDate}
            accessibilityRole="button"
            onPress={() => onSelect(localDate)}
            style={{ alignItems: 'center', gap: spacing.xs }}
          >
            <Text style={[type.caption, { color: theme.textFaint }]}>
              {date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}
            </Text>
            <View style={{
              width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
              backgroundColor: active ? theme.text : 'transparent',
              borderWidth: active ? 0 : 1, borderColor: theme.border,
            }}>
              <Text style={[type.bodyStrong, { color: active ? theme.bg : theme.text }]}>{date.getDate()}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function WaterCard({ ml, onAdd, editable, theme }: {
  ml: number; onAdd: (flOz: number) => void; editable: boolean; theme: ReturnType<typeof useTheme>
}) {
  const flOz = Math.round(ml / ML_PER_FL_OZ)
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="water-outline" size={16} color={theme.textMuted} />
        <Text style={[type.caption, { color: theme.textMuted }]}>Water</Text>
      </View>
      <Text style={[type.title, { color: theme.text, marginTop: spacing.xs }]}>{flOz} fl oz</Text>
      {editable ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
          {QUICK_ADD_FL_OZ.map((oz) => (
            <Pressable
              key={oz}
              accessibilityRole="button"
              onPress={() => onAdd(oz)}
              style={{
                paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill,
                borderWidth: 1, borderColor: theme.border,
              }}
            >
              <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>+{oz}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function ExerciseCard({ calories, editable, theme }: {
  calories: number; editable: boolean; theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="barbell-outline" size={16} color={theme.textMuted} />
        <Text style={[type.caption, { color: theme.textMuted }]}>Exercise</Text>
      </View>
      <Text style={[type.title, { color: theme.text, marginTop: spacing.xs }]}>{Math.round(calories)} cal</Text>
      {editable ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/log-exercise')} style={{ marginTop: spacing.sm }}>
          <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Log exercise</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** Visual placeholder only — real step tracking needs Apple Health/HealthKit,
 * a native module that (like RevenueCat) doesn't run in Expo Go and needs a
 * real Dev Client build. Honest about that instead of faking a number. */
function StepsCard({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Ionicons name="footsteps-outline" size={16} color={theme.textMuted} />
        <Text style={[type.caption, { color: theme.textMuted }]}>Steps</Text>
      </View>
      <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.md }]}>Needs Apple Health</Text>
    </View>
  )
}

export default function TodayScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [goal, setGoal] = useState<FightGoal | null>(null)
  const [totals, setTotals] = useState<DayTotals | null>(null)
  const [meals, setMeals] = useState<MealSummary[]>([])
  const [streak, setStreak] = useState<Streak | null>(null)
  const [waterMl, setWaterMl] = useState(0)
  const [exerciseCal, setExerciseCal] = useState(0)
  const [excludeExerciseCalories, setExcludeExerciseCalories] = useState(false)
  const todayStr = localDateFrom(Date.now())
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const isToday = selectedDate === todayStr

  const load = useCallback((localDate: string) => {
    let alive = true
    const now = Date.now()
    void Promise.all([
      fightGoalAsOf(endOfLocalDateMs(localDate)), dayTotals(localDate), recentMeals(localDate),
      loggingStreak(now), dayWaterMl(localDate), dayExerciseCalories(localDate),
      setting(EXCLUDE_EXERCISE_CALORIES_KEY, 'false'),
    ]).then(([g, t, m, s, w, e, excludeSetting]) => {
      if (!alive) return
      setGoal(g)
      setTotals(t)
      setMeals(m)
      setStreak(s)
      setWaterMl(w)
      setExerciseCal(e)
      setExcludeExerciseCalories(excludeSetting === 'true')
      // Re-queues the next few days of "you haven't logged" reminders and
      // cancels today's if it's now already logged -- see
      // lib/dailyReminder.ts for why this has to run on every open rather
      // than just once.
      if (localDate === localDateFrom(now)) void ensureDailyReminders(m.length > 0)
    })
    return () => {
      alive = false
    }
  }, [])

  useFocusEffect(useCallback(() => load(selectedDate), [load, selectedDate]))

  async function addWater(flOz: number) {
    await logWater(flOz * ML_PER_FL_OZ, Date.now())
    setWaterMl((v) => v + flOz * ML_PER_FL_OZ)
  }

  const effectiveExerciseCal = excludeExerciseCalories ? 0 : exerciseCal
  const effectiveTargetKcal = goal ? goal.targetKcal + effectiveExerciseCal : null
  const remaining = effectiveTargetKcal !== null ? Math.max(0, effectiveTargetKcal - (totals?.calories ?? 0)) : null
  const calorieProgress = effectiveTargetKcal && effectiveTargetKcal > 0 ? (totals?.calories ?? 0) / effectiveTargetKcal : 0

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: 140 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.title, { color: theme.text }]}>Today</Text>
        {streak && streak.currentDays > 0 ? (
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 4,
              backgroundColor: theme.surface, borderRadius: radius.pill,
              paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
              opacity: streak.active ? 1 : 0.5,
            }}
          >
            <Ionicons name="flame" size={16} color={theme.accentFlame} />
            <Text style={[type.bodyStrong, { color: theme.text }]}>{streak.currentDays}</Text>
          </View>
        ) : null}
      </View>
      {streak && streak.currentDays > 0 && !streak.active ? (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>Log a meal today to keep it going</Text>
      ) : null}

      <WeekStrip selectedDate={selectedDate} onSelect={setSelectedDate} theme={theme} />

      {goal && isToday ? (
        <View style={{
          marginTop: spacing.lg, backgroundColor: theme.accentFlame + '14', borderRadius: radius.lg,
          paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, alignItems: 'center',
        }}>
          {(() => {
            const label = goal.goalType === 'lose' ? 'Weigh-in' : goal.goalType === 'gain' ? 'Target' : 'Check-in'
            const days = daysUntil(goal.weighInDateMs)
            if (days < 0) {
              return <Text style={[type.body, { color: theme.textMuted }]}>{label} date has passed. Update your goal.</Text>
            }
            return (
              <>
                <Text style={{ fontSize: 56, fontWeight: '800', letterSpacing: -1.5, color: theme.accentFlame }}>{days}</Text>
                <Text style={[type.bodyStrong, { color: theme.text, marginTop: -4 }]}>
                  day{days === 1 ? '' : 's'} until {label.toLowerCase()}
                </Text>
              </>
            )
          })()}
        </View>
      ) : null}

      {goal ? (
        <View style={{
          marginTop: spacing.lg, backgroundColor: theme.accentLine + '14', borderRadius: radius.lg,
          paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, alignItems: 'center',
        }}>
          <View style={{ marginTop: spacing.md }}>
            <ProgressRing size={184} strokeWidth={16} progress={calorieProgress} trackColor={theme.accentLine + '26'} fillColor={theme.accentLine}>
              <Text style={{ fontSize: 44, fontWeight: '800', letterSpacing: -1, color: theme.text }}>{Math.round(remaining ?? 0)}</Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>kcal left</Text>
            </ProgressRing>
          </View>
          {exerciseCal > 0 && !excludeExerciseCalories ? (
            <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
              Includes +{Math.round(exerciseCal)} kcal from exercise. Device estimates run high, so if
              progress stalls, try turning this off in Profile.
            </Text>
          ) : null}
          {exerciseCal > 0 && excludeExerciseCalories ? (
            <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
              Exercise calories aren't added to your budget today.
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg, width: '100%' }}>
            <MacroRing label="Protein" value={totals?.proteinG ?? 0} target={goal.proteinG} color={theme.accentProtein} theme={theme} />
            <MacroRing label="Carbs" value={totals?.carbsG ?? 0} target={goal.carbsG} color={theme.accentCarbs} theme={theme} />
            <MacroRing label="Fat" value={totals?.fatG ?? 0} target={goal.fatG} color={theme.accentFat} theme={theme} />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.body, { color: theme.textMuted }]}>No weight-cut goal set yet.</Text>
        </View>
      )}

      {isToday && goal && goal.goalType === 'lose' && daysUntil(goal.weighInDateMs) >= 0 && daysUntil(goal.weighInDateMs) <= 7 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/fight-week')}
          style={{
            marginTop: spacing.md, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg,
            borderWidth: 1, borderColor: theme.danger,
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Fight week is here</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
            Water load, cut, and rehydration guidance for the final stretch.
          </Text>
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
        <WaterCard ml={waterMl} onAdd={addWater} editable={isToday} theme={theme} />
        <ExerciseCard calories={exerciseCal} editable={isToday} theme={theme} />
      </View>
      <View style={{ marginTop: spacing.sm }}>
        <StepsCard theme={theme} />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/meal-plan')}
        style={{
          marginTop: spacing.sm, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Nutrition / Meal Plan</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>Built from your daily target</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
      </Pressable>

      {isToday ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={promptAddMeal}
            style={{
              marginTop: spacing.xl,
              minHeight: 60,
              paddingVertical: spacing.sm,
              borderRadius: radius.pill,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Add Meal</Text>
            <Text style={[type.caption, { color: theme.onPrimary, opacity: 0.7, marginTop: 2 }]}>(Phone eat first)</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/log-weight')}
            style={{
              marginTop: spacing.md,
              height: 52,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Log today's weight</Text>
          </Pressable>
        </>
      ) : null}

      {meals.length > 0 ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <Text style={[type.label, { color: theme.textMuted }]}>{isToday ? 'Recently logged' : 'Logged that day'}</Text>
          {meals.map((m) => <MealRow key={m.id} meal={m} editable={isToday} theme={theme} />)}
        </View>
      ) : null}
    </ScrollView>
  )
}
