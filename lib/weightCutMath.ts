/**
 * Weight Cut AI — calorie & weight-cut math.
 *
 * Everything here implements standard, published nutrition-science formulas
 * (Mifflin-St Jeor 1990, the ~3500 kcal-per-pound rule of thumb, generally
 * accepted minimum-safe-intake floors). These are facts and public methods,
 * not anyone's protected expression — original implementation, written from
 * the formulas themselves, not ported from any other app's code.
 */

import { KG_TO_LB } from './units'

export type BiologicalSex = 'male' | 'female' | 'unspecified'

export interface Athlete {
  sex: BiologicalSex
  weightKg: number
  heightCm: number
  ageYears: number
}

/**
 * Resting energy expenditure, Mifflin-St Jeor.
 *
 * kcal/day = 10*weight(kg) + 6.25*height(cm) - 5*age(yr) + s
 * s = +5 (male), -161 (female). For "unspecified", split the difference —
 * a flagged assumption, not a scientifically justified third case.
 */
export function restingEnergy(a: Athlete): number {
  const base = 10 * a.weightKg + 6.25 * a.heightCm - 5 * a.ageYears
  if (a.sex === 'male') return base + 5
  if (a.sex === 'female') return base - 161
  return base + (5 + -161) / 2
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high' | 'very_high'

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
}

/** Total daily energy expenditure = resting energy x activity factor. */
export function totalEnergyExpenditure(restingKcal: number, activity: ActivityLevel): number {
  return restingKcal * ACTIVITY_FACTOR[activity]
}

/** Roughly one pound of body mass per 3500 kcal — the standard estimate. */
export const KCAL_PER_POUND = 3500

/**
 * Minimum daily intake before nutrition guidance considers it unsafe
 * without medical supervision. A hard floor, never something a fast cut
 * timeline is allowed to override silently.
 */
export function safeMinimumKcal(sex: BiologicalSex, restingKcal: number): number {
  const flat = sex === 'male' ? 1500 : 1200
  return Math.max(flat, restingKcal * 1.2)
}

export interface DailyTarget {
  restingKcal: number
  maintenanceKcal: number
  requestedDeficitKcal: number
  targetKcal: number
  wasClamped: boolean
  clampReason: string | null
  cautions: string[]
}

/**
 * The daily calorie number an athlete should actually eat, given a desired
 * weekly rate of loss (lb/week, positive = losing).
 */
export function dailyTargetForRate(a: Athlete, activity: ActivityLevel, lbPerWeek: number): DailyTarget {
  const restingKcal = restingEnergy(a)
  const maintenanceKcal = totalEnergyExpenditure(restingKcal, activity)
  const requestedDeficitKcal = (lbPerWeek * KCAL_PER_POUND) / 7
  const rawTarget = maintenanceKcal - requestedDeficitKcal

  const floor = safeMinimumKcal(a.sex, restingKcal)
  const targetKcal = Math.max(rawTarget, floor)
  const wasClamped = targetKcal > rawTarget

  // Both checks use magnitude (Math.abs) rather than the raw signed rate: a
  // negative lbPerWeek (gain) produces a negative requestedDeficitKcal (an
  // actual surplus), and an aggressive pace is aggressive in either
  // direction — a fast bulk deserves the same caution as a fast cut, not
  // silence just because the sign flipped.
  const cautions: string[] = []
  if (Math.abs(requestedDeficitKcal) > 1000) {
    cautions.push(
      lbPerWeek > 0
        ? `${lbPerWeek.toFixed(1)} lb/week implies cutting about ${Math.round(requestedDeficitKcal)} kcal/day, which is an aggressive pace to sustain.`
        : `${Math.abs(lbPerWeek).toFixed(1)} lb/week implies a surplus of about ${Math.round(Math.abs(requestedDeficitKcal))} kcal/day, which is an aggressive pace to sustain.`,
    )
  }
  const onePercentBodyweightLb = a.weightKg * KG_TO_LB * 0.01
  if (Math.abs(lbPerWeek) > onePercentBodyweightLb) {
    cautions.push(`That's faster than 1% of bodyweight per week (${onePercentBodyweightLb.toFixed(1)} lb).`)
  }

  return {
    restingKcal,
    maintenanceKcal,
    requestedDeficitKcal,
    targetKcal,
    wasClamped,
    clampReason: wasClamped
      ? `The math called for ${Math.round(rawTarget)} kcal/day, but we don't recommend going under ${Math.round(floor)}.`
      : null,
    cautions,
  }
}

/**
 * The fighter's actual question, inverted from the usual one: "I weigh in
 * at X on day D — how hard do I have to cut to get there?" rather than
 * "if I cut at rate R, when do I arrive?" Generalizes past pure cutting:
 * sign follows `dailyTargetForRate`'s own convention (positive = losing,
 * negative = gaining), so a target *above* current weight correctly
 * returns a negative rate rather than being rejected — a gain goal is
 * just this same math with the subtraction the other way around, not a
 * separate formula. A target equal to current weight returns exactly 0,
 * which is also correct (a maintain goal doesn't need this function at
 * all — call `dailyTargetForRate` with rate 0 directly instead).
 *
 * Returns null only when there's nothing to compute — the date has
 * already passed.
 */
export function requiredWeeklyRate(
  currentWeightKg: number,
  targetWeightKg: number,
  targetDateMs: number,
  nowMs: number,
): number | null {
  const weeksRemaining = (targetDateMs - nowMs) / (7 * 24 * 60 * 60 * 1000)
  if (weeksRemaining <= 0) return null
  const poundsToChange = (currentWeightKg - targetWeightKg) * KG_TO_LB
  return poundsToChange / weeksRemaining
}

/**
 * 1.5% of bodyweight per week — the max sustained loss rate the NWCA
 * (National Wrestling Coaches Association) certifies as safe under its
 * Optimal Performance Calculator, used at scale across 240,000+ wrestlers.
 * A real, citable, governing-body-validated ceiling, distinct from
 * `requiredWeeklyRate` (what pace hits the deadline) — this is what pace
 * is actually safe regardless of deadline. Going too fast is the dangerous
 * direction, not just going too slow.
 */
export const SAFE_MAX_WEEKLY_LOSS_FRACTION = 0.015

export function safeMaxWeeklyLossLb(currentWeightKg: number): number {
  return currentWeightKg * KG_TO_LB * SAFE_MAX_WEEKLY_LOSS_FRACTION
}

export interface MacroSplit {
  proteinG: number
  fatG: number
  carbsG: number
}

/**
 * Protein and fat set from bodyweight (grams/kg — tracks the athlete, not
 * the calorie budget), carbs absorb whatever's left. Cutting weight biases
 * protein higher to protect lean mass during a deficit.
 */
export function macroSplit(targetKcal: number, weightKg: number): MacroSplit {
  const proteinG = 2.2 * weightKg
  const fatG = Math.max((0.25 * targetKcal) / 9, 0.6 * weightKg)
  const carbsG = Math.max(0, (targetKcal - proteinG * 4 - fatG * 9) / 4)
  return { proteinG, fatG, carbsG }
}

/** Standard BMI formula (kg / m^2) — a public formula, not anyone's expression. */
export function bmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100
  return weightKg / (heightM * heightM)
}

export type BmiCategory = 'Underweight' | 'Normal' | 'Overweight' | 'Obese'

export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return 'Underweight'
  if (value < 25) return 'Normal'
  if (value < 30) return 'Overweight'
  return 'Obese'
}
