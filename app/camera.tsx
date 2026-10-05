import { Ionicons } from '@expo/vector-icons'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useId, useRef, useState } from 'react'
import { ActivityIndicator, Alert, InputAccessoryView, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { analyzePhoto } from '../lib/aiProxy'
import { cancelReminderFor } from '../lib/dailyReminder'
import { deleteMealEntry, localDateFrom, logMeal, mealForEdit, updateMeal, type ScanEstimate } from '../lib/repo'
import { radius, spacing, type, useTheme, type Theme } from '../lib/theme'

/**
 * A client-only id, never sent to the AI or the database — purely so the
 * review list below can give each card a React key that survives a
 * removal elsewhere in the list. Without it, cards were keyed by array
 * index, so removing an earlier item shifted every later item into a
 * reused component instance at the same slot, and anything that instance
 * held in local state (the quantity-scale feedback added below) would
 * silently show as belonging to the wrong item. A plain incrementing
 * counter is enough — these ids only need to be unique within one
 * open review screen, never compared across sessions.
 */
let nextUiKey = 0
function makeUiKey(): string {
  nextUiKey += 1
  return `item-${nextUiKey}`
}

type ReviewItem = ScanEstimate & { uiKey: string }

function withUiKeys(items: ScanEstimate[]): ReviewItem[] {
  return items.map((item) => ({ ...item, uiKey: makeUiKey() }))
}

function stripUiKeys(items: ReviewItem[]): ScanEstimate[] {
  return items.map(({ uiKey: _uiKey, ...item }) => item)
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'shooting' }
  | { kind: 'analyzing'; photoUri: string }
  | { kind: 'review'; photoUri: string | null; items: ReviewItem[]; isMock: boolean }

function blankReviewItem(): ReviewItem {
  return { label: '', servingLabel: null, grams: null, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, uiKey: makeUiKey() }
}

/**
 * Scales grams/calories/macros together from whatever the item's values
 * are right now — the fix for the single most common AI-estimation miss
 * (confirmed by two independent reviews of a competitor's meal-scan
 * feature): the model undercounts *how many* of something there are, not
 * just what it is — a four-egg omelette read back as "one whole egg,"
 * cutting protein and fat by roughly 4x. Manually recomputing five fields
 * by hand for a 4x miss is exactly the friction that makes people not
 * bother fixing it; one tap should do the whole correction.
 */
function scaleItem(item: ReviewItem, factor: number): ReviewItem {
  return {
    ...item,
    grams: item.grams == null ? null : item.grams * factor,
    calories: item.calories * factor,
    proteinG: item.proteinG * factor,
    carbsG: item.carbsG * factor,
    fatG: item.fatG * factor,
  }
}

function parseDecimalText(text: string): number | null {
  if (text === '' || text === '.') return null
  const n = Number.parseFloat(text)
  return Number.isFinite(n) ? n : null
}

/** Decimal-capable ("someone ate half of this" is often not a whole
 * number) — keeps its own text buffer rather than deriving the shown text
 * from `value` on every keystroke, since reformatting immediately after
 * typing "10." (e.g. back to "10") would strip the trailing "." and make
 * it impossible to ever finish typing a decimal like "10.9". The buffer
 * only gets overwritten from `value` when the prop changes to a number the
 * current text doesn't already represent — i.e. some outside change (a
 * different item now occupies this slot after another item was removed),
 * never as an echo of this field's own edit.
 *
 * iOS never shows a Return/Done key on numeric keyboards — same platform
 * quirk NumberField already works around, via the same InputAccessoryView
 * pattern (unique per instance via useId(), so multiple StatFields on one
 * screen don't collide with each other's Done bar). */
function StatField({ label, value, onChange, theme }: { label: string; value: number | null; onChange: (v: number | null) => void; theme: Theme }) {
  const accessoryId = useId()
  const [text, setText] = useState(value != null ? String(value) : '')

  useEffect(() => {
    if (parseDecimalText(text) !== value) {
      setText(value != null ? String(value) : '')
    }
    // Only re-sync when `value` changes from outside this field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <View style={{ flex: 1 }}>
      <Text style={[type.caption, { color: theme.textFaint, marginBottom: 2 }]}>{label}</Text>
      <TextInput
        value={text}
        onChangeText={(t) => {
          const cleaned = t.replace(/[^0-9.]/g, '')
          const firstDot = cleaned.indexOf('.')
          const normalized = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
          setText(normalized)
          onChange(parseDecimalText(normalized))
        }}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={theme.textFaint}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
        style={{ color: theme.text, fontSize: 16, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 4 }}
      />
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.sm, backgroundColor: theme.surfaceRaised }}>
            <Pressable accessibilityRole="button" onPress={Keyboard.dismiss} hitSlop={spacing.md}>
              <Text style={[type.bodyStrong, { color: theme.primary }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  )
}

const QUICK_SCALE_FACTORS = [0.5, 2, 3, 4]

/**
 * The quantity-scale action itself stays a one-shot transform (reads
 * `item` and calls `onChange` immediately, no persistent "how many
 * servings" number) — but this card is now keyed by a stable `uiKey`
 * (see the .map() below), not array index, so its OWN local state — the
 * "just applied ×N" feedback below — correctly stays with the same
 * logical item even if an earlier item gets removed. Without that
 * feedback, a double-tap (a UI-lag double-press, or forgetting a factor
 * was already applied) silently compounds — exactly the kind of quantity
 * error this control exists to fix, happening to itself.
 */
function EditableItemCard({ item, onChange, onRemove, theme }: {
  item: ReviewItem; onChange: (item: ReviewItem) => void; onRemove: () => void; theme: Theme
}) {
  const [customScale, setCustomScale] = useState('')
  const [lastAppliedFactor, setLastAppliedFactor] = useState<number | null>(null)

  function applyScale(factor: number) {
    onChange(scaleItem(item, factor))
    setLastAppliedFactor(factor)
  }

  function applyCustomScale() {
    const factor = Number.parseFloat(customScale)
    if (Number.isFinite(factor) && factor > 0) {
      applyScale(factor)
      setCustomScale('')
    }
  }

  return (
    <View style={{ marginTop: spacing.md, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <TextInput
          value={item.label}
          onChangeText={(label) => onChange({ ...item, label })}
          style={[type.bodyStrong, { color: theme.text, paddingVertical: 2, flex: 1 }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Remove item" onPress={onRemove} hitSlop={spacing.md}>
          <Ionicons name="close-circle" size={22} color={theme.textFaint} />
        </Pressable>
      </View>
      <TextInput
        value={item.servingLabel ?? ''}
        onChangeText={(text) => onChange({ ...item, servingLabel: text === '' ? null : text })}
        placeholder="Serving, e.g. 1 cup"
        placeholderTextColor={theme.textFaint}
        style={[type.caption, { color: theme.textMuted, paddingVertical: 2 }]}
      />
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <StatField label="Grams" value={item.grams} onChange={(grams) => onChange({ ...item, grams })} theme={theme} />
        <StatField label="Calories" value={item.calories} onChange={(v) => onChange({ ...item, calories: v ?? 0 })} theme={theme} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <StatField label="Protein (g)" value={item.proteinG} onChange={(v) => onChange({ ...item, proteinG: v ?? 0 })} theme={theme} />
        <StatField label="Carbs (g)" value={item.carbsG} onChange={(v) => onChange({ ...item, carbsG: v ?? 0 })} theme={theme} />
        <StatField label="Fat (g)" value={item.fatG} onChange={(v) => onChange({ ...item, fatG: v ?? 0 })} theme={theme} />
      </View>
      <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.md, marginBottom: spacing.xs }]}>
        Actually more or less than this? Scale everything at once.
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', alignItems: 'center' }}>
        {QUICK_SCALE_FACTORS.map((factor) => (
          <Pressable
            key={factor}
            accessibilityRole="button"
            onPress={() => applyScale(factor)}
            style={{
              paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill,
              borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceRaised,
            }}
          >
            <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>×{factor}</Text>
          </Pressable>
        ))}
        <TextInput
          value={customScale}
          onChangeText={setCustomScale}
          onSubmitEditing={applyCustomScale}
          placeholder="Custom ×"
          placeholderTextColor={theme.textFaint}
          keyboardType="decimal-pad"
          style={{
            width: 80, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill,
            borderWidth: 1, borderColor: theme.border, color: theme.text, fontSize: 13,
          }}
        />
        <Pressable accessibilityRole="button" onPress={applyCustomScale} hitSlop={spacing.sm}>
          <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Apply</Text>
        </Pressable>
      </View>
      {lastAppliedFactor != null ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
          Just scaled ×{lastAppliedFactor}. Only tap again if that's still not right. Repeat taps keep
          multiplying from here, not from the original estimate.
        </Text>
      ) : null}
    </View>
  )
}

export default function CameraScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { mode, template, editMealId } = useLocalSearchParams<{ mode?: string; template?: string; editMealId?: string }>()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  // Which path to start on was already decided by the popup that opened
  // this screen (see lib/addMeal.ts) — no in-screen choice step needed.
  // `template` carries a pre-filled item set as JSON — reused by both "Log
  // a recent meal" and the barcode-scan lookup, both of which land here to
  // reuse the exact same editable review screen rather than duplicating it.
  // `editMealId` (from a past-day entry on Progress) takes priority over
  // both — it needs an async DB read before there's anything to show, so it
  // starts on 'loading' rather than synchronously picking a phase.
  const [phase, setPhase] = useState<Phase>(() => {
    if (editMealId) return { kind: 'loading' }
    if (template) {
      try {
        const items = JSON.parse(template) as ScanEstimate[]
        if (Array.isArray(items) && items.length > 0) return { kind: 'review', photoUri: null, items: withUiKeys(items), isMock: false }
      } catch (e) {
        console.error('[camera] failed to parse template param', e)
      }
    }
    return mode === 'manual' ? { kind: 'review', photoUri: null, items: [blankReviewItem()], isMock: false } : { kind: 'shooting' }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Carried over when "Take another photo" is chosen from an existing
  // review — the new photo's items get appended to these rather than
  // replacing them, and the original photo (not the new one) stays as the
  // meal's photo, since the second shot is just to catch one more item,
  // not meant to become the meal's reference image.
  const [carryItems, setCarryItems] = useState<ReviewItem[]>([])
  const [carryPhotoUri, setCarryPhotoUri] = useState<string | null>(null)

  useEffect(() => {
    if (!editMealId) return
    let alive = true
    void mealForEdit(Number(editMealId)).then((meal) => {
      if (!alive) return
      if (!meal) {
        Alert.alert("Couldn't find that meal", 'It may have already been removed.')
        cancelReview()
        return
      }
      setPhase({ kind: 'review', photoUri: meal.photoUri, items: withUiKeys(meal.items), isMock: false })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMealId])

  async function capture() {
    setError(null)
    const photo = await cameraRef.current?.takePictureAsync({ base64: true, quality: 0.6 })
    if (!photo) return
    setPhase({ kind: 'analyzing', photoUri: photo.uri })
    try {
      const result = await analyzePhoto(photo.base64 ?? '')
      const items = [...carryItems, ...withUiKeys(result.items)]
      const photoUri = carryPhotoUri ?? photo.uri
      setCarryItems([])
      setCarryPhotoUri(null)
      setPhase({ kind: 'review', photoUri, items, isMock: result.isMock })
    } catch (e) {
      // Without this, a failed analysis (network drop, backend error) left
      // the screen stuck on "Analyzing your meal…" forever with no way out —
      // same stuck-busy-state bug class fixed earlier in onboarding/body.tsx.
      console.error('[camera] analyzePhoto failed', e)
      setError("Couldn't analyze that photo. Try again.")
      setPhase({ kind: 'shooting' })
    }
  }

  async function confirmLog() {
    if (phase.kind !== 'review' || saving) return
    // A zero-item save was previously allowed here, inserting a meal row
    // with nothing under it — invisible to dayTotals()/recentMeals() (both
    // INNER JOIN log_items) but still counted as "a logged day" by
    // loggingStreak() before its own fix, keeping the streak flame alive
    // on a day nothing was actually eaten-logged. The edit path already
    // treats zero items as "delete this entry"; a fresh log has nothing to
    // delete, so it just blocks instead.
    if (!editMealId && phase.items.length === 0) {
      setError('Add at least one item before logging.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editMealId) {
        // Saving an edit down to zero items removes the entry outright
        // rather than leaving an empty meal row behind — same intent as
        // tapping "Delete meal" below, just reached by clearing every item
        // instead of a dedicated action.
        if (phase.items.length === 0) {
          await deleteMealEntry(Number(editMealId))
        } else {
          await updateMeal(Number(editMealId), stripUiKeys(phase.items))
        }
        // Back to the day-detail screen that opened this edit, not the
        // tab root — unlike a fresh log, editing didn't start from the tab bar.
        cancelReview()
      } else {
        const now = Date.now()
        await logMeal(phase.photoUri, stripUiKeys(phase.items), now)
        void cancelReminderFor(localDateFrom(now))
        router.replace('/(tabs)')
      }
    } catch (e) {
      console.error('[camera] save failed', e)
      setError("Couldn't save this meal. Try again.")
      setSaving(false)
    }
  }

  function promptDeleteMeal() {
    if (!editMealId) return
    Alert.alert('Delete this meal?', "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMealEntry(Number(editMealId))
            cancelReview()
          } catch (e) {
            console.error('[camera] deleteMealEntry failed', e)
            Alert.alert('Delete failed', 'Try again.')
          }
        },
      },
    ])
  }

  function updateItem(index: number, next: ReviewItem) {
    if (phase.kind !== 'review') return
    setPhase({ ...phase, items: phase.items.map((it, i) => (i === index ? next : it)) })
  }

  function removeItem(index: number) {
    if (phase.kind !== 'review') return
    setPhase({ ...phase, items: phase.items.filter((_, i) => i !== index) })
  }

  function addBlankItem() {
    if (phase.kind !== 'review') return
    setPhase({ ...phase, items: [...phase.items, blankReviewItem()] })
  }

  function addAnotherPhoto() {
    if (phase.kind !== 'review') return
    setCarryItems(phase.items)
    setCarryPhotoUri(phase.photoUri)
    setPhase({ kind: 'shooting' })
  }

  // The review screen (including manual entry, which skips 'shooting'
  // entirely) had no exit besides confirming the log — this screen is a
  // fullScreenModal, so the usual iOS swipe-to-dismiss gesture isn't
  // available either. canGoBack() covers the normal case (pushed from the
  // tab bar's "+" or Today's Add Meal); the fallback covers reaching here
  // via a replace() (e.g. from "Log a recent meal"), where there's nothing
  // left behind this screen to go back to.
  function cancelReview() {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(tabs)')
    }
  }

  function promptAddItem() {
    Alert.alert('Add another item', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log manually', onPress: addBlankItem },
      { text: 'Take another photo', onPress: addAnotherPhoto },
    ])
  }

  if (phase.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <ActivityIndicator color={theme.text} size="large" />
        <Text style={[type.body, { color: theme.textMuted }]}>Loading…</Text>
      </View>
    )
  }

  if (phase.kind === 'shooting' && !permission) return <View style={{ flex: 1, backgroundColor: theme.bg }} />

  if (phase.kind === 'shooting' && !permission?.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <Text style={[type.body, { color: theme.text, textAlign: 'center', marginBottom: spacing.lg }]}>
          Weight Cut AI needs camera access to scan meals.
        </Text>
        <Pressable
          onPress={requestPermission}
          style={{ height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Allow camera</Text>
        </Pressable>
      </View>
    )
  }

  if (phase.kind === 'shooting') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
        <View style={{ position: 'absolute', top: insets.top + spacing.md, left: spacing.lg }}>
          <Pressable onPress={() => router.back()} hitSlop={spacing.md}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Cancel</Text>
          </Pressable>
        </View>
        {error ? (
          <View style={{ position: 'absolute', top: insets.top + spacing.md, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: '#fff', fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}
        <View style={{ position: 'absolute', bottom: Math.max(insets.bottom, spacing.xl) + spacing.lg, alignSelf: 'center' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={capture}
            style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff', borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)' }}
          />
        </View>
      </View>
    )
  }

  if (phase.kind === 'analyzing') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
        <ActivityIndicator color={theme.text} size="large" />
        <Text style={[type.body, { color: theme.textMuted }]}>Analyzing your meal…</Text>
      </View>
    )
  }

  const totalKcal = phase.items.reduce((s, i) => s + i.calories, 0)

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, padding: spacing.lg, paddingBottom: 140 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
        <Pressable accessibilityRole="button" onPress={cancelReview} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
        {editMealId ? (
          <Pressable accessibilityRole="button" onPress={promptDeleteMeal} hitSlop={spacing.md}>
            <Text style={[type.body, { color: theme.danger }]}>Delete meal</Text>
          </Pressable>
        ) : null}
      </View>
      {editMealId ? (
        <Text style={[type.caption, { color: theme.textFaint, marginBottom: 2 }]}>Editing a past entry</Text>
      ) : null}
      <Text style={[type.title, { color: theme.text }]}>{Math.round(totalKcal)} kcal</Text>
      {phase.isMock ? (
        <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md }}>
          <Text style={[type.caption, { color: theme.textMuted }]}>
            Backend isn't connected yet. This is a placeholder estimate, not a real AI analysis.
          </Text>
        </View>
      ) : null}
      <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.md }]}>
        {phase.photoUri != null
          ? 'Ate less than this, or the AI got something wrong? Tap any number below to fix it.'
          : 'Fill in what you ate below.'}
      </Text>
      {phase.items.length === 0 ? (
        <View style={{ marginTop: spacing.md, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.body, { color: theme.textMuted, lineHeight: 20 }]}>
            {phase.photoUri != null ? 'Nothing recognized in this photo. Add it yourself instead.' : 'Tap "+ Add an item" to get started.'}
          </Text>
        </View>
      ) : null}
      {phase.items.map((item, i) => (
        <EditableItemCard key={item.uiKey} item={item} onChange={(next) => updateItem(i, next)} onRemove={() => removeItem(i)} theme={theme} />
      ))}
      <Pressable accessibilityRole="button" onPress={promptAddItem} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
        <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>+ Add an item</Text>
      </Pressable>
      {error ? (
        <Text style={[type.caption, { color: theme.danger, textAlign: 'center', marginTop: spacing.lg }]}>{error}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={confirmLog}
        style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl }}
      >
        <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>{editMealId ? 'Save changes' : 'Log this meal'}</Text>
      </Pressable>
    </ScrollView>
  )
}
