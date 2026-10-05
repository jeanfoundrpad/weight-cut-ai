import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DatePickerField } from '../lib/components/DatePickerField'
import { localDateFrom } from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'

const DAY_MS = 24 * 60 * 60 * 1000
// No real lower bound on logged data, just a generous window past the
// 30-day "Last Month" bucket so the picker can actually reach "months
// back" the way Progress's "Customize" row promises.
const LOOKBACK_YEARS = 5

/**
 * Reached from Progress's "Customize" row — the way past the fixed
 * Today/Yesterday/Last Week/Last Month buckets to any specific day,
 * however long ago. Picking a date just opens that day's own detail
 * screen; there's no separate "confirm" step beyond the native picker
 * itself already requiring a deliberate swipe/tap.
 */
export default function PickDate() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const now = new Date()
  const minDate = new Date(now.getFullYear() - LOOKBACK_YEARS, now.getMonth(), now.getDate())
  // Defaults 31 days back — one day past the "Last Month" bucket's own
  // range — so landing here doesn't just show a date already covered by a
  // row on the previous screen.
  const [date, setDate] = useState<Date>(new Date(now.getTime() - 31 * DAY_MS))

  function viewDate() {
    router.push({ pathname: '/day/[date]', params: { date: localDateFrom(date.getTime()) } })
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Pick a date</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        See what you logged on any day.
      </Text>

      <View style={{ padding: spacing.lg }}>
        <DatePickerField label="Date" value={date} onChange={setDate} minimumDate={minDate} maximumDate={now} />
      </View>

      <View style={{ flex: 1 }} />
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          onPress={viewDate}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>View this day</Text>
        </Pressable>
      </View>
    </View>
  )
}
