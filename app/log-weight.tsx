import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NumberField } from '../lib/components/NumberField'
import { narrateRecalibration } from '../lib/coachClient'
import { logWeight, recalibrateIfDue, weightHistory } from '../lib/repo'
import { syncProgressSnapshot } from '../lib/groupsClient'
import { radius, spacing, type, useTheme } from '../lib/theme'
import { KG_TO_LB, LB_TO_KG } from '../lib/units'

export default function LogWeight() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [weightLb, setWeightLb] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set only when a real, material plan recalibration happened — see
  // recalibrateIfDue in repo.ts. Showing this inline rather than an Alert
  // so the (optional, best-effort) AI-narrated version can swap in after
  // the fact without needing a second popup.
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  useEffect(() => {
    void weightHistory().then((points) => {
      const last = points[points.length - 1]
      if (last) setWeightLb((last.weightKg * KG_TO_LB).toFixed(1))
    })
  }, [])

  const weightLbV = Number.parseFloat(weightLb)
  const valid = Number.isFinite(weightLbV) && weightLbV > 0

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      await logWeight(weightLbV * LB_TO_KG, now)
      // Best-effort — silently no-ops if not signed in or no backend
      // configured, same pattern as everything else that touches Supabase.
      void syncProgressSnapshot()

      const recalibration = await recalibrateIfDue(now)
      if (recalibration?.hasEnoughData && recalibration.isMaterialChange) {
        setUpdateMessage(recalibration.reason)
        setSaving(false)
        // Best-effort personalization — the plain reason above is already
        // correct and already shown, this just upgrades it in place if a
        // nicer phrasing comes back in time.
        void narrateRecalibration(recalibration).then((message) => setUpdateMessage(message))
        return
      }
      router.back()
    } catch (e) {
      console.error('[log-weight] logWeight failed', e)
      setError("Couldn't save. Try again.")
      setSaving(false)
    }
  }

  if (updateMessage) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
        <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'center' }}>
          <Text style={[type.label, { color: theme.textMuted }]}>Your plan updated</Text>
          <Text style={[type.title, { color: theme.text, marginTop: spacing.sm }]}>{updateMessage}</Text>
        </View>
        <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={{ height: 60, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Continue</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Today's weight</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <View style={{ padding: spacing.lg, marginTop: spacing.xl }}>
        <NumberField label="Weight" unit="lbs" value={weightLb} onChange={setWeightLb} placeholder="170" />
        <Text style={[type.caption, { color: theme.textFaint, lineHeight: 18 }]}>
          One number for today. Day-to-day scale weight moves around from water and food volume.
          The trend over a week matters more than any single reading.
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
          {saving ? <ActivityIndicator color={theme.onPrimary} /> : <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>Save</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}
