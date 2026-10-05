// Weight Cut AI — adaptive expenditure recalibration.
//
// The Mifflin-St Jeor formula (weightCutMath.ts) is a population-average
// estimate, checked against research (MacroFactor's public methodology docs)
// to commonly miss an individual's real maintenance by 200-400 kcal. The
// standard fix, used by MacroFactor/similar coaching apps: once real
// logging data exists, reverse the energy-balance equation — trend weight
// change over a window, plus average logged intake over that same window,
// implies what this specific person's real expenditure actually is.
//
// Dependency-free on purpose, same reasoning as trend.ts/weightCutMath.ts —
// stays unit-testable without pulling in expo-sqlite/React Native.

import type { WeightPoint } from './trend'
import { trendWeightAt } from './trend'
import { KCAL_PER_POUND } from './weightCutMath'
import { KG_TO_LB } from './units'

export interface IntakeDay {
  localDate: string
  totalKcal: number
}

// MacroFactor's own guidance: nutrition logging at least 4x/week for a
// usable estimate, ideally daily; expenditure stabilizes over roughly 2-3
// weeks of consistent data. 5 is a slightly stricter floor than "4x/week"
// since this window can span more than 7 days and gappy data is noisier.
const MIN_DAYS_FOR_RECALIBRATION = 5
// Confidence reaches its cap once real data volume gets close to
// MacroFactor's own ~2-3 week stabilization window.
const FULL_CONFIDENCE_DAYS = 14
// Never fully replace the formula estimate with the implied one, however
// much data exists — a guardrail against one unusually noisy window (a sick
// week, a travel week) swinging the target hard. Matches the "intelligent
// guardrails... don't overreact to short-term data" pattern these apps use.
const MAX_CONFIDENCE = 0.8
// Metric equivalent of the standard 3500 kcal/lb rule of thumb — kcal/lb
// times lb/kg (KG_TO_LB converts kg -> lb, so this is the right direction),
// which lands at the commonly cited ~7700 kcal/kg figure.
const KCAL_PER_KG = KCAL_PER_POUND * KG_TO_LB
// Below this, a recalibration isn't worth surfacing or acting on — noise,
// not signal.
const MATERIAL_CHANGE_KCAL = 50

const DAY_MS = 24 * 60 * 60 * 1000

function dateMsFrom(localDate: string): number {
  return new Date(`${localDate}T00:00:00`).getTime()
}

export interface AdaptiveRecalibration {
  hasEnoughData: boolean
  daysOfData: number
  impliedTdeeKcal: number | null
  blendedTdeeKcal: number | null
  confidence: number
  previousTargetKcal: number
  newTargetKcal: number
  deltaKcal: number
  isMaterialChange: boolean
  wasFloorClamped: boolean
  reason: string
}

/**
 * `intakeDays` should be trailing logged days only (days with no logged
 * meal don't belong in an intake average — MacroFactor's own guidance is
 * the same: only logged days count). `formulaMaintenanceKcal` and
 * `requestedDeficitKcal` come from whatever produced the athlete's current
 * plan (weightCutMath.dailyTargetForRate's maintenanceKcal /
 * requestedDeficitKcal) — recalibration deliberately preserves the deficit
 * *size* the athlete chose (and which already passed the NWCA safe-rate
 * check at goal-set time) and only corrects what maintenance number that
 * deficit gets subtracted from. `floorKcal` is
 * weightCutMath.safeMinimumKcal's output, applied here the same as it is
 * in dailyTargetForRate.
 */
export function recalibrateTarget(
  weightPoints: WeightPoint[],
  intakeDays: IntakeDay[],
  formulaMaintenanceKcal: number,
  requestedDeficitKcal: number,
  previousTargetKcal: number,
  floorKcal: number,
): AdaptiveRecalibration {
  const daysOfData = intakeDays.length
  const base: Omit<AdaptiveRecalibration, 'reason'> = {
    hasEnoughData: false,
    daysOfData,
    impliedTdeeKcal: null,
    blendedTdeeKcal: null,
    confidence: 0,
    previousTargetKcal,
    newTargetKcal: previousTargetKcal,
    deltaKcal: 0,
    isMaterialChange: false,
    wasFloorClamped: false,
  }

  if (daysOfData < MIN_DAYS_FOR_RECALIBRATION) {
    return { ...base, reason: `Log your meals at least ${MIN_DAYS_FOR_RECALIBRATION} days a week to unlock plan recalibration.` }
  }

  const sorted = [...intakeDays].sort((a, b) => (a.localDate < b.localDate ? -1 : 1))
  const startDate = sorted[0].localDate
  const endDate = sorted[sorted.length - 1].localDate
  const trendStart = trendWeightAt(weightPoints, startDate)
  const trendEnd = trendWeightAt(weightPoints, endDate)
  if (trendStart == null || trendEnd == null) {
    return { ...base, reason: 'Log your weight more consistently to unlock plan recalibration.' }
  }

  const spanDays = Math.max(1, Math.round((dateMsFrom(endDate) - dateMsFrom(startDate)) / DAY_MS))
  const avgIntakeKcal = intakeDays.reduce((sum, d) => sum + d.totalKcal, 0) / daysOfData
  const weightChangeKg = trendEnd - trendStart
  const impliedTdeeKcal = avgIntakeKcal - (weightChangeKg * KCAL_PER_KG) / spanDays

  const confidence = Math.min(daysOfData / FULL_CONFIDENCE_DAYS, 1) * MAX_CONFIDENCE
  const blendedTdeeKcal = formulaMaintenanceKcal * (1 - confidence) + impliedTdeeKcal * confidence

  const rawTarget = blendedTdeeKcal - requestedDeficitKcal
  const newTargetKcal = Math.max(rawTarget, floorKcal)
  const wasFloorClamped = newTargetKcal > rawTarget
  const deltaKcal = newTargetKcal - previousTargetKcal
  const isMaterialChange = Math.abs(deltaKcal) >= MATERIAL_CHANGE_KCAL

  const direction = deltaKcal > 0 ? 'up' : 'down'
  const reason = isMaterialChange
    ? `Your last ${spanDays} days of weigh-ins and logged meals suggest your real maintenance is closer to ` +
      `${Math.round(blendedTdeeKcal)} kcal/day than the ${Math.round(formulaMaintenanceKcal)} kcal estimate your plan started from, ` +
      `so your daily target moved ${direction} to ${Math.round(newTargetKcal)} kcal to keep the same pace toward your goal.`
    : `Your recent data lines up closely with your current plan. No change needed.`

  return {
    hasEnoughData: true,
    daysOfData,
    impliedTdeeKcal,
    blendedTdeeKcal,
    confidence,
    previousTargetKcal,
    newTargetKcal,
    deltaKcal,
    isMaterialChange,
    wasFloorClamped,
    reason,
  }
}
