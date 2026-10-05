import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DatePickerField } from '../../lib/components/DatePickerField'
import { NumberField } from '../../lib/components/NumberField'
import { OptionRow } from '../../lib/components/OptionRow'
import { addSelfReportedFight, displayCase, searchFighters, type Fighter } from '../../lib/fightersClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { LB_TO_KG } from '../../lib/units'

const TODAY = new Date()
const TEN_YEARS_AGO = new Date(TODAY.getFullYear() - 10, TODAY.getMonth(), TODAY.getDate())
const ONE_YEAR_OUT = new Date(TODAY.getFullYear() + 1, TODAY.getMonth(), TODAY.getDate())

/**
 * Self-service "add a fight" for a claimed fighter -- the app's scraper
 * only covers promotions it's been pointed at (backend/scraper/), so a
 * real fight at a local show, an amateur card, or any promotion outside
 * that list has no way to appear here otherwise. Stored as
 * is_self_reported (0028) rather than indistinguishable from scraped
 * data -- see lib/fightersClient.ts's addSelfReportedFight.
 */
export default function AddFight() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { slug } = useLocalSearchParams<{ slug: string }>()

  const [promotion, setPromotion] = useState('')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState<Date | null>(null)
  const [weightLb, setWeightLb] = useState('')
  const [opponentQuery, setOpponentQuery] = useState('')
  const [opponentSlug, setOpponentSlug] = useState<string | null>(null)
  const [opponentResults, setOpponentResults] = useState<Fighter[]>([])
  const [result, setResult] = useState<'win' | 'loss' | 'draw' | 'pending'>('win')
  const [saving, setSaving] = useState(false)

  // Search-to-link is opportunistic, not required -- most real opponents
  // (a local amateur show especially) won't be in a directory built from
  // a handful of scraped promotions, so free text always works even when
  // no match is found.
  //
  // opponentSlug is deliberately NOT reset in here. Selecting a suggestion
  // sets both opponentQuery and opponentSlug together, which re-triggers
  // this effect on the next render (opponentQuery changed) -- an earlier
  // version reset opponentSlug to null as this effect's first line, which
  // silently un-linked the just-selected opponent a moment after picking
  // them, since the effect can't tell "changed by typing" from "changed by
  // selecting" apart. Real typing invalidates the link in
  // onChangeOpponentQuery below instead, the one place that's actually
  // true.
  useEffect(() => {
    if (!opponentQuery.trim()) {
      setOpponentResults([])
      return
    }
    let alive = true
    const handle = setTimeout(() => {
      void searchFighters(opponentQuery).then((rows) => {
        if (alive) setOpponentResults(rows)
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [opponentQuery])

  function onChangeOpponentQuery(text: string) {
    setOpponentQuery(text)
    setOpponentSlug(null)
  }

  async function save() {
    if (saving) return
    if (!promotion.trim() || !eventName.trim() || !opponentQuery.trim()) {
      Alert.alert('Missing info', 'Promotion, event name, and opponent are all required.')
      return
    }
    setSaving(true)
    const weightLbV = Number.parseFloat(weightLb)
    const { ok, error } = await addSelfReportedFight(slug, {
      promotion: promotion.trim(),
      eventName: eventName.trim(),
      eventDateMs: eventDate ? eventDate.getTime() : null,
      weightKg: Number.isFinite(weightLbV) && weightLbV > 0 ? weightLbV * LB_TO_KG : null,
      opponentName: opponentQuery.trim(),
      opponentSlug,
      result,
    })
    setSaving(false)
    if (ok) {
      router.back()
    } else {
      Alert.alert("Couldn't add that fight", error ?? 'Try again.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Add a fight</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={[type.caption, { color: theme.textFaint, paddingHorizontal: spacing.lg, marginTop: spacing.xs, lineHeight: 18 }]}>
        For fights not already in our records. Shown on your profile as self-reported, separate from verified sources.
      </Text>

      <FlatList
        data={opponentQuery.trim() && !opponentSlug ? opponentResults : []}
        keyExtractor={(f) => f.slug}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Promotion</Text>
            <TextInput
              value={promotion}
              onChangeText={setPromotion}
              placeholder="e.g. Freedom Fighter Promotions"
              placeholderTextColor={theme.textFaint}
              style={{
                backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text, marginBottom: spacing.lg,
              }}
            />

            <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Event name</Text>
            <TextInput
              value={eventName}
              onChangeText={setEventName}
              placeholder="e.g. Fight Night 12"
              placeholderTextColor={theme.textFaint}
              style={{
                backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text, marginBottom: spacing.lg,
              }}
            />

            <DatePickerField label="Event date" value={eventDate} onChange={setEventDate} minimumDate={TEN_YEARS_AGO} maximumDate={ONE_YEAR_OUT} />

            <NumberField label="Weight (optional)" unit="lbs" value={weightLb} onChange={setWeightLb} placeholder="145" />

            <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Opponent</Text>
            <TextInput
              value={opponentQuery}
              onChangeText={onChangeOpponentQuery}
              placeholder="Opponent's name"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="words"
              autoCorrect={false}
              style={{
                backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
                padding: spacing.md, color: theme.text,
              }}
            />
            {opponentSlug ? (
              <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
                Linked to their profile. Tapping this fight later will jump to theirs too.
              </Text>
            ) : opponentQuery.trim() ? (
              <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
                No match found in our records yet. That's fine, this still saves as text.
              </Text>
            ) : null}

            <View style={{ marginTop: spacing.lg }}>
              <OptionRow
                label="Result"
                value={result}
                onChange={setResult}
                options={[
                  { value: 'win', label: 'Win' },
                  { value: 'loss', label: 'Loss' },
                  { value: 'draw', label: 'Draw' },
                  { value: 'pending', label: 'Not yet decided' },
                ]}
              />
            </View>
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              setOpponentQuery(item.name)
              setOpponentSlug(item.slug)
              setOpponentResults([])
            }}
            style={{ backgroundColor: theme.surface, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>{displayCase(item.name)}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{displayCase(item.gym) ?? 'Gym unknown'}</Text>
          </Pressable>
        )}
      />

      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>{saving ? 'Saving…' : 'Add fight'}</Text>
        </Pressable>
      </View>
    </View>
  )
}
