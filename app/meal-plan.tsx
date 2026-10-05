import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NumberField } from '../lib/components/NumberField'
import { generateMealPlan, type MealPlanDay, type MealSuggestion } from '../lib/aiProxy'
import {
  currentFightGoal, loadMealPlan, loadMealPlanPreferences, saveMealPlan, saveMealPlanFeedback,
  saveMealPlanPreferences, updateMealPlanDays, type MealPlanPreferences, type ScanEstimate,
} from '../lib/repo'
import { radius, spacing, type, useTheme } from '../lib/theme'

const PLAN_DAY_OPTIONS = [5, 7, 30]

function dayTotals(day: MealPlanDay): { kcal: number; proteinG: number; carbsG: number; fatG: number } {
  let kcal = 0, proteinG = 0, carbsG = 0, fatG = 0
  for (const meal of day.meals) {
    for (const item of meal.items) {
      kcal += item.calories
      proteinG += item.proteinG
      carbsG += item.carbsG
      fatG += item.fatG
    }
  }
  return { kcal, proteinG, carbsG, fatG }
}

function mealKcal(meal: MealSuggestion): number {
  return meal.items.reduce((s, i) => s + i.calories, 0)
}

const inputStyle = (theme: ReturnType<typeof useTheme>) => ({
  backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
  padding: spacing.md, color: theme.text, minHeight: 44,
})

type EditableItem = { label: string; servingLabel: string; calories: string; proteinG: string; carbsG: string; fatG: string }

function itemToEditable(item: ScanEstimate): EditableItem {
  return {
    label: item.label,
    servingLabel: item.servingLabel ?? '',
    calories: String(Math.round(item.calories)),
    proteinG: String(Math.round(item.proteinG)),
    carbsG: String(Math.round(item.carbsG)),
    fatG: String(Math.round(item.fatG)),
  }
}

function editableToItem(e: EditableItem): ScanEstimate {
  return {
    label: e.label.trim() || 'Untitled item',
    servingLabel: e.servingLabel.trim() || null,
    grams: null,
    calories: Number.parseFloat(e.calories) || 0,
    proteinG: Number.parseFloat(e.proteinG) || 0,
    carbsG: Number.parseFloat(e.carbsG) || 0,
    fatG: Number.parseFloat(e.fatG) || 0,
  }
}

/**
 * Tap-to-edit for one meal's title and items -- add/remove items inline,
 * every macro field editable. Shown in place of the plan view (same
 * in-screen toggle pattern as the preferences form) rather than a
 * separate route, since passing a whole meal's nested item list through
 * router params would mean serializing it into the URL for no real benefit.
 */
