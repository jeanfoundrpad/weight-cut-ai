// Dependency-free on purpose, same reasoning as dateMath.ts — anything that
// imports expo-sqlite/repo.ts transitively pulls in Flow-typed React Native
// source that vitest's Node runner can't parse. Keeping the actual math here
// means it stays unit-testable. lib/units.ts is safe to import here since
// it has zero dependencies of its own.

import { KG_TO_LB } from './units'

export interface WeightPoint {
  localDate: string
  weightKg: number
}

function dateMsFrom(localDate: string): number {
  return new Date(`${localDate}T00:00:00`).getTime()
}

function localDateFromMs(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A trailing moving average ending at `targetDate`, not a single raw
 * reading — a 3 lb overnight swing is water weight, not progress. Averaging
 * whatever real weigh-ins fall in the trailing window (not requiring a
 * point every day) turns noisy daily numbers into an honest trend, which is
 * the actual number a fighter should make cut decisions from.
 */
export function trendWeightAt(points: WeightPoint[], targetDate: string, windowDays = 7): number | null {
  const endMs = dateMsFrom(targetDate)
  const startMs = endMs - (windowDays - 1) * DAY_MS
  const inWindow = points.filter((p) => {
    const t = dateMsFrom(p.localDate)
    return t <= endMs && t >= startMs
  })
  if (inWindow.length === 0) return null
  return inWindow.reduce((sum, p) => sum + p.weightKg, 0) / inWindow.length
}

export interface WeightChange {
  label: string
  deltaLb: number | null
}

/**
 * Matches nut-ai's "Weight changes" table shape (3/7/14/30/90 day + all
 * time), each measured on the trend, not the raw log — same principle as
 * trendWeightAt. `deltaLb` is null when there isn't enough history yet to
 * compare against (not zero — zero would falsely claim "no change").
 */
export function weightChangesOverPeriods(points: WeightPoint[]): WeightChange[] {
  if (points.length === 0) {
    return [3, 7, 14, 30, 90].map((d) => ({ label: `${d} day`, deltaLb: null })).concat([{ label: 'All time', deltaLb: null }])
  }
  const latestDate = points[points.length - 1].localDate
  const latestTrend = trendWeightAt(points, latestDate)
  const firstDate = points[0].localDate

  const periods = [3, 7, 14, 30, 90].map((days) => {
    const compareDate = localDateFromMs(dateMsFrom(latestDate) - days * DAY_MS)
    const compareTrend = trendWeightAt(points, compareDate)
    return {
      label: `${days} day`,
      deltaLb: latestTrend != null && compareTrend != null ? (latestTrend - compareTrend) * KG_TO_LB : null,
    }
  })

  const firstTrend = trendWeightAt(points, firstDate)
  periods.push({
    label: 'All time',
    deltaLb: latestTrend != null && firstTrend != null ? (latestTrend - firstTrend) * KG_TO_LB : null,
  })
  return periods
}

/** Current pace, lb/week, from the trend — the 7-day change already IS a weekly rate. */
export function currentPaceLbPerWeek(points: WeightPoint[]): number | null {
  return weightChangesOverPeriods(points).find((c) => c.label === '7 day')?.deltaLb ?? null
}
