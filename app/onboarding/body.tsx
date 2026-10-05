import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DatePickerField } from '../../lib/components/DatePickerField'
import { NumberField } from '../../lib/components/NumberField'
import { OptionRow } from '../../lib/components/OptionRow'
import { saveProfile } from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { IN_TO_CM, LB_TO_KG } from '../../lib/units'
import type { ActivityLevel, BiologicalSex } from '../../lib/weightCutMath'

export default function BodyStats() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()

  // Native date pickers only fire onChange once the user actually swipes
  // the wheel — the visible default value on first render doesn't mean the
  // parent's state has it yet. Starting from null meant "Continue" stayed
  // disabled forever for anyone who didn't happen to touch the wheel, even
  // though it looked like a date was already selected. Defaulting to a real
  // date (25 years ago, an arbitrary but reasonable guess) fixes that; nothing
  // stops the user from swiping to correct it.
  const now = new Date()
  const defaultBirthDate = new Date(now.getFullYear() - 25, now.getMonth(), now.getDate())
  const maxBirthDate = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate())
  const minBirthDate = new Date(now.getFullYear() - 100, now.getMonth(), now.getDate())

  const [sex, setSex] = useState<BiologicalSex>('unspecified')
  const [weightLb, setWeightLb] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [birthDate, setBirthDate] = useState<Date | null>(defaultBirthDate)
  const [activity, setActivity] = useState<ActivityLevel>('moderate')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const weightLbV = Number.parseFloat(weightLb)
  const heightInV = Number.parseFloat(heightIn)
  const valid =
    Number.isFinite(weightLbV) && weightLbV > 0 &&
    Number.isFinite(heightInV) && heightInV > 0 &&
    birthDate != null

  async function next() {
    if (!valid || saving || !birthDate) return
    setSaving(true)
    setError(null)
    try {
      await saveProfile(
        {
          sex,
          weightKg: weightLbV * LB_TO_KG,
          heightCm: heightInV * IN_TO_CM,
          birthDateMs: birthDate.getTime(),
          activityLevel: activity,
          units: 'imperial',
        },
        Date.now(),
      )
      router.push('/onboarding/fight-goal')
    } catch (e) {
      // Without this, a failed save left `saving` stuck true forever —
      // Continue would look permanently broken with no error shown at all.
      console.error('[onboarding/body] saveProfile failed', e)
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
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>About you</Text>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <OptionRow
          label="Sex"
          value={sex}
          onChange={setSex}
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
            { value: 'unspecified', label: 'Prefer not to say' },
          ]}
        />
        <NumberField label="Weight" unit="lbs" value={weightLb} onChange={setWeightLb} placeholder="170" />
        <NumberField label="Height" unit="in" value={heightIn} onChange={setHeightIn} placeholder="70" />
        <DatePickerField label="Date of birth" value={birthDate} onChange={setBirthDate} minimumDate={minBirthDate} maximumDate={maxBirthDate} />
        <OptionRow
          label="How many times a week do you train?"
          value={activity}
          onChange={setActivity}
          options={[
            { value: 'light', label: '1 to 2x' },
            { value: 'moderate', label: '3 to 4x' },
            { value: 'high', label: '5 to 6x' },
            { value: 'very_high', label: '7+x' },
          ]}
        />
      </ScrollView>
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        {error ? <Text style={[type.caption, { color: theme.danger, textAlign: 'center', marginBottom: spacing.sm }]}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!valid || saving}
          onPress={next}
          style={{
            height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
            backgroundColor: valid ? theme.primary : theme.border,
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Continue</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
