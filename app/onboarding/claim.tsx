import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { saveFullName } from '../../lib/accountClient'
import { displayCase, requestFighterClaim, requestNewFighterProfile, searchFighters, weightClassLabel, type Fighter } from '../../lib/fightersClient'
import { currentFightGoal } from '../../lib/repo'
import { supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

export default function ClaimProfile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  // Onboarding claiming used to be a dead end: once past this screen the
  // first time, there was no way back to it, even though claiming is
  // deliberately restricted to happening here (see app/fighter/[slug].tsx).
  // Reached a second way now, from Profile -- this flag is what tells the
  // screen "you're revisiting this, not going through onboarding for the
  // first time," so it can return you where you came from instead of
  // pushing you into the paywall a second time.
  const { standalone } = useLocalSearchParams<{ standalone?: string }>()
  const isStandalone = standalone === '1'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Fighter[]>([])
  const [claiming, setClaiming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    let alive = true
    const handle = setTimeout(() => {
      void searchFighters(query).then((rows) => {
        if (alive) setResults(rows)
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [query])

  async function next() {
    // Fire-and-forget: this is this app's only name-entry moment (see
    // save_full_name, 0026), so whatever's typed here becomes the
    // account's name whether or not a fighter match was ever claimed.
    // Never blocks navigation on it -- a failed save shouldn't stall
    // onboarding.
    void saveFullName(query)
    if (isStandalone) {
      router.back()
      return
    }
    // Reached from onboarding (account.tsx, fighter signup only) now --
    // this screen used to be a dead end that pushed to /paywall, back when
    // it was still reachable. Carrying forward the same
    // cut-together-if-a-real-goal-exists-else-straight-into-the-app
    // routing that account.tsx used to do itself before this screen was
    // reconnected to the real signup flow.
    const goal = await currentFightGoal()
    if (goal) {
      router.replace('/onboarding/cut-together')
    } else {
      router.replace('/(tabs)')
    }
  }

  // Every claim now goes to Jean for review before it takes effect (see
  // requestFighterClaim/requestNewFighterProfile) -- a real mistaken claim
  // happened during testing (claiming a profile that obviously wasn't the
  // claimer) with zero verification in the way. This confirmation is a
  // second, cheaper layer on top of that review, not a replacement for
  // it -- it catches a careless tap before it ever reaches the queue.
  function confirmClaim(f: Fighter) {
    Alert.alert(
      'Is this really you?',
      `${displayCase(f.name)}${f.gym ? ` from ${displayCase(f.gym)}` : ''}. This gets sent for review before it's linked to your account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, this is me', onPress: () => claim(f) },
      ],
    )
  }

  async function claim(f: Fighter) {
    if (claiming) return
    setClaiming(f.slug)
    const { ok, error } = await requestFighterClaim(f.slug)
    setClaiming(null)
    if (ok) {
      void saveFullName(query)
      Alert.alert('Request sent', "We'll review it and link your account once it's approved.", [{ text: 'OK', onPress: next }])
    } else {
      Alert.alert("Couldn't send that request", error ?? 'Try again.')
    }
  }

  // For a fighter no promotion this app tracks has ever scraped -- the
  // directory previously had no way to contain someone who isn't in one
  // of those, since `fighters` was only ever written by the scraper. The
  // row itself isn't created until this is approved (0036).
  async function createProfile() {
    if (creating || !query.trim()) return
    setCreating(true)
    const { ok, error } = await requestNewFighterProfile(query)
    setCreating(false)
    if (ok) {
      void saveFullName(query)
      Alert.alert('Request sent', "We'll review it and set up your profile once it's approved.", [{ text: 'OK', onPress: next }])
    } else {
      Alert.alert("Couldn't send that request", error ?? 'Try again.')
    }
  }

  // Not built against real accounts yet if the backend isn't configured --
  // same skip-forward pattern as the rest of onboarding in that state.
  if (!supabaseConfigured) {
    next()
    return null
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>Is that you?</Text>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs, lineHeight: 22 }]}>
        We track real Muay Thai and kickboxing fight records. Search your name below and request to link your fight history to your account. Every request gets reviewed before it's approved.
        {isStandalone ? '' : " Not everyone will find themselves yet. That's fine, skip this if so."}
      </Text>

      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your name"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="words"
          autoCorrect={false}
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text,
          }}
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(f) => f.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.md, gap: spacing.sm }}
        ListFooterComponent={
          query.trim() ? (
            <Pressable
              accessibilityRole="button"
              disabled={creating}
              onPress={createProfile}
              style={{
                marginTop: spacing.sm, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
                alignItems: 'center', justifyContent: 'center', opacity: creating ? 0.6 : 1,
              }}
            >
              <Text style={[type.bodyStrong, { color: theme.text }]}>
                {creating ? 'Sending…' : `Can't find yourself? Create your profile`}
              </Text>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => confirmClaim(item)}
            disabled={claiming != null || item.claimedByUserId != null}
            style={{
              backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg,
              flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              opacity: item.claimedByUserId != null ? 0.5 : 1,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyStrong, { color: theme.text }]}>{displayCase(item.name)}</Text>
              <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                {displayCase(item.gym) ?? 'Gym unknown'}{item.weightKg != null ? ` · ${weightClassLabel(item.weightKg)}` : ''}
              </Text>
            </View>
            <Text style={[type.caption, { color: theme.textFaint }]}>
              {item.claimedByUserId != null ? 'Claimed' : claiming === item.slug ? 'Sending…' : 'This is me'}
            </Text>
          </Pressable>
        )}
      />

      <View style={{ flex: 1 }} />
      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          onPress={next}
          style={{ height: 60, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.text, fontSize: 18 }]}>{isStandalone ? 'Close' : 'Skip for now'}</Text>
        </Pressable>
      </View>
    </View>
  )
}
