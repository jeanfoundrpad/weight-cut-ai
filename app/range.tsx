import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dayPilesInRange, type DayPile } from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'

function formatDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/**
 * Reached from Progress's "Last Week"/"Last Month" summary rows — those are
 * one aggregate number each, so this is where the range actually breaks
 * back down into individual days, each still tappable into its own
 * day-detail screen for editing. Same day-pile row shape used to live
 * inline on the Progress screen itself before it was replaced by the fixed
 * Today/Yesterday/Last Week/Last Month/Customize rows.
 */
export default function RangeDetail() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { start, end, label } = useLocalSearchParams<{ start: string; end: string; label?: string }>()
  const [days, setDays] = useState<DayPile[] | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      if (start && end) {
        void dayPilesInRange(start, end).then((d) => {
          if (alive) setDays(d)
        })
      }
      return () => {
        alive = false
      }
    }, [start, end]),
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>{label || 'Meals'}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      <FlatList
        data={days ?? []}
        keyExtractor={(d) => d.localDate}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          days == null ? null : (
            <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.xl, textAlign: 'center' }]}>
              No meals logged in this period.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/day/[date]', params: { date: item.localDate } })}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md,
            }}
          >
            <View>
              <Text style={[type.bodyStrong, { color: theme.text }]}>{formatDate(item.localDate)}</Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                {Math.round(item.totalKcal)} kcal · {item.mealCount} {item.mealCount === 1 ? 'meal' : 'meals'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textFaint} />
          </Pressable>
        )}
      />
    </View>
  )
}
