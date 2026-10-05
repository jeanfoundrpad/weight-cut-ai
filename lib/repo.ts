import { recalibrateTarget, type AdaptiveRecalibration } from './adaptiveTarget'
import { ageFromBirthDate } from './dateMath'
import { getDb } from './db'
import {
  KCAL_PER_POUND,
  dailyTargetForRate,
  macroSplit,
  requiredWeeklyRate,
  restingEnergy,
  safeMinimumKcal,
  totalEnergyExpenditure,
  type ActivityLevel,
  type BiologicalSex,
} from './weightCutMath'

export type { AdaptiveRecalibration }

export { ageFromBirthDate }

export function localDateFrom(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Inverse of localDateFrom: the last local-time instant of that calendar day. */
export function endOfLocalDateMs(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime()
}

export interface Profile {
  sex: BiologicalSex
  weightKg: number
  heightCm: number
  birthDateMs: number
  activityLevel: ActivityLevel
  units: 'imperial' | 'metric'
}

export async function saveProfile(p: Profile, now: number): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    `INSERT OR REPLACE INTO profile (id, sex, weight_kg, height_cm, birth_date, activity_level, units, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    [p.sex, p.weightKg, p.heightCm, p.birthDateMs, p.activityLevel, p.units, now],
  )
}

export async function loadProfile(): Promise<Profile | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{
    sex: string; weight_kg: number; height_cm: number; birth_date: number
    activity_level: string; units: string
  }>('SELECT sex, weight_kg, height_cm, birth_date, activity_level, units FROM profile WHERE id = 1')
  if (!row) return null
  return {
    sex: row.sex as BiologicalSex,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    birthDateMs: row.birth_date,
    activityLevel: row.activity_level as ActivityLevel,
    units: row.units as 'imperial' | 'metric',
  }
}

/**
 * The plan's day/meal shape lives in lib/aiProxy.ts (MealPlanDay), not
 * here -- aiProxy.ts already imports ScanEstimate from this file, so
 * importing its types back would be a cycle. `days` is typed `unknown`
 * at this layer on purpose; the caller (app/meal-plan.tsx) casts it back
 * to MealPlanDay[], the same boundary shape addMeal.ts already trusts
 * ScanEstimate through.
 */
export async function saveMealPlan(days: unknown, now: number): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT OR REPLACE INTO meal_plan (id, generated_at, plan_json) VALUES (1, ?, ?)',
    [now, JSON.stringify(days)],
  )
}

export async function loadMealPlan(): Promise<{ generatedAtMs: number; days: unknown; feedback: string | null } | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ generated_at: number; plan_json: string; feedback: string | null }>(
    'SELECT generated_at, plan_json, feedback FROM meal_plan WHERE id = 1',
  )
  if (!row) return null
  try {
    return { generatedAtMs: row.generated_at, days: JSON.parse(row.plan_json), feedback: row.feedback }
  } catch {
    return null
  }
}

/** Feedback on the CURRENT plan only -- a fresh saveMealPlan() call (a regenerate) starts the new row's feedback at null, same reasoning as the doc comment on the meal_plan table itself. */
export async function saveMealPlanFeedback(feedback: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('UPDATE meal_plan SET feedback = ? WHERE id = 1', [feedback])
}

/**
 * A manual edit (add/remove/move/edit a meal) is not a regenerate -- it
 * must not touch generated_at (still "the day the AI made this plan") or
 * feedback (still waiting to be applied on the next real regenerate).
 * saveMealPlan's INSERT OR REPLACE would silently null out feedback on
 * every edit since it doesn't specify that column; this is the
 * edit-only path that leaves both alone.
 */
export async function updateMealPlanDays(days: unknown): Promise<void> {
  const db = await getDb()
  await db.runAsync('UPDATE meal_plan SET plan_json = ? WHERE id = 1', [JSON.stringify(days)])
}

export interface MealPlanPreferences {
  restrictions: string
  mealsPerDay: number
  notes: string
  planDays: number
}

export async function saveMealPlanPreferences(p: MealPlanPreferences): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT OR REPLACE INTO meal_plan_preferences (id, restrictions, meals_per_day, notes, plan_days) VALUES (1, ?, ?, ?, ?)',
    [p.restrictions, p.mealsPerDay, p.notes, p.planDays],
  )
}

export async function loadMealPlanPreferences(): Promise<MealPlanPreferences | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ restrictions: string | null; meals_per_day: number | null; notes: string | null; plan_days: number | null }>(
    'SELECT restrictions, meals_per_day, notes, plan_days FROM meal_plan_preferences WHERE id = 1',
  )
  if (!row) return null
  return { restrictions: row.restrictions ?? '', mealsPerDay: row.meals_per_day ?? 3, notes: row.notes ?? '', planDays: row.plan_days ?? 7 }
}

/**
 * 'lose' covers the app's original fight-cut use case (target below
 * current weight, deadline-driven); 'gain' is the same math with the
 * subtraction reversed; 'maintain' skips the rate calculation entirely
 * since there's nothing to solve for.
 */
export type GoalType = 'lose' | 'maintain' | 'gain'

export interface FightGoal {
  goalType: GoalType
  weighInTargetKg: number
  weighInDateMs: number
  targetKcal: number
  proteinG: number
  fatG: number
  carbsG: number
  source: 'formula' | 'adaptive'
}

/** Computes and persists a fight goal from the raw inputs, in one step. */
export async function setFightGoal(
  profile: Profile,
  goalType: GoalType,
  weighInTargetKg: number,
  weighInDateMs: number,
  now: number,
): Promise<FightGoal> {
  const ageYears = ageFromBirthDate(profile.birthDateMs, now)
  // 'maintain' goes straight to rate 0 rather than through
  // requiredWeeklyRate — there's nothing to solve for when the target
  // *is* the maintenance point, and a same-day/near-date target shouldn't
  // make maintain fall back to a null-derived 0 for the wrong reason.
  const rate = goalType === 'maintain' ? 0 : requiredWeeklyRate(profile.weightKg, weighInTargetKg, weighInDateMs, now)
  // A rate of 0 (date too close / target not below current) still produces
  // a usable maintenance-level target rather than blocking the save — the
  // screen itself is responsible for warning the user before it gets here.
  const target = dailyTargetForRate(
    { sex: profile.sex, weightKg: profile.weightKg, heightCm: profile.heightCm, ageYears },
    profile.activityLevel,
    rate ?? 0,
  )
  const macros = macroSplit(target.targetKcal, profile.weightKg)

  const goal: FightGoal = {
    goalType,
    weighInTargetKg,
    weighInDateMs,
    targetKcal: target.targetKcal,
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    carbsG: macros.carbsG,
    source: 'formula',
  }

  const db = await getDb()
  await db.runAsync(
    `INSERT INTO fight_goals (effective_from, goal_type, weigh_in_target_kg, weigh_in_date, target_kcal, protein_g, fat_g, carbs_g, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [now, goal.goalType, goal.weighInTargetKg, goal.weighInDateMs, goal.targetKcal, goal.proteinG, goal.fatG, goal.carbsG, goal.source],
  )
  return goal
}

