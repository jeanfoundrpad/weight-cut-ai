import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FadeSlideIn } from '../../lib/components/FadeSlideIn'
import { FilterChip } from '../../lib/components/FilterChip'
import { NumberField } from '../../lib/components/NumberField'
import { Pulse } from '../../lib/components/Pulse'
import { VerifiedBadge } from '../../lib/components/VerifiedBadge'
import {
  displayCase, fightersInMyCutWindow, fightersNearWeight, gymsSummary, recordSummary, searchFighters, trendingFighters,
  weightClassLabel, type Fighter, type GymSummary, type TrendingFighter,
} from '../../lib/fightersClient'
import { currentFightGoal, weightHistory, type FightGoal } from '../../lib/repo'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB } from '../../lib/units'

type SexFilter = 'all' | 'male' | 'female'

// Numeric, not named boxing-style classes -- see app/weight-class/[lb].tsx
// for why. A ladder of common fight weights, not an exhaustive list.
const DIVISION_CENTERS_LB = [115, 125, 135, 145, 155, 165, 175, 185, 205]

function dateLabel(ms: number | null): string {
  if (ms == null) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function TrendingCard({ f, theme, index }: { f: TrendingFighter; theme: ReturnType<typeof useTheme>; index: number }) {
  return (
    <FadeSlideIn delayMs={Math.min(index, 8) * 40}>
      <Pressable
        onPress={() => router.push({ pathname: '/fighter/[slug]', params: { slug: f.slug } })}
        style={{ backgroundColor: theme.accentFlame + '14', borderRadius: radius.lg, padding: spacing.md, width: 152, marginRight: spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={1}>{displayCase(f.name)}</Text>
          {f.claimedByUserId ? <VerifiedBadge size={13} /> : null}
        </View>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]} numberOfLines={1}>
          {displayCase(f.gym) ?? 'Gym unknown'}
        </Text>
        <Pulse style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
          <Text style={[type.caption, { color: theme.accentFlame, fontWeight: '700' }]}>
            {f.fightsThisYear} fight{f.fightsThisYear === 1 ? '' : 's'} this year
          </Text>
        </Pulse>
      </Pressable>
    </FadeSlideIn>
  )
}

function GymCard({ g, theme, index }: { g: GymSummary; theme: ReturnType<typeof useTheme>; index: number }) {
  return (
    <FadeSlideIn delayMs={Math.min(index, 8) * 40}>
      <Pressable
        onPress={() => router.push({ pathname: '/gym/[name]', params: { name: g.gym } })}
        style={{ backgroundColor: theme.accentLine + '14', borderRadius: radius.lg, padding: spacing.md, width: 152, marginRight: spacing.sm }}
      >
        <Text style={[type.bodyStrong, { color: theme.text }]} numberOfLines={2}>{displayCase(g.gym)}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
          {g.fighterCount} fighter{g.fighterCount === 1 ? '' : 's'}
        </Text>
      </Pressable>
    </FadeSlideIn>
  )
}

function DivisionChip({ lb, theme, index }: { lb: number; theme: ReturnType<typeof useTheme>; index: number }) {
  return (
    <FadeSlideIn delayMs={Math.min(index, 8) * 40}>
      <Pressable
        onPress={() => router.push({ pathname: '/weight-class/[lb]', params: { lb: lb.toString() } })}
        style={{
          height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, marginRight: spacing.sm,
          alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
        }}
      >
        <Text style={[type.bodyStrong, { color: theme.text }]}>{lb} lb</Text>
      </Pressable>
    </FadeSlideIn>
  )
}

function FighterRow({ f, theme, index }: { f: Fighter; theme: ReturnType<typeof useTheme>; index: number }) {
  const record = recordSummary(f)

  // division/height are all-or-nothing from the same dated snapshot (see
  // fightersClient.ts) -- when present, the record is from that same dated
  // snapshot too and belongs in the same "as of" line. A record with no
  // snapshot (muaythairecords.com fighters) is that source's own
  // continuously-updated total, shown on its own undated line instead.
  // Age deliberately left out of this list view per Jean -- still on the
  // fighter's own detail screen, just not needed for a quick browse card.
  const hasSnapshot = f.division != null || f.height != null
  const snapshotBits = [
    f.division ? (f.division === 'amateur' ? 'Amateur' : 'Pro') : null,
    f.height,
    hasSnapshot && record ? `Record ${record}` : null,
  ].filter(Boolean)

  return (
    <FadeSlideIn delayMs={Math.min(index, 8) * 40}>
      <Pressable
        onPress={() => router.push({ pathname: '/fighter/[slug]', params: { slug: f.slug } })}
        style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[type.bodyStrong, { color: theme.text }]}>{displayCase(f.name)}</Text>
            {f.claimedByUserId ? <VerifiedBadge /> : null}
          </View>
          {f.weightKg != null ? (
            <Text style={[type.bodyStrong, { color: theme.text }]}>{weightClassLabel(f.weightKg)}</Text>
          ) : null}
        </View>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          {[displayCase(f.gym) ?? 'Gym unknown', f.sex ? (f.sex === 'male' ? 'Male' : 'Female') : null].filter(Boolean).join(' · ')}
        </Text>
        {hasSnapshot ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.sm }]}>
            {snapshotBits.join(' · ')}
            {f.asOfDateMs ? ` (as of ${dateLabel(f.asOfDateMs)})` : ''}
          </Text>
        ) : record ? (
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.sm }]}>Record {record}</Text>
        ) : null}
        {f.promotion || f.eventName ? (
          <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
            {[f.promotion, f.eventName, dateLabel(f.eventDateMs)].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </Pressable>
    </FadeSlideIn>
  )
}

/**
 * The fighter directory, promoted from a modal reached through Groups to
 * its own tab -- per Jean directly: "the fighter stuff is almost the core
 * part of the app... the community part will be an essential part of the
 * app." A feature described as essential shouldn't sit one tap deeper
 * than everything else.
 */
export default function FightersScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [centerLb, setCenterLb] = useState('150')
  const [query, setQuery] = useState('')
  const [byWeight, setByWeight] = useState<Fighter[]>([])
  const [byQuery, setByQuery] = useState<Fighter[]>([])
  const [loading, setLoading] = useState(false)
  const [fightGoal, setFightGoal] = useState<FightGoal | null>(null)
  // Off by default -- a static weight browse is still the more familiar
  // mode, this is an opt-in lens on top of it once a fight goal exists.
  const [myCutWindow, setMyCutWindow] = useState(false)
  const [sexFilter, setSexFilter] = useState<SexFilter>('all')
  const [trending, setTrending] = useState<TrendingFighter[]>([])
  const [gyms, setGyms] = useState<GymSummary[]>([])

  useEffect(() => {
    void weightHistory().then((points) => {
      const last = points[points.length - 1]
      if (last) setCenterLb(Math.round(last.weightKg * KG_TO_LB).toString())
    })
    void currentFightGoal().then(setFightGoal)
    void gymsSummary(15).then(setGyms)
  }, [])

  // Refreshes on every focus, not just first mount -- someone who just
  // added their own yearly fight count from the edit screen and comes
  // back here should see it reflected, not a stale snapshot from before
  // they logged it.
  useFocusEffect(
    useCallback(() => {
      void trendingFighters(15).then(setTrending)
    }, []),
  )

  useEffect(() => {
    let alive = true
    setLoading(true)

    // "Cutting weight" replaces the plain weight browse with one that also
    // weighs timing -- built from the user's own real fight goal
    // (weighInTargetKg/weighInDateMs), not just the manually typed weight
    // box, since the point is "who else is cutting toward *my* actual
    // fight," not just this weight in the abstract.
    if (myCutWindow && fightGoal) {
      void fightersInMyCutWindow(fightGoal.weighInTargetKg * KG_TO_LB, fightGoal.weighInDateMs).then((rows) => {
        if (alive) {
          setByWeight(rows)
          setLoading(false)
        }
      })
      return () => {
        alive = false
      }
    }

    const center = Number.parseFloat(centerLb)
    if (!Number.isFinite(center) || center <= 0) return
    void fightersNearWeight(center, 10).then((rows) => {
      if (alive) {
        setByWeight(rows)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [centerLb, myCutWindow, fightGoal])

  useEffect(() => {
    if (!query.trim()) {
      setByQuery([])
      return
    }
    let alive = true
    const handle = setTimeout(() => {
      void searchFighters(query).then((rows) => {
        if (alive) setByQuery(rows)
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [query])

  const searching = query.trim().length > 0
  const bySexFilter = (rows: Fighter[]) => (sexFilter === 'all' ? rows : rows.filter((f) => f.sex === sexFilter))
  const list = bySexFilter(searching ? byQuery : byWeight)

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.sm }}>
      <Text style={[type.heading, { color: theme.text, paddingHorizontal: spacing.lg }]}>USA Muaythai Fighters</Text>
      <Text style={[type.caption, { color: theme.textFaint, paddingHorizontal: spacing.lg, marginTop: 2 }]}>
        Look someone up, or browse by weight class.
      </Text>

      <FlatList
        data={list}
        keyExtractor={(f) => f.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.md, paddingBottom: 140, gap: spacing.sm }}
        ListHeaderComponent={
          <>
            {!searching && trending.length > 0 ? (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Trending</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {trending.map((f, i) => (
                    <TrendingCard key={f.slug} f={f} theme={theme} index={i} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {!searching && gyms.length > 0 ? (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Browse gyms</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {gyms.map((g, i) => (
                    <GymCard key={g.gym} g={g} theme={theme} index={i} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {!searching ? (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Browse by division</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {DIVISION_CENTERS_LB.map((lb, i) => (
                    <DivisionChip key={lb} lb={lb} theme={theme} index={i} />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a name or gym"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text, marginBottom: spacing.sm,
              }}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
              <FilterChip label="All" active={sexFilter === 'all'} onPress={() => setSexFilter('all')} theme={theme} />
              <FilterChip label="Male" active={sexFilter === 'male'} onPress={() => setSexFilter('male')} theme={theme} />
              <FilterChip label="Female" active={sexFilter === 'female'} onPress={() => setSexFilter('female')} theme={theme} />
              {fightGoal ? (
                <FilterChip label="Cutting weight" active={myCutWindow} onPress={() => setMyCutWindow((v) => !v)} theme={theme} />
              ) : null}
            </View>

            {!searching && !myCutWindow ? (
              <NumberField label="Or browse by your weight class" unit="lbs" value={centerLb} onChange={setCenterLb} placeholder="150" />
            ) : null}
          </>
        }
        ListEmptyComponent={
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl }]}>
            {loading && !searching ? 'Loading…' : searching ? 'No fighters or gyms match that.' : 'No fighters found in this weight range yet.'}
          </Text>
        }
        renderItem={({ item, index }) => <FighterRow f={item} theme={theme} index={index} />}
      />
    </View>
  )
}
