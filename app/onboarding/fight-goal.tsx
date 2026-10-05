import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DatePickerField } from '../../lib/components/DatePickerField'
import { NumberField } from '../../lib/components/NumberField'
import { OptionRow } from '../../lib/components/OptionRow'
import { currentFightGoal, loadProfile, saveProfile, setFightGoal, type GoalType } from '../../lib/repo'
import { syncProgressSnapshot } from '../../lib/groupsClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB, LB_TO_KG } from '../../lib/units'
import type { ActivityLevel } from '../../lib/weightCutMath'

const DAY_MS = 24 * 60 * 60 * 1000

// A typical fight-camp length — arbitrary but reasonable default so the
// picker (and Continue) work immediately without forcing the user to swipe
// first. See DatePickerField's own comment for why defaulting matters.
const DEFAULT_CAMP_WEEKS = 8

export default function FightGoal() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  const now = new Date()
  const minWeighInDate = new Date(now.getTime() + DAY_MS) // must be strictly in the future
  const maxWeighInDate = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate())
  const defaultWeighInDate = new Date(now.getTime() + DEFAULT_CAMP_WEEKS * 7 * DAY_MS)

  const [goalType, setGoalType] = useState<GoalType>('lose')
  const [targetLb, setTargetLb] = useState('')
  const [weighInDate, setWeighInDate] = useState<Date | null>(defaultWeighInDate)
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)

  // Reached two ways: fresh from onboarding (nothing to pre-fill) or via
  // Profile -> "Edit weight-cut goal" on an existing goal. Previously this
  // screen only handled the first case, so "editing" actually meant
  // retyping the date and target weight from scratch every time — not a
  // real edit. Pre-filling from the current goal, when there is one, fixes
  // both the UX gap and gives this screen one consistent behavior instead
  // of two silently different ones depending on how you got here.
  useEffect(() => {
    void currentFightGoal().then((g) => {
      if (!g) return
      setGoalType(g.goalType)
      setTargetLb((g.weighInTargetKg * KG_TO_LB).toFixed(1))
      setWeighInDate(new Date(g.weighInDateMs))
    })
  }, [])

  // Training frequency drives the TDEE/target-calorie math but previously
  // could only be set once, during onboarding, with no way back to it —
  // a fighter's actual training load changes over a camp, so this screen
  // (the one place goals get recalculated) is where it needs to be editable.
  useEffect(() => {
    void loadProfile().then((p) => {
      if (p) setActivityLevel(p.activityLevel)
    })
  }, [])

  async function next() {
    if (saving) return
    setError(null)
    setProfileMissing(false)

    if (!weighInDate) {
      setError(goalType === 'maintain' ? 'Pick a check-in date.' : 'Pick your target date.')
      return
    }
    const weighInDateMs = weighInDate.getTime()
    if (weighInDateMs <= Date.now()) {
      setError('Pick a date in the future.')
      return
    }

    const savedProfile = await loadProfile()
    if (!savedProfile) {
      // Couldn't reproduce this locally, but a screenshot showed it in the
      // wild after the flow had already worked once earlier in the same
      // session — logged here so a real Metro session catches whatever's
      // actually happening next time, instead of guessing again.
      console.error('[fight-goal] loadProfile() returned null — expected an existing profile row.')
      setProfileMissing(true)
      setError('Your profile info is missing.')
      return
    }
    // Training frequency may have just changed on this screen — fold it in
    // before computing anything so the target math uses the current
    // selection, not whatever was true when the profile was last saved.
    const profile = { ...savedProfile, activityLevel }

    // Maintain has nothing to solve for — the target *is* the current
    // weight, so there's no separate field to validate or parse.
    let targetKg: number
    if (goalType === 'maintain') {
      targetKg = profile.weightKg
    } else {
      const targetLbV = Number.parseFloat(targetLb)
      if (!Number.isFinite(targetLbV) || targetLbV <= 0) {
        setError('Enter your target weight.')
        return
      }
      targetKg = targetLbV * LB_TO_KG
      if (goalType === 'lose' && targetKg >= profile.weightKg) {
        setError('Your weigh-in target should be below your current weight.')
        return
      }
      if (goalType === 'gain' && targetKg <= profile.weightKg) {
        setError('Your target weight should be above your current weight.')
        return
      }
    }

    setSaving(true)
    try {
      await saveProfile(profile, Date.now())
      await setFightGoal(profile, goalType, targetKg, weighInDateMs, Date.now())
      void syncProgressSnapshot() // best-effort, no-ops until signed in + backend configured
      router.push('/onboarding/plan')
    } catch (e) {
      // Without this, a failed save left `saving` stuck true forever — same
      // bug class fixed in onboarding/body.tsx.
      console.error('[fight-goal] setFightGoal failed', e)
      setError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>Your goal</Text>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        {goalType === 'lose'
          ? 'What weight do you need to hit, and by when?'
          : goalType === 'gain'
            ? 'What weight are you aiming for, and by when?'
            : "We'll hold your calories at maintenance for your current weight."}
      </Text>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <OptionRow
          label="Goal"
          value={goalType}
          onChange={setGoalType}
          options={[
            { value: 'lose', label: 'Cut weight' },
            { value: 'maintain', label: 'Maintain' },
            { value: 'gain', label: 'Gain weight' },
          ]}
        />
        {goalType !== 'maintain' ? (
          <NumberField
            label={goalType === 'lose' ? 'Weigh-in target' : 'Target weight'}
            unit="lbs"
            value={targetLb}
            onChange={setTargetLb}
            placeholder="155"
          />
        ) : null}
        <DatePickerField
          label={goalType === 'lose' ? 'Weigh-in date' : goalType === 'gain' ? 'Target date' : 'Check-in date'}
          value={weighInDate}
          onChange={setWeighInDate}
          minimumDate={minWeighInDate}
          maximumDate={maxWeighInDate}
        />
        <OptionRow
          label="How many times a week do you train?"
          value={activityLevel}
          onChange={setActivityLevel}
          options={[
            { value: 'light', label: '1 to 2x' },
            { value: 'moderate', label: '3 to 4x' },
            { value: 'high', label: '5 to 6x' },
            { value: 'very_high', label: '7+x' },
          ]}
        />

        {error ? (
          <View style={{ backgroundColor: theme.danger + '22', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm }}>
            <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>
            {profileMissing ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/onboarding/body')}
                style={{ marginTop: spacing.sm }}
              >
                <Text style={[type.bodyStrong, { color: theme.danger, textDecorationLine: 'underline' }]}>
                  Set up your profile
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={next}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Continue</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
