import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { VerifiedBadge } from '../../lib/components/VerifiedBadge'
import { displayCase, fightersAtGym, recordSummary, weightClassLabel, type Fighter } from '../../lib/fightersClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

function GymFighterRow({ f, theme }: { f: Fighter; theme: ReturnType<typeof useTheme> }) {
  const record = recordSummary(f)

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/fighter/[slug]', params: { slug: f.slug } })}
      style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>{displayCase(f.name)}</Text>
          {f.claimedByUserId ? <VerifiedBadge /> : null}
        </View>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          {[f.sex ? (f.sex === 'male' ? 'Male' : 'Female') : null, record ? `Record ${record}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {f.weightKg != null ? (
        <Text style={[type.bodyStrong, { color: theme.text }]}>{weightClassLabel(f.weightKg)}</Text>
      ) : null}
    </Pressable>
  )
}

/** A gym's own roster -- reachable from the Fighters tab's "Browse gyms" section (0034's gyms_summary view). */
export default function GymRoster() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { name } = useLocalSearchParams<{ name: string }>()
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void fightersAtGym(name).then((rows) => {
      setFighters(rows)
      setLoading(false)
    })
  }, [name])

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.heading, { color: theme.text, flex: 1 }]} numberOfLines={1}>{displayCase(name)}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: theme.textFaint, paddingHorizontal: spacing.lg, marginTop: 2 }]}>
        {fighters.length} fighter{fighters.length === 1 ? '' : 's'} in the directory
      </Text>

      <FlatList
        data={fighters}
        keyExtractor={(f) => f.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl }]}>
            {loading ? 'Loading…' : 'No fighters found for this gym.'}
          </Text>
        }
        renderItem={({ item }) => <GymFighterRow f={item} theme={theme} />}
      />
    </View>
  )
}