/**
 * Inserts a new fight_goals row carrying a recalibrated target (see
 * recalibrateIfDue below) — same append-only pattern as setFightGoal, so
 * fightGoalAsOf keeps working for past days, and macros are recomputed
 * from the new calorie number rather than scaled, matching how
 * setFightGoal derives them in the first place.
 */
async function applyAdaptiveTarget(goal: FightGoal, newTargetKcal: number, currentWeightKg: number, now: number): Promise<void> {
  const macros = macroSplit(newTargetKcal, currentWeightKg)
  const db = await getDb()
  await db.runAsync(
    `INSERT INTO fight_goals (effective_from, goal_type, weigh_in_target_kg, weigh_in_date, target_kcal, protein_g, fat_g, carbs_g, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'adaptive')`,
    [now, goal.goalType, goal.weighInTargetKg, goal.weighInDateMs, newTargetKcal, macros.proteinG, macros.fatG, macros.carbsG],
  )
}

interface FightGoalRow {
  goal_type: string; weigh_in_target_kg: number; weigh_in_date: number; target_kcal: number
  protein_g: number; fat_g: number; carbs_g: number; source: string
}

function mapFightGoalRow(row: FightGoalRow): FightGoal {
  return {
    goalType: row.goal_type as GoalType,
    weighInTargetKg: row.weigh_in_target_kg,
    weighInDateMs: row.weigh_in_date,
    targetKcal: row.target_kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbsG: row.carbs_g,
    source: row.source === 'adaptive' ? 'adaptive' : 'formula',
  }
}

export async function currentFightGoal(): Promise<FightGoal | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<FightGoalRow>('SELECT * FROM fight_goals ORDER BY effective_from DESC, id DESC LIMIT 1')
  return row ? mapFightGoalRow(row) : null
}

/**
 * The goal that was actually in force as of a given moment, not just
 * whatever's newest right now — for reviewing a past day after the goal
 * has since changed (e.g. cut -> maintain after a fight), so that day's
 * ring/macros compare against the target that was really active then,
 * rather than today's unrelated one.
 */
export async function fightGoalAsOf(dateMs: number): Promise<FightGoal | null> {
  const db = await getDb()
  const row = await db.getFirstAsync<FightGoalRow>(
    'SELECT * FROM fight_goals WHERE effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    [dateMs],
  )
  return row ? mapFightGoalRow(row) : null
}

