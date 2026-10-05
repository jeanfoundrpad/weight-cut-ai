import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { frequentMeals, type MealTemplate } from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'

function timeAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function LogRecent() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<MealTemplate[] | null>(null)

  useEffect(() => {
    void frequentMeals().then(setMeals)
  }, [])

  function pick(meal: MealTemplate) {
    router.replace({ pathname: '/camera', params: { mode: 'manual', template: JSON.stringify(meal.items) } })
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Recent meals</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        Tap one to log it again. You can still adjust anything before saving.
      </Text>

      <FlatList
        data={meals ?? []}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          meals == null ? null : (
            <Text style={[type.body, { color: theme.textMuted, marginTop: spacing.xl, textAlign: 'center' }]}>
              No meal history yet. Scan or add a meal first to build up your recent list.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => pick(item)}
            style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>{item.title}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
              {Math.round(item.items.reduce((s, i) => s + i.calories, 0))} kcal
              {item.timesLogged > 1 ? ` · logged ${item.timesLogged} times` : ''} · last {timeAgo(item.lastLoggedAt)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}
