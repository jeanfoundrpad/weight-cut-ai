import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, FlatList, Image, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  deleteSelfReportedFight,
  displayCase,
  fighterAppearances,
  fighterBySlug,
  nextScheduledFight,
  recordSummary,
  sharedProgressFor,
  unclaimFighter,
  updateAppearanceResult,
  weightClassLabel,
  type Fighter,
  type FighterAppearance,
  type SharedProgress,
} from '../../lib/fightersClient'
import { inviteToCutTogether } from '../../lib/groupsClient'
import { VerifiedBadge } from '../../lib/components/VerifiedBadge'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { meterColors, radius, spacing, type, useTheme } from '../../lib/theme'

function dateLabel(ms: number | null): string {
  if (ms == null) return ''
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Fixed win/loss/pending colors, not themed -- same reasoning as
// lib/theme.tsx's meterColors: this is status, not decoration, so it stays
// legible and consistent regardless of light/dark mode.
const RESULT_LABEL: Record<FighterAppearance['result'], string> = { win: 'W', loss: 'L', draw: 'D', pending: '•' }
function resultColor(result: FighterAppearance['result'], theme: ReturnType<typeof useTheme>): string {
  if (result === 'win') return meterColors.high
  if (result === 'loss') return theme.danger
  if (result === 'draw') return theme.textMuted
  return theme.textFaint
}

function AppearanceRow({
  a, theme, canDelete, onDelete, canResolve, onResolve,
}: {
  a: FighterAppearance
  theme: ReturnType<typeof useTheme>
  canDelete: boolean
  onDelete: (id: string) => void
  canResolve: boolean
  onResolve: (id: string) => void
}) {
  function confirmDelete() {
    Alert.alert('Remove this fight?', 'This only removes what you added yourself.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onDelete(a.id) },
    ])
  }

  const content = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
          <View
            style={{
              width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
              backgroundColor: resultColor(a.result, theme) + '26',
            }}
          >
            <Text style={[type.caption, { color: resultColor(a.result, theme), fontWeight: '700' }]}>
              {RESULT_LABEL[a.result]}
            </Text>
          </View>
          <Text style={[type.bodyStrong, { color: theme.text }]}>
            vs {displayCase(a.opponentName)}{a.opponentSlug ? ' →' : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {canResolve && a.result === 'pending' ? (
            <Pressable accessibilityRole="button" onPress={() => onResolve(a.id)} hitSlop={spacing.sm}>
              <Text style={[type.caption, { color: theme.primary }]}>Add result</Text>
            </Pressable>
          ) : null}
          {canDelete && a.isSelfReported ? (
            <Pressable accessibilityRole="button" onPress={confirmDelete} hitSlop={spacing.sm}>
              <Text style={[type.caption, { color: theme.danger }]}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
        {[a.weightKg != null ? weightClassLabel(a.weightKg) : null, a.promotion].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
        {a.eventName}{a.eventDateMs ? ` · ${dateLabel(a.eventDateMs)}` : ''}
      </Text>
      {a.isSelfReported || a.resultSelfReported ? (
        <View style={{ alignSelf: 'flex-start', marginTop: spacing.xs, backgroundColor: theme.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
          <Text style={[type.caption, { color: theme.textMuted, fontSize: 11 }]}>
            {a.isSelfReported ? 'Self-reported' : 'Result self-reported'}
          </Text>
        </View>
      ) : null}
    </>
  )

  // opponentSlug is null only for a handful of rows scraped before that
  // column existed -- falls back to plain, non-interactive text rather
  // than a dead link for those.
  if (!a.opponentSlug) {
    return <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>{content}</View>
  }

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/fighter/[slug]', params: { slug: a.opponentSlug! } })}
      style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}
    >
      {content}
    </Pressable>
  )
}

export default function FighterDetail() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const [fighter, setFighter] = useState<Fighter | null>(null)
  const [appearances, setAppearances] = useState<FighterAppearance[]>([])
  const [selfId, setSelfId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sharedProgress, setSharedProgress] = useState<SharedProgress | null>(null)
  const [inviting, setInviting] = useState(false)
  const [invited, setInvited] = useState(false)

  const load = useCallback(async () => {
    const [f, apps] = await Promise.all([fighterBySlug(slug), fighterAppearances(slug)])
    setFighter(f)
    setAppearances(apps)
    // A second, dependent fetch -- only meaningful once we know whether
    // this fighter is claimed at all, and by whom. RLS enforces the
    // opt-in server-side regardless, but there's no point querying at all
    // for the (common) unclaimed case.
    setSharedProgress(f?.claimedByUserId ? await sharedProgressFor(f.claimedByUserId) : null)
    if (supabaseConfigured && supabase) {
      const { data } = await supabase.auth.getUser()
      setSelfId(data.user?.id ?? null)
    }
  }, [slug])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const isClaimedByMe = fighter?.claimedByUserId != null && fighter.claimedByUserId === selfId
  const isClaimedByOther = fighter?.claimedByUserId != null && fighter.claimedByUserId !== selfId

  async function onUnclaim() {
    setBusy(true)
    const { ok, error } = await unclaimFighter(slug)
    setBusy(false)
    if (ok) {
      await load()
    } else {
      Alert.alert("Couldn't remove claim", error ?? 'Try again.')
    }
  }

  async function onInviteToCutTogether() {
    if (inviting || invited) return
    setInviting(true)
    const { ok, error } = await inviteToCutTogether(slug)
    setInviting(false)
    if (ok) {
      // The RPC itself is idempotent (returns the same existing invite on
      // a repeat call rather than creating a duplicate), but the button
      // still needs its own memory of that within this visit -- otherwise
      // it just goes back to reading "Cut together" as if nothing
      // happened, with no sign the first tap actually worked.
      setInvited(true)
      Alert.alert('Invite sent', `${displayCase(fighter?.name ?? null) ?? 'They'}'ll see it next time they open Groups.`)
    } else {
      Alert.alert("Couldn't send that invite", error ?? 'Try again.')
    }
  }

  async function onDeleteAppearance(id: string) {
    const { ok, error } = await deleteSelfReportedFight(id)
    if (ok) {
      await load()
    } else {
      Alert.alert("Couldn't remove that fight", error ?? 'Try again.')
    }
  }

  async function submitResult(id: string, result: 'win' | 'loss' | 'draw') {
    const { ok, error } = await updateAppearanceResult(id, result)
    if (ok) {
      await load()
    } else {
      Alert.alert("Couldn't update that fight", error ?? 'Try again.')
    }
  }

  // Reached from AppearanceRow's "Add result" action, own claimed profile
  // only -- for the common real case where the source never published a
  // result at all (see 0040's migration comment).
  function onResolveAppearance(id: string) {
    Alert.alert('What was the result?', undefined, [
      { text: 'Win', onPress: () => void submitResult(id, 'win') },
      { text: 'Loss', onPress: () => void submitResult(id, 'loss') },
      { text: 'Draw', onPress: () => void submitResult(id, 'draw') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const nextFight = nextScheduledFight(appearances, Date.now())
  const record = fighter ? recordSummary(fighter) : null
  const hasSnapshot = fighter != null && (fighter.division != null || fighter.age != null || fighter.height != null)
  const snapshotBits = fighter
    ? [
        fighter.division ? (fighter.division === 'amateur' ? 'Amateur' : 'Pro') : null,
        fighter.age != null ? `${fighter.age} yo` : null,
        fighter.height,
        hasSnapshot && record ? `Record ${record}` : null,
      ].filter(Boolean)
    : []

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
          <Text style={[type.title, { color: theme.text }]} numberOfLines={1}>{displayCase(fighter?.name ?? null) ?? 'Fighter'}</Text>
          {fighter?.claimedByUserId ? <VerifiedBadge size={18} /> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      {fighter ? (
        <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          {fighter.photoUrl ? (
            <Image
              source={{ uri: fighter.photoUrl }}
              style={{ width: 72, height: 72, borderRadius: 36, alignSelf: 'center', marginBottom: spacing.md }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {[displayCase(fighter.gym) ?? 'Gym unknown', fighter.sex ? (fighter.sex === 'male' ? 'Male' : 'Female') : null].filter(Boolean).join(' · ')}
            </Text>
            {fighter.weightKg != null ? (
              <Text style={[type.bodyStrong, { color: theme.text }]}>{weightClassLabel(fighter.weightKg)}</Text>
            ) : null}
          </View>
          {hasSnapshot ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.sm }]}>
              {snapshotBits.join(' · ')}
              {fighter.asOfDateMs ? ` (as of ${dateLabel(fighter.asOfDateMs)})` : ''}
            </Text>
          ) : record ? (
            <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.sm }]}>Record {record}</Text>
          ) : null}
          {fighter.promotion || fighter.eventName ? (
            <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
              {[fighter.promotion, fighter.eventName, dateLabel(fighter.eventDateMs)].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          {sharedProgress ? (
            <View style={{ marginTop: spacing.md, backgroundColor: theme.bg, borderRadius: radius.md, padding: spacing.md }}>
              <Text style={[type.caption, { color: theme.textFaint }]}>Tracked weight (shared by this fighter)</Text>
              <Text style={[type.bodyStrong, { color: theme.text, marginTop: 2 }]}>{weightClassLabel(sharedProgress.currentWeightKg)}</Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                Updated {dateLabel(sharedProgress.updatedAtMs)}
                {sharedProgress.weighInTargetKg != null && sharedProgress.weighInDateMs != null
                  ? ` · cutting to ${weightClassLabel(sharedProgress.weighInTargetKg)} by ${dateLabel(sharedProgress.weighInDateMs)}`
                  : ''}
              </Text>
            </View>
          ) : null}

          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            {isClaimedByMe ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/fighter/edit', params: { slug } })}
                  style={{ height: 48, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Edit profile</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onUnclaim}
                  style={{ height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
                >
                  <Text style={[type.bodyStrong, { color: theme.text }]}>This is me. Remove claim</Text>
                </Pressable>
              </>
            ) : isClaimedByOther ? (
              <>
                <Text style={[type.caption, { color: theme.textFaint, textAlign: 'center' }]}>Claimed by another fighter.</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={inviting || invited}
                  onPress={onInviteToCutTogether}
                  style={{ height: 48, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: inviting || invited ? 0.6 : 1 }}
                >
                  <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>
                    {inviting ? 'Sending…' : invited ? 'Invite sent' : 'Cut together'}
                  </Text>
                </Pressable>
              </>
            ) : (
              // Claiming only happens once, during onboarding's name-entry
              // step (app/onboarding/claim.tsx) -- not offered here, so a
              // profile can't be claimed on a whim while just browsing the
              // directory later.
              <Text style={[type.caption, { color: theme.textFaint, textAlign: 'center' }]}>
                Is this you? Claim it from the Profile tab.
              </Text>
            )}
          </View>
        </View>
      ) : null}

      {nextFight ? (
        <View
          style={{
            marginHorizontal: spacing.lg, marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg,
            padding: spacing.lg, borderWidth: 1, borderColor: theme.primary,
          }}
        >
          <Text style={[type.label, { color: theme.textMuted }]}>Next fight</Text>
          <Text style={[type.bodyStrong, { color: theme.text, marginTop: spacing.xs }]}>
            vs {displayCase(nextFight.opponentName)}
          </Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
            {[nextFight.promotion, nextFight.eventName, dateLabel(nextFight.eventDateMs)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.xs }}>
        <Text style={[type.label, { color: theme.textMuted }]}>Fight history</Text>
        {isClaimedByMe ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/fighter/add-fight', params: { slug } })}>
            <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>+ Add a fight</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        data={appearances}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: 140, gap: spacing.sm }}
        ListEmptyComponent={
          <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.lg }]}>No recorded appearances.</Text>
        }
        renderItem={({ item }) => (
          <AppearanceRow
            a={item}
            theme={theme}
            canDelete={isClaimedByMe}
            onDelete={onDeleteAppearance}
            canResolve={isClaimedByMe}
            onResolve={onResolveAppearance}
          />
        )}
      />
    </View>
  )
}