// Same lookback MacroFactor's own methodology targets for a stable
// estimate (see adaptiveTarget.ts's header comment) — long enough to
// average out noise, short enough to still reflect a fighter's current
// state rather than months-old data.
const RECALIBRATION_WINDOW_DAYS = 14

/**
 * The adaptive-target recalibration pass: pulls the current goal, profile,
 * weight history, and logged-intake window, hands them to
 * recalibrateTarget() (adaptiveTarget.ts) for the actual math, and — only
 * if the result is both confident and a real (>=50 kcal) change — persists
 * it as a new 'adaptive' fight_goals row via applyAdaptiveTarget(). Always
 * returns the computed result regardless of whether anything was written,
 * so a caller can show "here's what changed" or "nothing changed" either
 * way. Returns null only when there's no goal/profile to recalibrate
 * against, or the weigh-in date has already passed.
 */
export async function recalibrateIfDue(now: number): Promise<AdaptiveRecalibration | null> {
  const [goal, profile] = await Promise.all([currentFightGoal(), loadProfile()])
  if (!goal || !profile) return null

  const points = await weightHistory()
  const latestWeightKg = points[points.length - 1]?.weightKg ?? profile.weightKg
  const ageYears = ageFromBirthDate(profile.birthDateMs, now)
  const restingKcal = restingEnergy({ sex: profile.sex, weightKg: latestWeightKg, heightCm: profile.heightCm, ageYears })
  const formulaMaintenanceKcal = totalEnergyExpenditure(restingKcal, profile.activityLevel)
  const floorKcal = safeMinimumKcal(profile.sex, restingKcal)

  const rate = goal.goalType === 'maintain' ? 0 : requiredWeeklyRate(latestWeightKg, goal.weighInTargetKg, goal.weighInDateMs, now)
  if (rate == null) return null
  const requestedDeficitKcal = (rate * KCAL_PER_POUND) / 7

  const endLocalDate = localDateFrom(now)
  const startLocalDate = localDateFrom(now - (RECALIBRATION_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)
  const intakeDays = (await dayPilesInRange(startLocalDate, endLocalDate)).map((d) => ({ localDate: d.localDate, totalKcal: d.totalKcal }))

  const result = recalibrateTarget(points, intakeDays, formulaMaintenanceKcal, requestedDeficitKcal, goal.targetKcal, floorKcal)
  if (result.hasEnoughData && result.isMaterialChange) {
    await applyAdaptiveTarget(goal, result.newTargetKcal, latestWeightKg, now)
  }
  return result
}

export async function logWeight(weightKg: number, now: number): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?, ?, ?)',
    [localDateFrom(now), weightKg, now],
  )
}

export interface WeightPoint {
  localDate: string
  weightKg: number
}

export async function weightHistory(): Promise<WeightPoint[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ local_date: string; weight_kg: number }>(
    'SELECT local_date, weight_kg FROM weight_entries ORDER BY local_date ASC',
  )
  return rows.map((r) => ({ localDate: r.local_date, weightKg: r.weight_kg }))
}

export interface ScanEstimate {
  label: string
  /** Human-readable serving description ("1 cup", "2 tablespoons", "1 medium") — display-only, never used in macro math. Null for older items logged before this field existed. */
  servingLabel: string | null
  grams: number | null
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

/** One transaction: the meal row plus every estimated item under it. */
export async function logMeal(photoUri: string | null, items: ScanEstimate[], now: number): Promise<void> {
  const db = await getDb()
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'INSERT INTO meals (photo_uri, local_date, logged_at, analysis_status) VALUES (?, ?, ?, ?)',
      [photoUri, localDateFrom(now), now, 'complete'],
    )
    const mealId = result.lastInsertRowId
    for (const item of items) {
      await db.runAsync(
        'INSERT INTO log_items (meal_id, label, serving_label, grams, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [mealId, item.label, item.servingLabel, item.grams, item.calories, item.proteinG, item.carbsG, item.fatG],
      )
    }
  })
}

/** Loads an existing meal's photo + items back into ScanEstimate shape, for re-opening the same editable review screen used to log it. */
export async function mealForEdit(mealId: number): Promise<{ photoUri: string | null; items: ScanEstimate[] } | null> {
  const db = await getDb()
  const meal = await db.getFirstAsync<{ photo_uri: string | null }>('SELECT photo_uri FROM meals WHERE id = ?', [mealId])
  if (!meal) return null
  const rows = await db.getAllAsync<{
    label: string; serving_label: string | null; grams: number | null; calories: number; protein_g: number; carbs_g: number; fat_g: number
  }>('SELECT label, serving_label, grams, calories, protein_g, carbs_g, fat_g FROM log_items WHERE meal_id = ? ORDER BY id ASC', [mealId])
  return {
    photoUri: meal.photo_uri,
    items: rows.map((r) => ({
      label: r.label, servingLabel: r.serving_label, grams: r.grams,
      calories: r.calories, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g,
    })),
  }
}

