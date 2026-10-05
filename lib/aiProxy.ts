import Constants from 'expo-constants'
import type { ScanEstimate } from './repo'
import { supabase, supabaseConfigured } from './supabaseClient'

/**
 * Calls the backend's AI vision proxy (see ../backend/supabase/functions/
 * analyze-photo) rather than an AI provider directly — unlike nut-ai (which
 * is free/BYOK, each user's own API key), this app is a paid subscription,
 * so the business's own AI credentials have to live server-side, metered
 * per user. The app never holds an AI provider key at all.
 *
 * Falls back to a clearly-labeled mock estimate when the backend isn't
 * configured yet (no Supabase project exists until the user sets one up —
 * see backend/README.md), the user isn't signed in yet (analyze-photo
 * authenticates the caller via their session token — there's no meaningful
 * call to make without one), or the call isn't reachable, so the scan flow
 * is fully demoable before any of that is true.
 */

const API_BASE = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ?? ''

/**
 * `servingLabel` is required (not optional) on `ScanEstimate`, but nothing
 * validates the AI response actually included it — both system prompts ask
 * for it, but a prompt is an instruction, not a guarantee, and one of the
 * two prompts here was found to have never asked for it at all until this
 * fix. A missing key comes back as `undefined`, which isn't a legal SQLite
 * bind value — `logMeal()`/`updateMeal()` would throw the moment a user
 * tried to save an item that slipped through with a missing label. Coerced
 * to `null` once, here, rather than trusting every call site downstream to
 * remember the AI's JSON isn't actually type-checked.
 */
function normalizeItems(items: ScanEstimate[]): ScanEstimate[] {
  return items.map((item) => ({ ...item, servingLabel: typeof item.servingLabel === 'string' ? item.servingLabel : null }))
}

export interface AnalyzePhotoResult {
  items: ScanEstimate[]
  isMock: boolean
}

export async function analyzePhoto(base64Jpeg: string): Promise<AnalyzePhotoResult> {
  if (!API_BASE || !supabaseConfigured || !supabase) return mockEstimate()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return mockEstimate()

  try {
    const res = await fetch(`${API_BASE}/functions/v1/analyze-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ imageBase64: base64Jpeg, intent: 'log' }),
    })
    if (!res.ok) return mockEstimate()
    const data = (await res.json()) as { items: ScanEstimate[] }
    return { items: normalizeItems(data.items), isMock: false }
  } catch {
    return mockEstimate()
  }
}

function mockEstimate(): AnalyzePhotoResult {
  return {
    isMock: true,
    items: [
      { label: 'Estimated meal (backend not connected yet)', servingLabel: null, grams: 250, calories: 450, proteinG: 30, carbsG: 45, fatG: 15 },
    ],
  }
}

export interface MealSuggestion {
  title: string
  items: ScanEstimate[]
}

export interface SuggestMealsResult {
  suggestions: MealSuggestion[]
  isMock: boolean
}

/**
 * A photo of raw/uncooked ingredients (a fridge, a pantry, groceries) plus
 * whatever's left of today's calorie/macro budget -> a handful of meal
 * ideas built from what's actually visible. Reuses the exact same backend
 * function as analyzePhoto (same entitlement gate, same daily cap, same
 * cost logging) with `intent: 'suggest'` — see backend/supabase/functions/
 * analyze-photo/index.ts for why this isn't a separate endpoint.
 */
export async function suggestMeals(
  base64Jpeg: string,
  remaining: { kcal: number; proteinG: number; carbsG: number; fatG: number },
): Promise<SuggestMealsResult> {
  if (!API_BASE || !supabaseConfigured || !supabase) return { suggestions: [], isMock: true }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { suggestions: [], isMock: true }

  try {
    const res = await fetch(`${API_BASE}/functions/v1/analyze-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        imageBase64: base64Jpeg,
        intent: 'suggest',
        remainingKcal: remaining.kcal,
        remainingProteinG: remaining.proteinG,
        remainingCarbsG: remaining.carbsG,
        remainingFatG: remaining.fatG,
      }),
    })
    if (!res.ok) return { suggestions: [], isMock: false }
    const data = (await res.json()) as { suggestions: MealSuggestion[] }
    const suggestions = (data.suggestions ?? []).map((s) => ({ ...s, items: normalizeItems(s.items) }))
    return { suggestions, isMock: false }
  } catch (e) {
    console.error('[aiProxy] suggestMeals failed', e)
    return { suggestions: [], isMock: false }
  }
}

export interface MealPlanDay {
  day: number
  meals: MealSuggestion[]
}

export interface GenerateMealPlanResult {
  days: MealPlanDay[]
  isMock: boolean
}

/**
 * A 7-day meal plan built from the fighter's own daily calorie/macro
 * target -- no photo involved, same backend function as analyzePhoto/
 * suggestMeals (same entitlement gate, same cost logging, its own daily
 * cap) with `intent: 'meal-plan'`. `previousFeedback` (if given) is what
 * turns "Regenerate" into an actual refinement instead of just another
 * random roll -- fed straight into the prompt.
 */
export async function generateMealPlan(
  target: { kcal: number; proteinG: number; carbsG: number; fatG: number },
  preferences?: { restrictions: string; mealsPerDay: number; notes: string; planDays: number },
  previousFeedback?: string,
): Promise<GenerateMealPlanResult> {
  if (!API_BASE || !supabaseConfigured || !supabase) return { days: [], isMock: true }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { days: [], isMock: true }

  try {
    const res = await fetch(`${API_BASE}/functions/v1/analyze-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        intent: 'meal-plan',
        targetKcal: target.kcal,
        targetProteinG: target.proteinG,
        targetCarbsG: target.carbsG,
        targetFatG: target.fatG,
        planDays: preferences?.planDays,
        mealsPerDay: preferences?.mealsPerDay,
        restrictions: preferences?.restrictions,
        notes: preferences?.notes,
        previousFeedback,
      }),
    })
    if (!res.ok) return { days: [], isMock: false }
    const data = (await res.json()) as { days: MealPlanDay[] }
    const days = (data.days ?? []).map((d) => ({ ...d, meals: d.meals.map((m) => ({ ...m, items: normalizeItems(m.items) })) }))
    return { days, isMock: false }
  } catch (e) {
    console.error('[aiProxy] generateMealPlan failed', e)
    return { days: [], isMock: false }
  }
}
