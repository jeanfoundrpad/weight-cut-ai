import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FilterChip } from '../../lib/components/FilterChip'
import { VerifiedBadge } from '../../lib/components/VerifiedBadge'
import { displayCase, fightersNearWeight, recordSummary, weightClassLabel, type Fighter } from '../../lib/fightersClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

const DIVISION_RANGE_LB = 5

type SexFilter = 'all' | 'male' | 'female'

function DivisionFighterRow({ f, theme }: { f: Fighter; theme: ReturnType<typeof useTheme> }) {
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
          {[displayCase(f.gym) ?? 'Gym unknown', record ? `Record ${record}` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {f.weightKg != null ? (
        <Text style={[type.bodyStrong, { color: theme.text }]}>{weightClassLabel(f.weightKg)}</Text>
      ) : null}
    </Pressable>
  )
}

/**
 * One weight division's own roster -- a tighter ±5 lb band than the
 * general weight-browse on the Fighters tab (±10 lb), reachable from its
 * "Browse by division" chips. Deliberately just numeric ("145 lb"), not
 * named boxing-style classes (Featherweight, etc.) -- Muay Thai divisions
 * don't map cleanly onto those names, and getting one wrong would be
 * worse than not naming it at all.
 */
export default function WeightClassRoster() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { lb } = useLocalSearchParams<{ lb: string }>()
  const centerLb = Number.parseInt(lb, 10)
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [loading, setLoading] = useState(true)
  const [sexFilter, setSexFilter] = useState<SexFilter>('all')

  useEffect(() => {
    if (!Number.isFinite(centerLb)) return
    setLoading(true)
    void fightersNearWeight(centerLb, DIVISION_RANGE_LB).then((rows) => {
      setFighters(rows)
      setLoading(false)
    })
  }, [centerLb])

  const filtered = sexFilter === 'all' ? fighters : fighters.filter((f) => f.sex === sexFilter)

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.heading, { color: theme.text }]}>{centerLb} lb division</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: theme.textFaint, paddingHorizontal: spacing.lg, marginTop: 2 }]}>
        Fighters within {DIVISION_RANGE_LB} lb of {centerLb} lb.
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
        <FilterChip label="All" active={sexFilter === 'all'} onPress={() => setSexFilter('all')} theme={theme} />
        <FilterChip label="Male" active={sexFilter === 'male'} onPress={() => setSexFilter('male')} theme={theme} />
        <FilterChip label="Female" active={sexFilter === 'female'} onPress={() => setSexFilter('female')} theme={theme} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(f) => f.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl }]}>
            {loading ? 'Loading…' : 'No fighters found in this division yet.'}
          </Text>
        }
        renderItem={({ item }) => <DivisionFighterRow f={item} theme={theme} />}
      />
    </View>
  )
}