/**
 * Replaces an existing meal's items in place — photo and logged_at/local_date
 * stay put, since editing a past entry corrects what was eaten, not when.
 * Delete-then-reinsert rather than diffing, same reasoning as
 * importAllData's wipe-then-restore: there's no partial-update case here
 * worth the extra complexity, the whole item list is always re-submitted
 * together from the review screen.
 */
export async function updateMeal(mealId: number, items: ScanEstimate[]): Promise<void> {
  const db = await getDb()
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM log_items WHERE meal_id = ?', [mealId])
    for (const item of items) {
      await db.runAsync(
        'INSERT INTO log_items (meal_id, label, serving_label, grams, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [mealId, item.label, item.servingLabel, item.grams, item.calories, item.proteinG, item.carbsG, item.fatG],
      )
    }
  })
}

/** log_items cascade-deletes with the parent meal row (db.ts's own FK constraint), so this is the one statement needed. */
export async function deleteMealEntry(mealId: number): Promise<void> {
  const db = await getDb()
  await db.runAsync('DELETE FROM meals WHERE id = ?', [mealId])
}

export interface DayTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  mealCount: number
}

export async function dayTotals(localDate: string): Promise<DayTotals> {
  const db = await getDb()
  const row = await db.getFirstAsync<{
    kcal: number | null; p: number | null; c: number | null; f: number | null; meals: number | null
  }>(
    `SELECT SUM(li.calories) kcal, SUM(li.protein_g) p, SUM(li.carbs_g) c, SUM(li.fat_g) f,
            COUNT(DISTINCT m.id) meals
     FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.analysis_status = 'complete'`,
    [localDate],
  )
  return {
    calories: row?.kcal ?? 0,
    proteinG: row?.p ?? 0,
    carbsG: row?.c ?? 0,
    fatG: row?.f ?? 0,
    mealCount: row?.meals ?? 0,
  }
}

export interface RangeSummary {
  totalKcal: number
  mealCount: number
}

/** Same shape as dayTotals(), generalized to an inclusive local-date range — the Progress screen's "Last Week"/"Last Month" bucket totals. */
export async function rangeSummary(startLocalDate: string, endLocalDate: string): Promise<RangeSummary> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ kcal: number | null; meals: number | null }>(
    `SELECT SUM(li.calories) kcal, COUNT(DISTINCT m.id) meals
     FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.analysis_status = 'complete' AND m.local_date BETWEEN ? AND ?`,
    [startLocalDate, endLocalDate],
  )
  return { totalKcal: row?.kcal ?? 0, mealCount: row?.meals ?? 0 }
}

export interface DayPile {
  localDate: string
  totalKcal: number
  mealCount: number
}

/** One row per day within the range that actually has logged meals — what "Last Week"/"Last Month" expand into when tapped. */
export async function dayPilesInRange(startLocalDate: string, endLocalDate: string): Promise<DayPile[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ local_date: string; kcal: number; meals: number }>(
    `SELECT m.local_date, SUM(li.calories) kcal, COUNT(DISTINCT m.id) meals
     FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.analysis_status = 'complete' AND m.local_date BETWEEN ? AND ?
     GROUP BY m.local_date
     ORDER BY m.local_date DESC`,
    [startLocalDate, endLocalDate],
  )
  return rows.map((r) => ({ localDate: r.local_date, totalKcal: r.kcal, mealCount: r.meals }))
}

