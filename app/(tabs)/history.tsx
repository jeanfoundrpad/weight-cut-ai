import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WeightTrendChart } from '../../lib/components/WeightTrendChart'
import { ageFromBirthDate } from '../../lib/dateMath'
import { currentPaceLbPerWeek, weightChangesOverPeriods } from '../../lib/trend'
import { bmi, bmiCategory, requiredWeeklyRate, restingEnergy, safeMaxWeeklyLossLb, totalEnergyExpenditure } from '../../lib/weightCutMath'
import {
  currentFightGoal, latestBodyComposition, loadProfile, localDateFrom, loggingStreak, rangeSummary, weighInCount, weightHistory,
  type BodyCompositionEntry, type FightGoal, type Profile, type RangeSummary, type Streak, type WeightPoint,
} from '../../lib/repo'
import { meterColors, radius, spacing, type, useTheme, type Theme } from '../../lib/theme'
import { KG_TO_LB } from '../../lib/units'

// Matches the "how many times a week do you train?" options in onboarding —
// 'sedentary' isn't offered there anymore, but the enum still supports it
// (e.g. old data from before this change), so it keeps a label rather than
// being an exhaustiveness-check gap.
const ACTIVITY_LABEL: Record<Profile['activityLevel'], string> = {
  sedentary: 'Rarely trains',
  light: '1 to 2x/week',
  moderate: '3 to 4x/week',
  high: '5 to 6x/week',
  very_high: '7+x/week',
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysAgoLocalDate(n: number): string {
  return localDateFrom(Date.now() - n * DAY_MS)
}

type FoodListRow =
  | { kind: 'day'; label: string; localDate: string; totalKcal: number; count: number }
  | { kind: 'range'; label: string; startDate: string; endDate: string; totalKcal: number; count: number }
  | { kind: 'customize' }

/**
 * Replaced a one-row-per-calendar-day list (which only ever grew, day by
 * day, for as long as someone used the app) with five fixed rows —
 * Today, Yesterday, Last Week, Last Month, Customize — each a tappable
 * summary in the same style, rather than singling Today out as the one
 * expanded, non-summary entry. "Last Week" covers 2-7 days ago and "Last
 * Month" 8-30 days ago (today and yesterday already have their own rows,
 * so the buckets don't double-count them); Customize is the way past 30
 * days, via a plain date picker rather than an ever-growing list.
 */
function buildFoodListRows(
  today: RangeSummary, yesterday: RangeSummary, lastWeek: RangeSummary, lastMonth: RangeSummary,
): FoodListRow[] {
  return [
    { kind: 'day', label: 'Today', localDate: daysAgoLocalDate(0), totalKcal: today.totalKcal, count: today.mealCount },
    { kind: 'day', label: 'Yesterday', localDate: daysAgoLocalDate(1), totalKcal: yesterday.totalKcal, count: yesterday.mealCount },
    { kind: 'range', label: 'Last Week', startDate: daysAgoLocalDate(7), endDate: daysAgoLocalDate(2), totalKcal: lastWeek.totalKcal, count: lastWeek.mealCount },
    { kind: 'range', label: 'Last Month', startDate: daysAgoLocalDate(30), endDate: daysAgoLocalDate(8), totalKcal: lastMonth.totalKcal, count: lastMonth.mealCount },
    { kind: 'customize' },
  ]
}

/** Measures its own width so the SVG chart below can size to the actual card, not a guessed constant. */
function WeightChartMeasured({ weights, targetLb, theme }: { weights: WeightPoint[]; targetLb: number | null; theme: Theme }) {
  const [width, setWidth] = useState(0)
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? <WeightTrendChart points={weights} targetLb={targetLb} theme={theme} width={width} /> : null}
    </View>
  )
}

/**
 * A fixed red-to-green ramp spans the *whole* track, not just the filled
 * portion — the filled slice's color is then whatever point on that ramp
 * corresponds to how far along you are, so "just started" reads red and
 * "nearly there" reads green, rather than every fill (10% or 90%) showing
 * the same compressed rainbow. Achieved by drawing the full-width gradient
 * underneath and covering the not-yet-earned remainder with a plain block
 * in the track's own color.
 */
