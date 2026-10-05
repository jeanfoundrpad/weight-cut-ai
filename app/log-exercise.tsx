import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NumberField } from '../lib/components/NumberField'
import { logExercise } from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'

export default function LogExercise() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [label, setLabel] = useState('')
  const [calories, setCalories] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const caloriesV = Number.parseFloat(calories)
  const valid = label.trim().length > 0 && Number.isFinite(caloriesV) && caloriesV > 0

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await logExercise(label.trim(), caloriesV, Date.now())
      router.back()
    } catch (e) {
      console.error('[log-exercise] logExercise failed', e)
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
        <Text style={[type.title, { color: theme.text }]}>Log exercise</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <View style={{ padding: spacing.lg, marginTop: spacing.xl }}>
        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Activity</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. Wrestling practice"
          placeholderTextColor={theme.textFaint}
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text, fontSize: 17, marginBottom: spacing.lg,
          }}
        />
        <NumberField label="Calories burned" unit="cal" value={calories} onChange={setCalories} placeholder="300" />
        <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
          Added on top of today's calorie target. A rough estimate is fine, this isn't meant to be exact.
        </Text>
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        {error ? <Text style={[type.caption, { color: theme.danger, textAlign: 'center', marginBottom: spacing.sm }]}>{error}</Text> : null}
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