export interface MealSummary {
  id: number
  photoUri: string | null
  loggedAt: number
  title: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

/** Today-screen "Recently logged" list — individual meals, not just the day's aggregate totals. */
export async function recentMeals(localDate: string, limit = 10): Promise<MealSummary[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{
    meal_id: number; photo_uri: string | null; logged_at: number
    label: string; calories: number; protein_g: number; carbs_g: number; fat_g: number
  }>(
    `SELECT m.id as meal_id, m.photo_uri, m.logged_at, li.label, li.calories, li.protein_g, li.carbs_g, li.fat_g
     FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.local_date = ? AND m.analysis_status = 'complete'
     ORDER BY m.logged_at DESC, li.id ASC`,
    [localDate],
  )

  const order: number[] = []
  const byMeal = new Map<
    number,
    { photoUri: string | null; loggedAt: number; labels: string[]; calories: number; proteinG: number; carbsG: number; fatG: number }
  >()
  for (const r of rows) {
    let m = byMeal.get(r.meal_id)
    if (!m) {
      m = { photoUri: r.photo_uri, loggedAt: r.logged_at, labels: [], calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
      byMeal.set(r.meal_id, m)
      order.push(r.meal_id)
    }
    m.labels.push(r.label)
    m.calories += r.calories
    m.proteinG += r.protein_g
    m.carbsG += r.carbs_g
    m.fatG += r.fat_g
  }

  return order.slice(0, limit).map((id) => {
    const m = byMeal.get(id)!
    const title = m.labels.length > 1 ? `${m.labels[0]} +${m.labels.length - 1} more` : m.labels[0]
    return { id, photoUri: m.photoUri, loggedAt: m.loggedAt, title, calories: m.calories, proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG }
  })
}

export interface MealTemplate {
  title: string
  lastLoggedAt: number
  timesLogged: number
  items: ScanEstimate[]
}

/**
 * "Meals you already have, do recently, or use constantly" — one list, not
 * three, since a meal used constantly is by definition also recent, and
 * separating them into distinct saved/recent/frequent lists would be three
 * features to build instead of one. Groups meals by their exact set of
 * item labels (a "signature"), so a recurring meal (same chicken rice bowl
 * logged 12 times) shows once, ranked by how often it recurs, not 12 times
 * in a chronological list. Bounded to the last 2000 log_item rows rather
 * than the whole table, a pre-launch-appropriate limit that keeps this
 * cheap as history grows without needing a real aggregation table yet.
 */
export async function frequentMeals(limit = 15): Promise<MealTemplate[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{
    meal_id: number; logged_at: number
    label: string; serving_label: string | null; grams: number | null; calories: number; protein_g: number; carbs_g: number; fat_g: number
  }>(
    `SELECT m.id as meal_id, m.logged_at, li.label, li.serving_label, li.grams, li.calories, li.protein_g, li.carbs_g, li.fat_g
     FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.analysis_status = 'complete'
     ORDER BY m.logged_at DESC
     LIMIT 2000`,
  )

  const byMeal = new Map<number, { loggedAt: number; items: ScanEstimate[] }>()
  for (const r of rows) {
    let meal = byMeal.get(r.meal_id)
    if (!meal) {
      meal = { loggedAt: r.logged_at, items: [] }
      byMeal.set(r.meal_id, meal)
    }
    meal.items.push({
      label: r.label, servingLabel: r.serving_label, grams: r.grams,
      calories: r.calories, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g,
    })
  }

  function titleFor(items: ScanEstimate[]): string {
    return items.length > 1 ? `${items[0].label} +${items.length - 1} more` : items[0].label
  }

  const bySignature = new Map<string, MealTemplate & { signature: string }>()
  for (const meal of byMeal.values()) {
    // JSON-encoded, not a raw "|"-join — a plain join can't tell
    // ["a|b","c"] apart from ["a","b|c"], a real (if unlikely) collision
    // risk for pasted or manually-typed labels.
    const signature = JSON.stringify(meal.items.map((i) => i.label.toLowerCase().trim()).sort())
    if (meal.items.length === 0) continue
    const existing = bySignature.get(signature)
    if (existing) {
      existing.timesLogged += 1
      if (meal.loggedAt > existing.lastLoggedAt) {
        existing.lastLoggedAt = meal.loggedAt
        existing.items = meal.items // keep the freshest instance's exact values
        existing.title = titleFor(meal.items) // recomputed alongside items, not left to depend on insertion order
      }
    } else {
      bySignature.set(signature, { signature, title: titleFor(meal.items), lastLoggedAt: meal.loggedAt, timesLogged: 1, items: meal.items })
    }
  }

  return Array.from(bySignature.values())
    .sort((a, b) => b.timesLogged - a.timesLogged || b.lastLoggedAt - a.lastLoggedAt)
    .slice(0, limit)
    .map(({ signature: _signature, ...rest }) => rest)
}

export interface Streak {
  currentDays: number
  active: boolean // false once today has passed with no log — shown as "streak at risk" rather than silently reset
}

/**
 * Consecutive-day logging streak, computed purely from distinct local_dates
 * with a completed meal. Deliberately personal-only (not shared, not
 * compared against other users) — the research case for skipping
 * leaderboards while keeping streak/consistency badges is in
 * research_weight_cut_ai_market.md.
 */
export async function loggingStreak(now: number): Promise<Streak> {
  const db = await getDb()
  // JOIN log_items, not just a bare meals scan — a meal row with zero
  // items (the AI recognized nothing, or every item got removed) is not
  // a real logged day, and dayTotals()/recentMeals() already treat it
  // that way via the same join. Without it, a zero-item meal kept a
  // streak "active" on a day nothing was actually logged.
  const rows = await db.getAllAsync<{ local_date: string }>(
    `SELECT DISTINCT m.local_date FROM meals m JOIN log_items li ON li.meal_id = m.id
     WHERE m.analysis_status = 'complete' ORDER BY m.local_date DESC`,
  )
  if (rows.length === 0) return { currentDays: 0, active: false }

  const dateSet = new Set(rows.map((r) => r.local_date))
  const todayStr = localDateFrom(now)
  const yesterdayStr = localDateFrom(now - 24 * 60 * 60 * 1000)
  const mostRecent = rows[0].local_date
  if (mostRecent !== todayStr && mostRecent !== yesterdayStr) {
    return { currentDays: 0, active: false }
  }

  let count = 0
  let cursorMs = new Date(`${mostRecent}T00:00:00`).getTime()
  while (dateSet.has(localDateFrom(cursorMs))) {
    count++
    cursorMs -= 24 * 60 * 60 * 1000
  }
  return { currentDays: count, active: mostRecent === todayStr }
}

export async function logWater(ml: number, now: number): Promise<void> {
  const db = await getDb()
  await db.runAsync('INSERT INTO water_entries (local_date, ml, logged_at) VALUES (?, ?, ?)', [localDateFrom(now), ml, now])
}

export async function dayWaterMl(localDate: string): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(ml) as total FROM water_entries WHERE local_date = ?',
    [localDate],
  )
  return row?.total ?? 0
}