function WeightProgressBar({ pct, theme }: { pct: number; theme: Theme }) {
  const [width, setWidth] = useState(0)
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: 6, borderRadius: 3, backgroundColor: theme.border, marginTop: spacing.lg, overflow: 'hidden' }}
    >
      {width > 0 ? (
        <Svg width={width} height={6}>
          <Defs>
            <LinearGradient id="weightProgressGradient" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={meterColors.low} />
              <Stop offset="0.33" stopColor={meterColors.mid1} />
              <Stop offset="0.66" stopColor={meterColors.mid2} />
              <Stop offset="1" stopColor={meterColors.high} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={6} fill="url(#weightProgressGradient)" />
        </Svg>
      ) : null}
      <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${100 - clamped}%`, backgroundColor: theme.border }} />
    </View>
  )
}

function StatCard({ icon, iconColor, value, label, theme }: {
  icon: keyof typeof Ionicons.glyphMap; iconColor?: string; value: string; label: string; theme: Theme
}) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' }}>
      <Ionicons name={icon} size={20} color={iconColor ?? theme.text} />
      <Text style={[type.title, { color: theme.text, marginTop: spacing.xs }]}>{value}</Text>
      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{label}</Text>
    </View>
  )
}

function Row({ label, value, theme, last }: { label: string; value: string; theme: Theme; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.border,
      }}
    >
      <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

function ChangeRow({ label, deltaLb, theme, last }: { label: string; deltaLb: number | null; theme: Theme; last?: boolean }) {
  const text = deltaLb == null ? 'Not enough data' : deltaLb === 0 ? 'No change' : `${deltaLb > 0 ? '+' : ''}${deltaLb.toFixed(1)} lbs`
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.border,
    }}>
      <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{text}</Text>
    </View>
  )
}

const EMPTY_RANGE: RangeSummary = { totalKcal: 0, mealCount: 0 }

export default function ProgressScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [todaySummary, setTodaySummary] = useState<RangeSummary>(EMPTY_RANGE)
  const [yesterdaySummary, setYesterdaySummary] = useState<RangeSummary>(EMPTY_RANGE)
  const [lastWeekSummary, setLastWeekSummary] = useState<RangeSummary>(EMPTY_RANGE)
  const [lastMonthSummary, setLastMonthSummary] = useState<RangeSummary>(EMPTY_RANGE)
  const [weights, setWeights] = useState<WeightPoint[]>([])
  const [goal, setGoal] = useState<FightGoal | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [streak, setStreak] = useState<Streak | null>(null)
  const [weighIns, setWeighIns] = useState(0)
  const [bodyComp, setBodyComp] = useState<BodyCompositionEntry | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void Promise.all([
        rangeSummary(daysAgoLocalDate(0), daysAgoLocalDate(0)),
        rangeSummary(daysAgoLocalDate(1), daysAgoLocalDate(1)),
        rangeSummary(daysAgoLocalDate(7), daysAgoLocalDate(2)),
        rangeSummary(daysAgoLocalDate(30), daysAgoLocalDate(8)),
        weightHistory(), currentFightGoal(), loadProfile(), loggingStreak(Date.now()), weighInCount(), latestBodyComposition(),
      ]).then(([today, yesterday, lastWeek, lastMonth, w, g, p, s, wc, bc]) => {
        if (!alive) return
        setTodaySummary(today)
        setYesterdaySummary(yesterday)
        setLastWeekSummary(lastWeek)
        setLastMonthSummary(lastMonth)
        setWeights(w)
        setGoal(g)
        setProfile(p)
        setStreak(s)
        setWeighIns(wc)
        setBodyComp(bc)
      })
      return () => {
        alive = false
      }
    }, []),
  )

  const rows = buildFoodListRows(todaySummary, yesterdaySummary, lastWeekSummary, lastMonthSummary)
  const currentWeightKg = weights[weights.length - 1]?.weightKg ?? profile?.weightKg ?? null
  const startWeightKg = weights[0]?.weightKg ?? profile?.weightKg ?? null
  const goalWeightKg = goal?.weighInTargetKg ?? null

  let progressPct: number | null = null
  if (currentWeightKg != null && startWeightKg != null && goalWeightKg != null && startWeightKg !== goalWeightKg) {
    progressPct = Math.min(100, Math.max(0, ((startWeightKg - currentWeightKg) / (startWeightKg - goalWeightKg)) * 100))
  }

  const changes = weightChangesOverPeriods(weights)
  const paceLbPerWeek = currentPaceLbPerWeek(weights)
  // 'maintain' has nothing to solve for via requiredWeeklyRate (the target
  // *is* whatever weight the goal was set at) — the needed pace is always 0.
  const neededPaceLbPerWeek = goal && currentWeightKg != null
    ? goal.goalType === 'maintain'
      ? 0
      : requiredWeeklyRate(currentWeightKg, goal.weighInTargetKg, goal.weighInDateMs, Date.now())
    : null
  const safeMaxLbPerWeek = currentWeightKg != null ? safeMaxWeeklyLossLb(currentWeightKg) : null
  const cuttingTooFast = safeMaxLbPerWeek != null && paceLbPerWeek != null && -paceLbPerWeek > safeMaxLbPerWeek

  // requiredWeeklyRate's sign convention (positive = losing) is the
  // opposite of currentPaceLbPerWeek's trend convention (positive = weight
  // rising) — flip actual pace into the goal's convention so "behind pace"
  // can be one comparison for both lose and gain instead of two unrelated
  // sign-specific formulas.
  const actualPaceInGoalConvention = paceLbPerWeek == null ? null : -paceLbPerWeek
  const behindPace =
    goal != null && goal.goalType !== 'maintain' && neededPaceLbPerWeek != null && actualPaceInGoalConvention != null
      ? goal.goalType === 'lose'
        ? actualPaceInGoalConvention < neededPaceLbPerWeek * 0.7
        : actualPaceInGoalConvention > neededPaceLbPerWeek * 0.7
      : false

  // Maintain has no "needed pace" to fall behind on, but drifting away from
  // 0 in either direction is exactly the thing a maintain goal exists to
  // catch — without this, that user got zero feedback from this whole card.
  const MAINTAIN_DRIFT_THRESHOLD_LB_PER_WEEK = 1
  const maintainDrifting =
    goal?.goalType === 'maintain' && paceLbPerWeek != null && Math.abs(paceLbPerWeek) > MAINTAIN_DRIFT_THRESHOLD_LB_PER_WEEK

  const bmiValue = profile ? bmi(profile.weightKg, profile.heightCm) : null

  const bmrKcal = profile ? restingEnergy({ sex: profile.sex, weightKg: profile.weightKg, heightCm: profile.heightCm, ageYears: ageFromBirthDate(profile.birthDateMs, Date.now()) }) : null
  const tdeeKcal = profile && bmrKcal != null ? totalEnergyExpenditure(bmrKcal, profile.activityLevel) : null

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>Progress</Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'customize' ? 'customize' : r.kind === 'day' ? `day-${r.localDate}` : `range-${r.startDate}`)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListHeaderComponent={
          <>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
              <StatCard icon="flame" iconColor={theme.accentFlame} value={`${streak?.currentDays ?? 0}`} label="Day streak" theme={theme} />
              <StatCard icon="scale-outline" value={`${weighIns}`} label="Weigh-ins" theme={theme} />
            </View>

            {currentWeightKg != null ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={[type.caption, { color: theme.textMuted }]}>Current weight</Text>
                    <Text style={[type.title, { color: theme.text, fontSize: 32, marginTop: 2 }]}>
                      {(currentWeightKg * KG_TO_LB).toFixed(1)} lbs
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/log-weight')}
                    style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border }}
                  >
                    <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>Log weight</Text>
                  </Pressable>
                </View>

                {progressPct != null && startWeightKg != null && goalWeightKg != null ? (
                  <>
                    <WeightProgressBar pct={progressPct} theme={theme} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                      <Text style={[type.caption, { color: theme.textFaint }]}>Start: {(startWeightKg * KG_TO_LB).toFixed(1)} lbs</Text>
                      <Text style={[type.caption, { color: theme.textFaint }]}>Goal: {(goalWeightKg * KG_TO_LB).toFixed(1)} lbs</Text>
                    </View>
                  </>
                ) : null}
              </View>
            ) : null}

            {weights.length > 0 ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.sm }]}>Weight trend</Text>
                <WeightChartMeasured weights={weights} targetLb={goal ? goal.weighInTargetKg * KG_TO_LB : null} theme={theme} />
              </View>
            ) : null}

            {goal ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
                <Row
                  label={goal.goalType === 'lose' ? 'Weigh-in target' : goal.goalType === 'gain' ? 'Target weight' : 'Maintaining at'}
                  value={`${(goal.weighInTargetKg * KG_TO_LB).toFixed(1)} lb`}
                  theme={theme}
                />
                <Row label="Daily target" value={`${Math.round(goal.targetKcal)} kcal`} theme={theme} last={bmrKcal == null && !profile} />
                {bmrKcal != null && tdeeKcal != null ? (
                  <>
                    <Row label="BMR (Mifflin-St Jeor)" value={`${Math.round(bmrKcal)} kcal`} theme={theme} />
                    <Row label="TDEE (BMR × activity)" value={`${Math.round(tdeeKcal)} kcal`} theme={theme} last={!profile} />
                  </>
                ) : null}
                {profile ? (
                  <Row label="Training frequency" value={ACTIVITY_LABEL[profile.activityLevel]} theme={theme} last />
                ) : null}
              </View>
            ) : null}
            {goal?.source === 'adaptive' ? (
              <Text style={[type.caption, { color: theme.textFaint, marginTop: -spacing.sm, marginBottom: spacing.lg, lineHeight: 18 }]}>
                Adjusted from your logged weight and meals, not just the formula above.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/onboarding/fight-goal')}
              style={{
                marginBottom: spacing.lg, height: 52, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={[type.bodyStrong, { color: theme.text }]}>{goal ? 'Edit goal' : 'Set a goal'}</Text>
            </Pressable>

            {weights.length > 0 ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Weight changes</Text>
                {changes.map((c, i) => <ChangeRow key={c.label} label={c.label} deltaLb={c.deltaLb} theme={theme} last={i === changes.length - 1} />)}
                <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.md, lineHeight: 18 }]}>
                  Measured on the trend, not a single weigh-in. A 3 lb overnight swing is water, not progress.
                </Text>
              </View>
            ) : null}

            {paceLbPerWeek != null ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>
                  {goal?.goalType === 'gain' ? 'Gaining pace' : goal?.goalType === 'maintain' ? 'Weight pace' : 'Cutting pace'}
                </Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
                  <View>
                    <Text style={[type.caption, { color: theme.textMuted }]}>Your pace</Text>
                    <Text style={[type.bodyStrong, { color: theme.text, fontSize: 20 }]}>
                      {Math.abs(paceLbPerWeek).toFixed(1)} lb/wk {paceLbPerWeek < 0 ? 'lost' : paceLbPerWeek > 0 ? 'gained' : ''}
                    </Text>
                  </View>
                  {neededPaceLbPerWeek != null ? (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[type.caption, { color: theme.textMuted }]}>Needed pace</Text>
                      <Text style={[type.bodyStrong, { color: theme.text, fontSize: 20 }]}>
                        {Math.abs(neededPaceLbPerWeek).toFixed(1)} lb/wk{goal?.goalType === 'gain' ? ' to gain' : goal?.goalType === 'lose' ? ' to lose' : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {behindPace ? (
                  <Text style={[type.caption, { color: theme.danger, marginTop: spacing.sm }]}>
                    {goal?.goalType === 'gain'
                      ? "You're gaining slower than needed to hit your target in time. Consider adjusting your target or timeline."
                      : "You're cutting slower than needed to make weight comfortably. Consider adjusting your target or timeline."}
                  </Text>
                ) : null}
                {maintainDrifting && paceLbPerWeek != null ? (
                  <Text style={[type.caption, { color: theme.danger, marginTop: spacing.sm }]}>
                    You're trending {Math.abs(paceLbPerWeek).toFixed(1)} lb/wk {paceLbPerWeek > 0 ? 'up' : 'down'} from your maintain target. Consider adjusting your intake.
                  </Text>
                ) : null}
                {cuttingTooFast && safeMaxLbPerWeek != null ? (
                  <Text style={[type.caption, { color: theme.danger, marginTop: spacing.sm }]}>
                    You're losing faster than {safeMaxLbPerWeek.toFixed(1)} lb/wk, the max sustained rate the NWCA
                    certifies as safe (1.5% of bodyweight per week). Slow down, or talk to a coach or doctor.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {bodyComp ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Text style={[type.label, { color: theme.textMuted }]}>Body composition</Text>
                  <Text style={[type.caption, { color: theme.textFaint }]}>{bodyComp.source}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.xl, marginTop: spacing.xs }}>
                  {bodyComp.bodyFatPct != null ? (
                    <View>
                      <Text style={[type.title, { color: theme.text, fontSize: 28 }]}>{bodyComp.bodyFatPct.toFixed(1)}%</Text>
                      <Text style={[type.caption, { color: theme.textMuted }]}>Body fat</Text>
                    </View>
                  ) : null}
                  {bodyComp.leanMassKg != null ? (
                    <View>
                      <Text style={[type.title, { color: theme.text, fontSize: 28 }]}>{(bodyComp.leanMassKg * KG_TO_LB).toFixed(1)}</Text>
                      <Text style={[type.caption, { color: theme.textMuted }]}>Lean mass, lbs</Text>
                    </View>
                  ) : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => router.push('/log-body-comp')} style={{ marginTop: spacing.sm }}>
                  <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Log a new scan</Text>
                </Pressable>
              </View>
            ) : null}

            {bmiValue != null ? (
              <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Your BMI</Text>
                <Text style={[type.title, { color: theme.text, fontSize: 28 }]}>
                  {bmiValue.toFixed(1)} <Text style={[type.body, { color: theme.textMuted }]}>{bmiCategory(bmiValue)}</Text>
                </Text>
                <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs, lineHeight: 18 }]}>
                  BMI cannot tell muscle from fat and says nothing about an individual fighter's health. Shown as a
                  common reference point only, not a verdict, especially for a muscular build.
                  {bodyComp ? ' Your logged body fat percentage above is the more accurate number.' : ''}
                </Text>
                {!bodyComp ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/log-body-comp')} style={{ marginTop: spacing.sm }}>
                    <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Got a DEXA or InBody scan? Log it</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.sm }]}>Meals</Text>
          </>
        }
        renderItem={({ item }) =>
          item.kind === 'customize' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/pick-date')}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md,
              }}
            >
              <View>
                <Text style={[type.bodyStrong, { color: theme.text }]}>Customize</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>Pick any date, going back months</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                item.kind === 'day'
                  ? router.push({ pathname: '/day/[date]', params: { date: item.localDate } })
                  : router.push({ pathname: '/range', params: { start: item.startDate, end: item.endDate, label: item.label } })
              }
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md,
              }}
            >
              <View>
                <Text style={[type.bodyStrong, { color: theme.text }]}>{item.label}</Text>
                <Text style={[type.caption, { color: theme.textMuted }]}>
                  {Math.round(item.totalKcal)} kcal · {item.count} {item.count === 1 ? 'meal' : 'meals'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
            </Pressable>
          )
        }
      />
    </View>
  )
}
