import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DatePickerField } from '../lib/components/DatePickerField'
import { NumberField } from '../lib/components/NumberField'
import { OptionRow } from '../lib/components/OptionRow'
import { localDateFrom, logBodyComposition } from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'
import { LB_TO_KG } from '../lib/units'

const DAY_MS = 24 * 60 * 60 * 1000

type Source = 'DEXA' | 'InBody' | 'BodPod' | 'Other'

const SOURCES: ReadonlyArray<{ value: Source; label: string }> = [
  { value: 'DEXA', label: 'DEXA' },
  { value: 'InBody', label: 'InBody' },
  { value: 'BodPod', label: 'BodPod' },
  { value: 'Other', label: 'Other' },
]

export default function LogBodyComp() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const now = new Date()

  const [source, setSource] = useState<Source>('DEXA')
  const [date, setDate] = useState<Date | null>(now)
  const [bodyFatPct, setBodyFatPct] = useState('')
  const [leanMassLb, setLeanMassLb] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bodyFatV = Number.parseFloat(bodyFatPct)
  const leanMassV = Number.parseFloat(leanMassLb)
  const hasBodyFat = Number.isFinite(bodyFatV) && bodyFatV > 0 && bodyFatV < 100
  const hasLeanMass = Number.isFinite(leanMassV) && leanMassV > 0
  const valid = date != null && (hasBodyFat || hasLeanMass)

  async function save() {
    if (!valid || saving || !date) return
    setSaving(true)
    setError(null)
    try {
      await logBodyComposition(
        {
          localDate: localDateFrom(date.getTime()),
          source,
          bodyFatPct: hasBodyFat ? bodyFatV : null,
          leanMassKg: hasLeanMass ? leanMassV * LB_TO_KG : null,
          notes: notes.trim() || null,
        },
        Date.now(),
      )
      router.back()
    } catch (e) {
      console.error('[log-body-comp] logBodyComposition failed', e)
      setError("Couldn't save. Try again.")
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Body scan</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        Got a DEXA, InBody, or BodPod scan done elsewhere? Log the real numbers here. A lot more accurate than
        BMI for a muscular build.
      </Text>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
        <OptionRow label="Scan type" value={source} onChange={setSource} options={SOURCES} />
        <DatePickerField
          label="Scan date"
          value={date}
          onChange={setDate}
          minimumDate={new Date(now.getTime() - 2 * 365 * DAY_MS)}
          maximumDate={now}
        />
        <NumberField label="Body fat" unit="%" value={bodyFatPct} onChange={setBodyFatPct} placeholder="14.5" />
        <NumberField label="Lean mass" unit="lbs" value={leanMassLb} onChange={setLeanMassLb} placeholder="150" />

        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Notes (optional)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. provider, scan conditions"
          placeholderTextColor={theme.textFaint}
          multiline
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text, fontSize: 16, minHeight: 72, textAlignVertical: 'top',
          }}
        />

        {error ? <Text style={[type.caption, { color: theme.danger, marginTop: spacing.md }]}>{error}</Text> : null}
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          disabled={!valid || saving}
          onPress={save}
          style={{
            height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
            backgroundColor: valid ? theme.primary : theme.border,
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Save</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