export async function logExercise(label: string, calories: number, now: number): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT INTO exercise_entries (local_date, label, calories, logged_at) VALUES (?, ?, ?, ?)',
    [localDateFrom(now), label, calories, now],
  )
}

export async function dayExerciseCalories(localDate: string): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(calories) as total FROM exercise_entries WHERE local_date = ?',
    [localDate],
  )
  return row?.total ?? 0
}

export interface ExerciseSummary {
  id: number
  label: string
  calories: number
  loggedAt: number
}

export async function recentExercise(localDate: string): Promise<ExerciseSummary[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{ id: number; label: string; calories: number; logged_at: number }>(
    'SELECT id, label, calories, logged_at FROM exercise_entries WHERE local_date = ? ORDER BY logged_at DESC',
    [localDate],
  )
  return rows.map((r) => ({ id: r.id, label: r.label, calories: r.calories, loggedAt: r.logged_at }))
}

export interface BodyCompositionEntry {
  id: number
  localDate: string
  source: string
  bodyFatPct: number | null
  leanMassKg: number | null
  notes: string | null
  loggedAt: number
}

/**
 * Manual entry, not a parsed import — DEXA/BodPod/InBody each issue their
 * own PDF with no shared machine-readable format, so there's nothing
 * honest to auto-parse. This just gives a fighter a place to log the real
 * numbers from a scan they already got done elsewhere.
 */
export async function logBodyComposition(
  entry: { localDate: string; source: string; bodyFatPct: number | null; leanMassKg: number | null; notes: string | null },
  now: number,
): Promise<void> {
  const db = await getDb()
  await db.runAsync(
    'INSERT INTO body_composition_entries (local_date, source, body_fat_pct, lean_mass_kg, notes, logged_at) VALUES (?, ?, ?, ?, ?, ?)',
    [entry.localDate, entry.source, entry.bodyFatPct, entry.leanMassKg, entry.notes, now],
  )
}

export async function bodyCompositionHistory(): Promise<BodyCompositionEntry[]> {
  const db = await getDb()
  const rows = await db.getAllAsync<{
    id: number; local_date: string; source: string; body_fat_pct: number | null
    lean_mass_kg: number | null; notes: string | null; logged_at: number
  }>('SELECT * FROM body_composition_entries ORDER BY local_date ASC')
  return rows.map((r) => ({
    id: r.id, localDate: r.local_date, source: r.source, bodyFatPct: r.body_fat_pct,
    leanMassKg: r.lean_mass_kg, notes: r.notes, loggedAt: r.logged_at,
  }))
}

export async function latestBodyComposition(): Promise<BodyCompositionEntry | null> {
  const entries = await bodyCompositionHistory()
  return entries[entries.length - 1] ?? null
}

export async function weighInCount(): Promise<number> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM weight_entries')
  return row?.n ?? 0
}

/**
 * Everything a user has logged, as one plain object — meant for the
 * Profile screen's "Export data" action. No API key or credential in here:
 * unlike nut-ai's BYOK model, this app never stores one client-side (the AI
 * proxy is server-side only), so there's nothing sensitive to strip out.
 */