function MealEditor({
  title: initialTitle, items: initialItems, onSave, onCancel, theme,
}: {
  title: string
  items: ScanEstimate[]
  onSave: (meal: MealSuggestion) => void
  onCancel: () => void
  theme: ReturnType<typeof useTheme>
}) {
  const [title, setTitle] = useState(initialTitle)
  const [items, setItems] = useState<EditableItem[]>(initialItems.length > 0 ? initialItems.map(itemToEditable) : [itemToEditable({
    label: '', servingLabel: null, grams: null, calories: 0, proteinG: 0, carbsG: 0, fatG: 0,
  })])

  function updateItem(index: number, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function save() {
    const cleanItems = items.filter((it) => it.label.trim().length > 0)
    if (cleanItems.length === 0) {
      Alert.alert('Add at least one item', 'A meal needs at least one food item with a name.')
      return
    }
    onSave({ title: title.trim() || 'Untitled meal', items: cleanItems.map(editableToItem) })
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 140 }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={[type.label, { color: theme.textMuted }]}>Meal name</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Grilled chicken and rice" placeholderTextColor={theme.textFaint} style={inputStyle(theme)} />
      </View>

      {items.map((item, i) => (
        <View key={i} style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TextInput
              value={item.label}
              onChangeText={(v) => updateItem(i, { label: v })}
              placeholder="Food item"
              placeholderTextColor={theme.textFaint}
              style={[inputStyle(theme), { flex: 1 }]}
            />
            {items.length > 1 ? (
              <Pressable accessibilityRole="button" onPress={() => removeItem(i)} hitSlop={spacing.sm}>
                <Text style={[type.caption, { color: theme.danger }]}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <TextInput
            value={item.servingLabel}
            onChangeText={(v) => updateItem(i, { servingLabel: v })}
            placeholder="Serving, e.g. 1 cup"
            placeholderTextColor={theme.textFaint}
            style={inputStyle(theme)}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <NumberField label="" unit="cal" value={item.calories} onChange={(v) => updateItem(i, { calories: v })} placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <NumberField label="" unit="g protein" value={item.proteinG} onChange={(v) => updateItem(i, { proteinG: v })} placeholder="0" />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: -spacing.md }}>
            <View style={{ flex: 1 }}>
              <NumberField label="" unit="g carbs" value={item.carbsG} onChange={(v) => updateItem(i, { carbsG: v })} placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <NumberField label="" unit="g fat" value={item.fatG} onChange={(v) => updateItem(i, { fatG: v })} placeholder="0" />
            </View>
          </View>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => setItems((prev) => [...prev, itemToEditable({ label: '', servingLabel: null, grams: null, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })])}
        style={{ height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[type.bodyStrong, { color: theme.text }]}>+ Add item</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={save}
        style={{ marginTop: spacing.sm, height: 52, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Save meal</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onCancel}>
        <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center' }]}>Cancel</Text>
      </Pressable>
    </ScrollView>
  )
}

function MealCard({
  meal, onEdit, onRemove, onMove, theme,
}: {
  meal: MealSuggestion
  onEdit: () => void
  onRemove: () => void
  onMove: () => void
  theme: ReturnType<typeof useTheme>
}) {
  return (
    <Pressable onPress={onEdit} style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[type.bodyStrong, { color: theme.text, flex: 1 }]}>{meal.title}</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>{Math.round(mealKcal(meal))} cal</Text>
      </View>
      {meal.items.map((item, i) => (
        <Text key={i} style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          {item.servingLabel ? `${item.servingLabel} ${item.label}` : item.label}
        </Text>
      ))}
      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
        <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={spacing.sm}>
          <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Edit</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onMove} hitSlop={spacing.sm}>
          <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Move</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onRemove} hitSlop={spacing.sm}>
          <Text style={[type.caption, { color: theme.danger, fontWeight: '700' }]}>Remove</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

/**
 * Nutrition / Meal Plan -- per Jean directly, prompted by a fighter he
 * trains with using ChatGPT for the same thing. Fixed for the chosen
 * length rather than auto-regenerating: a plan that changes under
 * someone mid-week isn't useful for actually planning meals, so it only
 * changes when explicitly asked (regenerate, or a direct edit here).
 *
 * Editing is real, not a read-only printout of AI output (Jean's own
 * words: "the current interface is too robotic"): tap a meal to edit its
 * name/items, add a meal to any day, remove one, or move one to a
 * different day. All of it is a local edit (updateMealPlanDays), no AI
 * call involved -- only Regenerate touches the model.
 */
export default function MealPlan() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<MealPlanDay[] | null>(null)
  const [generatedAtMs, setGeneratedAtMs] = useState<number | null>(null)
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<MealPlanPreferences | null>(null)
  const [editingPreferences, setEditingPreferences] = useState(false)
  const [restrictions, setRestrictions] = useState('')
  const [mealsPerDay, setMealsPerDay] = useState('3')
  const [notes, setNotes] = useState('')
  const [planDays, setPlanDays] = useState(7)
  const [feedbackDraft, setFeedbackDraft] = useState('')
  const [feedbackJustSaved, setFeedbackJustSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingMeal, setEditingMeal] = useState<{ dayIndex: number; mealIndex: number | null } | null>(null)
  const [movingMeal, setMovingMeal] = useState<{ dayIndex: number; mealIndex: number } | null>(null)

  useEffect(() => {
    void Promise.all([loadMealPlan(), loadMealPlanPreferences()]).then(([plan, prefs]) => {
      if (plan) {
        setDays(plan.days as MealPlanDay[])
        setGeneratedAtMs(plan.generatedAtMs)
        setSavedFeedback(plan.feedback)
        setFeedbackDraft(plan.feedback ?? '')
      }
      if (prefs) {
        setPreferences(prefs)
        setRestrictions(prefs.restrictions)
        setMealsPerDay(String(prefs.mealsPerDay))
        setNotes(prefs.notes)
        setPlanDays(prefs.planDays)
      } else {
        setEditingPreferences(true)
      }
      setLoading(false)
    })
  }, [])

  async function generate(prefs: MealPlanPreferences, feedback?: string) {
    setGenerating(true)
    setError(null)
    const goal = await currentFightGoal()
    if (!goal) {
      setError('Set up your fight goal first, on the Today tab, before generating a plan.')
      setGenerating(false)
      return
    }
    const result = await generateMealPlan(
      { kcal: goal.targetKcal, proteinG: goal.proteinG, carbsG: goal.carbsG, fatG: goal.fatG },
      prefs,
      feedback,
    )
    if (result.days.length === 0) {
      setError("Couldn't generate a plan. Try again.")
      setGenerating(false)
      return
    }
    const now = Date.now()
    await saveMealPlan(result.days, now)
    setDays(result.days)
    setGeneratedAtMs(now)
    setSavedFeedback(null)
    setFeedbackDraft('')
    setFeedbackJustSaved(false)
    setGenerating(false)
  }

  async function savePreferences(thenGenerate: boolean) {
    const prefs: MealPlanPreferences = {
      restrictions: restrictions.trim(),
      mealsPerDay: Number.parseInt(mealsPerDay, 10) || 3,
      notes: notes.trim(),
      planDays,
    }
    await saveMealPlanPreferences(prefs)
    setPreferences(prefs)
    setEditingPreferences(false)
    if (thenGenerate) await generate(prefs)
  }

  async function saveFeedback() {
    await saveMealPlanFeedback(feedbackDraft.trim())
    setSavedFeedback(feedbackDraft.trim())
    setFeedbackJustSaved(true)
  }

  async function persistEdit(next: MealPlanDay[]) {
    setDays(next)
    await updateMealPlanDays(next)
  }

  function confirmRemoveMeal(dayIndex: number, mealIndex: number) {
    Alert.alert('Remove this meal?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          if (!days) return
          const next = days.map((d, i) => (i === dayIndex ? { ...d, meals: d.meals.filter((_, mi) => mi !== mealIndex) } : d))
          void persistEdit(next)
        },
      },
    ])
  }

  function moveMealTo(dayIndex: number, mealIndex: number, targetDayIndex: number) {
    if (!days || targetDayIndex === dayIndex) {
      setMovingMeal(null)
      return
    }
    const meal = days[dayIndex]!.meals[mealIndex]!
    const next = days.map((d, i) => {
      if (i === dayIndex) return { ...d, meals: d.meals.filter((_, mi) => mi !== mealIndex) }
      if (i === targetDayIndex) return { ...d, meals: [...d.meals, meal] }
      return d
    })
    setMovingMeal(null)
    void persistEdit(next)
  }

  function saveMealEdit(meal: MealSuggestion) {
    if (!days || !editingMeal) return
    const { dayIndex, mealIndex } = editingMeal
    const next = days.map((d, i) => {
      if (i !== dayIndex) return d
      if (mealIndex === null) return { ...d, meals: [...d.meals, meal] }
      return { ...d, meals: d.meals.map((m, mi) => (mi === mealIndex ? meal : m)) }
    })
    setEditingMeal(null)
    void persistEdit(next)
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    )
  }

  if (editingMeal && days) {
    const existing = editingMeal.mealIndex !== null ? days[editingMeal.dayIndex]!.meals[editingMeal.mealIndex] : null
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
          <Text style={[type.title, { color: theme.text }]}>{existing ? 'Edit meal' : 'Add meal'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setEditingMeal(null)} hitSlop={spacing.md}>
            <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
          </Pressable>
        </View>
        <MealEditor
          title={existing?.title ?? ''}
          items={existing?.items ?? []}
          onSave={saveMealEdit}
          onCancel={() => setEditingMeal(null)}
          theme={theme}
        />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Nutrition / Meal Plan</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      {editingPreferences ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 140 }}>
          <Text style={[type.caption, { color: theme.textFaint }]}>
            A couple quick questions so your plan actually fits you. You can change these anytime.
          </Text>

          <View style={{ gap: spacing.xs }}>
            <Text style={[type.label, { color: theme.textMuted }]}>Plan length</Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {PLAN_DAY_OPTIONS.map((d) => (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  onPress={() => setPlanDays(d)}
                  style={{
                    flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: planDays === d ? theme.primary : theme.border,
                    backgroundColor: planDays === d ? theme.primary : 'transparent',
                  }}
                >
                  <Text style={[type.bodyStrong, { color: planDays === d ? theme.onPrimary : theme.text }]}>{d} days</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text style={[type.label, { color: theme.textMuted }]}>Dietary restrictions or allergies</Text>
            <TextInput
              value={restrictions}
              onChangeText={setRestrictions}
              placeholder="e.g. vegetarian, no shellfish, lactose intolerant"
              placeholderTextColor={theme.textFaint}
              multiline
              style={[inputStyle(theme), { minHeight: 70, textAlignVertical: 'top' }]}
            />
          </View>

          <NumberField label="Meals per day" unit="" value={mealsPerDay} onChange={setMealsPerDay} placeholder="3" />

          <View style={{ gap: spacing.xs }}>
            <Text style={[type.label, { color: theme.textMuted }]}>Anything else?</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. not much time to cook, keep it cheap, I like spicy food"
              placeholderTextColor={theme.textFaint}
              multiline
              style={[inputStyle(theme), { minHeight: 70, textAlignVertical: 'top' }]}
            />
          </View>

          {error ? (
            <View style={{ backgroundColor: theme.danger + '22', borderRadius: radius.md, padding: spacing.md }}>
              <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={generating}
            onPress={() => savePreferences(preferences === null)}
            style={{
              marginTop: spacing.sm, height: 52, borderRadius: radius.pill, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
            }}
          >
            {generating ? <ActivityIndicator color={theme.onPrimary} /> : null}
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>
              {generating ? 'Generating…' : preferences === null ? 'Save and generate plan' : 'Save'}
            </Text>
          </Pressable>

          {preferences !== null ? (
            <Pressable accessibilityRole="button" onPress={() => setEditingPreferences(false)}>
              <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center' }]}>Cancel</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[type.caption, { color: theme.textFaint, flex: 1 }]}>
              {preferences?.planDays ?? 7} days, built from your daily calorie and macro target.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setEditingPreferences(true)}>
              <Text style={[type.caption, { color: theme.primary, fontWeight: '700' }]}>Edit preferences</Text>
            </Pressable>
          </View>

          {error ? (
            <View style={{ backgroundColor: theme.danger + '22', borderRadius: radius.md, padding: spacing.md }}>
              <Text style={[type.caption, { color: theme.danger }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={generating}
            onPress={() => preferences && generate(preferences, savedFeedback ?? undefined)}
            style={{
              height: 52, borderRadius: radius.pill, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm,
            }}
          >
            {generating ? <ActivityIndicator color={theme.onPrimary} /> : null}
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>
              {generating ? 'Generating…' : days ? 'Regenerate plan' : 'Generate plan'}
            </Text>
          </Pressable>

          {generatedAtMs ? (
            <Text style={[type.caption, { color: theme.textFaint }]}>
              Generated {new Date(generatedAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </Text>
          ) : null}

          {days
            ? days.map((day, dayIndex) => {
                const totals = dayTotals(day)
                return (
                  <View key={day.day} style={{ gap: spacing.sm }}>
                    <View style={{ marginTop: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Text style={[type.heading, { color: theme.text }]}>Day {day.day}</Text>
                        <Text style={[type.caption, { color: theme.textMuted }]}>{Math.round(totals.kcal)} cal</Text>
                      </View>
                      <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>
                        {Math.round(totals.proteinG)}g protein · {Math.round(totals.carbsG)}g carbs · {Math.round(totals.fatG)}g fat
                      </Text>
                    </View>

                    {day.meals.map((meal, mealIndex) => (
                      <View key={mealIndex}>
                        <MealCard
                          meal={meal}
                          theme={theme}
                          onEdit={() => setEditingMeal({ dayIndex, mealIndex })}
                          onRemove={() => confirmRemoveMeal(dayIndex, mealIndex)}
                          onMove={() => setMovingMeal(movingMeal?.dayIndex === dayIndex && movingMeal.mealIndex === mealIndex ? null : { dayIndex, mealIndex })}
                        />
                        {movingMeal?.dayIndex === dayIndex && movingMeal.mealIndex === mealIndex ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
                            {days.map((_, targetIndex) => (
                              <Pressable
                                key={targetIndex}
                                accessibilityRole="button"
                                disabled={targetIndex === dayIndex}
                                onPress={() => moveMealTo(dayIndex, mealIndex, targetIndex)}
                                style={{
                                  height: 36, minWidth: 36, paddingHorizontal: spacing.sm, borderRadius: radius.pill, marginRight: spacing.xs,
                                  alignItems: 'center', justifyContent: 'center',
                                  backgroundColor: targetIndex === dayIndex ? theme.border : theme.surfaceRaised,
                                  opacity: targetIndex === dayIndex ? 0.5 : 1,
                                }}
                              >
                                <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>{targetIndex + 1}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        ) : null}
                      </View>
                    ))}

                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setEditingMeal({ dayIndex, mealIndex: null })}
                      style={{ height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={[type.caption, { color: theme.text, fontWeight: '700' }]}>+ Add meal</Text>
                    </Pressable>
                  </View>
                )
              })
            : !generating ? (
                <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl }]}>
                  No plan yet. Generate one to get a full plan built around your target.
                </Text>
              ) : null}

          {days ? (
            <View style={{ marginTop: spacing.lg, gap: spacing.xs }}>
              <Text style={[type.label, { color: theme.textMuted }]}>What would you change?</Text>
              <TextInput
                value={feedbackDraft}
                onChangeText={(v) => {
                  setFeedbackDraft(v)
                  setFeedbackJustSaved(false)
                }}
                placeholder="e.g. too much rice, more variety, less red meat"
                placeholderTextColor={theme.textFaint}
                multiline
                style={[inputStyle(theme), { minHeight: 60, textAlignVertical: 'top' }]}
              />
              <Pressable
                accessibilityRole="button"
                onPress={saveFeedback}
                style={{
                  marginTop: spacing.xs, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={[type.bodyStrong, { color: theme.text }]}>Save feedback</Text>
              </Pressable>
              {feedbackJustSaved ? (
                <Text style={[type.caption, { color: theme.textMuted, textAlign: 'center' }]}>
                  Saved. Tap Regenerate to build a new plan with this in mind.
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  )
}
