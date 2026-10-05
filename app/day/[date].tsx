import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { FlatList, Image, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { recentMeals, type MealSummary } from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'

function formatDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

/**
 * Reached by tapping a collapsed past-day entry on the Progress screen's
 * food list — Today's meals stay listed inline there, but every other day
 * piles into one row per date to keep that list from growing unbounded, and
 * this is where tapping one actually shows (and lets you edit) what was
 * logged that day.
 */
export default function DayDetail() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { date } = useLocalSearchParams<{ date: string }>()
  const [meals, setMeals] = useState<MealSummary[] | null>(null)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      if (date) {
        void recentMeals(date, 100).then((m) => {
          if (alive) setMeals(m)
        })
      }
      return () => {
        alive = false
      }
    }, [date]),
  )

  const totalKcal = meals?.reduce((s, m) => s + m.calories, 0) ?? 0

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>{date ? formatDate(date) : 'Day'}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
      {meals && meals.length > 0 ? (
        <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
          {Math.round(totalKcal)} kcal total · tap a meal to edit it
        </Text>
      ) : null}

      <FlatList
        data={meals ?? []}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          meals == null ? null : (
            <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.xl, textAlign: 'center' }]}>
              No meals logged this day.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/camera', params: { editMealId: String(item.id) } })}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: spacing.md,
              backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md,
            }}
          >
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={{ width: 52, height: 52, borderRadius: radius.md }} />
            ) : (
              <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: theme.surfaceRaised }} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>{item.title}</Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                {Math.round(item.calories)} kcal · {new Date(item.loggedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  )
}