export async function exportAllData(): Promise<Record<string, unknown>> {
  const db = await getDb()
  const [profile, fightGoals, weightEntries, meals, logItems, water, exercise, bodyComposition] = await Promise.all([
    db.getAllAsync('SELECT * FROM profile'),
    db.getAllAsync('SELECT * FROM fight_goals'),
    db.getAllAsync('SELECT * FROM weight_entries'),
    db.getAllAsync('SELECT id, local_date, logged_at, analysis_status FROM meals'), // omit photo_uri: a local file path, meaningless once exported off-device
    db.getAllAsync('SELECT * FROM log_items'),
    db.getAllAsync('SELECT * FROM water_entries'),
    db.getAllAsync('SELECT * FROM exercise_entries'),
    db.getAllAsync('SELECT * FROM body_composition_entries'),
  ])
  return {
    exportedAt: new Date().toISOString(),
    profile, fightGoals, weightEntries, meals, logItems, water, exercise, bodyComposition,
  }
}

/**
 * Restores a previous `exportAllData()` JSON as this device's data,
 * replacing whatever's currently local. A merge would need real conflict
 * resolution (which weigh-in for a duplicated date, which meal is the
 * "same" one) that a fresh export/import round-trip doesn't need — this is
 * meant for moving to a new phone, not syncing two devices that were both
 * used in parallel. One transaction, all-or-nothing: a partially-applied
 * restore would be worse than a failed one.
 */
// Raw column shapes as they appear in an exportAllData() JSON file — an
// untyped `Record<string, unknown>` can't be used directly as a SQLite bind
// param, so each imported row is cast to one of these instead of `unknown`.
interface ImportedProfileRow {
  sex: string; weight_kg: number; height_cm: number; birth_date: number
  activity_level: string; units: string; created_at: number
}
interface ImportedFightGoalRow {
  effective_from: number; goal_type: string | null; weigh_in_target_kg: number; weigh_in_date: number
  target_kcal: number; protein_g: number; fat_g: number; carbs_g: number; source: string | null
}
interface ImportedWeightEntryRow { local_date: string; weight_kg: number; logged_at: number }
interface ImportedMealRow { id: number; local_date: string; logged_at: number; analysis_status: string }
interface ImportedLogItemRow {
  meal_id: number; label: string; serving_label: string | null; grams: number | null; calories: number
  protein_g: number; carbs_g: number; fat_g: number
}
interface ImportedWaterRow { local_date: string; ml: number; logged_at: number }
interface ImportedExerciseRow { local_date: string; label: string; calories: number; logged_at: number }
interface ImportedBodyCompositionRow {
  local_date: string; source: string; body_fat_pct: number | null; lean_mass_kg: number | null
  notes: string | null; logged_at: number
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** Every table of actual logged data — shared by importAllData's wipe-before-restore and full account deletion. Deliberately excludes `settings`: a data restore shouldn't reset device-level preferences like theme, but account deletion (see wipeAllLocalDataForAccountDeletion) does that separately on purpose. */
async function wipeLocalDataTables(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  await db.runAsync('DELETE FROM log_items')
  await db.runAsync('DELETE FROM meals')
  await db.runAsync('DELETE FROM weight_entries')
  await db.runAsync('DELETE FROM fight_goals')
  await db.runAsync('DELETE FROM profile')
  await db.runAsync('DELETE FROM water_entries')
  await db.runAsync('DELETE FROM exercise_entries')
  await db.runAsync('DELETE FROM body_composition_entries')
  await db.runAsync('DELETE FROM meal_plan')
  await db.runAsync('DELETE FROM meal_plan_preferences')
}

/**
 * Which signed-in account's data currently lives in this device's local
 * tables -- lets account.tsx tell "signing back into the same account
 * after signing out" (keep everything) apart from "a different account is
 * taking over this device" (wipe first). Set right after every successful
 * signUp/signIn; empty means no account has claimed the local data yet
 * (a fresh install, or right after wipeAllLocalData()).
 */
export const LOCAL_DATA_OWNER_KEY = 'localData.ownerUserId.v1'

/**
 * Wipes every local table, `settings` included (onboarding-completed
 * flag, role, theme preference, everything) -- so the device behaves
 * exactly like a fresh install afterward.
 *
 * Two callers: account deletion (the account is gone server-side, a
 * local copy of it left behind would just be stale), and account.tsx's
 * next() when a sign-up or sign-in resolves to a *different* account than
 * LOCAL_DATA_OWNER_KEY -- local data is scoped to the device, not the
 * account, so without this, switching to a different account on the same
 * phone would silently inherit whatever the previous account had already
 * set (onboarding-completed flag, body stats, fight goal) instead of
 * starting that account fresh on this device.
 *
 * Deliberately NOT called on sign-out itself anymore (found as a real bug,
 * Jean testing his own account directly): sign-out used to wipe
 * unconditionally, which meant signing back into the *same* account lost
 * everything just as completely as switching to a different one, even
 * though nothing about that account's data was actually stale. Local data
 * now survives a sign-out and is only wiped once it's actually confirmed
 * to belong to someone else.
 */
export async function wipeAllLocalData(): Promise<void> {
  const db = await getDb()
  await db.withTransactionAsync(async () => {
    await wipeLocalDataTables(db)
    await db.runAsync('DELETE FROM settings')
  })
}

export async function importAllData(data: Record<string, unknown>): Promise<void> {
  const db = await getDb()
  await db.withTransactionAsync(async () => {
    await wipeLocalDataTables(db)

    const profile = asArray<ImportedProfileRow>(data.profile)[0]
    if (profile) {
      await db.runAsync(
        'INSERT INTO profile (id, sex, weight_kg, height_cm, birth_date, activity_level, units, created_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
        [profile.sex, profile.weight_kg, profile.height_cm, profile.birth_date, profile.activity_level, profile.units, profile.created_at],
      )
    }

    for (const g of asArray<ImportedFightGoalRow>(data.fightGoals)) {
      // goal_type/source may be absent on an export taken before those
      // columns existed — default to 'lose'/'formula', the only kinds that
      // could exist then.
      await db.runAsync(
        `INSERT INTO fight_goals (effective_from, goal_type, weigh_in_target_kg, weigh_in_date, target_kcal, protein_g, fat_g, carbs_g, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.effective_from, g.goal_type ?? 'lose', g.weigh_in_target_kg, g.weigh_in_date, g.target_kcal, g.protein_g, g.fat_g, g.carbs_g, g.source ?? 'formula'],
      )
    }

    for (const w of asArray<ImportedWeightEntryRow>(data.weightEntries)) {
      await db.runAsync(
        'INSERT OR REPLACE INTO weight_entries (local_date, weight_kg, logged_at) VALUES (?, ?, ?)',
        [w.local_date, w.weight_kg, w.logged_at],
      )
    }

    // meal ids are regenerated on insert, so log_items must be remapped from
    // the old id (in the export) to whatever new id this device assigns.
    const meals = asArray<ImportedMealRow>(data.meals)
    const logItems = asArray<ImportedLogItemRow>(data.logItems)
    const oldToNewMealId = new Map<number, number>()
    for (const m of meals) {
      const result = await db.runAsync(
        'INSERT INTO meals (photo_uri, local_date, logged_at, analysis_status) VALUES (?, ?, ?, ?)',
        [null, m.local_date, m.logged_at, m.analysis_status], // photo_uri never traveled in the export (a local file path from the old device, meaningless here)
      )
      oldToNewMealId.set(m.id, result.lastInsertRowId)
    }
    for (const li of logItems) {
      const newMealId = oldToNewMealId.get(li.meal_id)
      if (newMealId == null) continue
      await db.runAsync(
        'INSERT INTO log_items (meal_id, label, serving_label, grams, calories, protein_g, carbs_g, fat_g) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        // serving_label may be absent on an export taken before this column existed.
        [newMealId, li.label, li.serving_label ?? null, li.grams, li.calories, li.protein_g, li.carbs_g, li.fat_g],
      )
    }

    for (const w of asArray<ImportedWaterRow>(data.water)) {
      await db.runAsync('INSERT INTO water_entries (local_date, ml, logged_at) VALUES (?, ?, ?)', [w.local_date, w.ml, w.logged_at])
    }

    for (const e of asArray<ImportedExerciseRow>(data.exercise)) {
      await db.runAsync(
        'INSERT INTO exercise_entries (local_date, label, calories, logged_at) VALUES (?, ?, ?, ?)',
        [e.local_date, e.label, e.calories, e.logged_at],
      )
    }

    for (const b of asArray<ImportedBodyCompositionRow>(data.bodyComposition)) {
      await db.runAsync(
        'INSERT INTO body_composition_entries (local_date, source, body_fat_pct, lean_mass_kg, notes, logged_at) VALUES (?, ?, ?, ?, ?, ?)',
        [b.local_date, b.source, b.body_fat_pct, b.lean_mass_kg, b.notes, b.logged_at],
      )
    }
  })
}

export async function setting(key: string, fallback = ''): Promise<string> {
  const db = await getDb()
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value ?? fallback
}

export async function putSetting(key: string, value: string): Promise<void> {
  const db = await getDb()
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
}

/**
 * Whether logged exercise adds back to the day's calorie budget — on by
 * default (today's existing behavior), off is the setting a fighter would
 * flip after watching their own "why isn't this cut working" numbers,
 * per a specific, evidence-grounded critique: device/app calorie-burn
 * estimates run high, and eating back an inflated estimate is a well
 * documented reason a deficit quietly stops being one. Off by default
 * would have silently changed existing users' daily targets on this
 * update; a settings-gated opt-out doesn't.
 */
export const EXCLUDE_EXERCISE_CALORIES_KEY = 'nutrition.excludeExerciseCalories.v1'
