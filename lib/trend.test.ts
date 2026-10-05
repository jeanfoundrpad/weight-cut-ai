import { describe, expect, it } from 'vitest'
import { currentPaceLbPerWeek, trendWeightAt, weightChangesOverPeriods, type WeightPoint } from './trend'
import { KG_TO_LB } from './units'

// Local date construction, not UTC ISO strings — same reasoning as
// dateMath.test.ts, avoids timezone-dependent flakiness.
function dateStr(daysAgo: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('trendWeightAt', () => {
  it('returns the single point when only one reading exists', () => {
    const points: WeightPoint[] = [{ localDate: dateStr(0), weightKg: 80 }]
    expect(trendWeightAt(points, dateStr(0))).toBe(80)
  })

  it('averages every reading inside the trailing window', () => {
    const points: WeightPoint[] = [
      { localDate: dateStr(2), weightKg: 80 },
      { localDate: dateStr(1), weightKg: 81 },
      { localDate: dateStr(0), weightKg: 82 },
    ]
    expect(trendWeightAt(points, dateStr(0), 7)).toBeCloseTo(81, 5)
  })

  it('ignores readings outside the window', () => {
    const points: WeightPoint[] = [
      { localDate: dateStr(30), weightKg: 100 }, // way outside a 7-day window
      { localDate: dateStr(0), weightKg: 80 },
    ]
    expect(trendWeightAt(points, dateStr(0), 7)).toBe(80)
  })

  it('returns null when nothing falls in the window', () => {
    const points: WeightPoint[] = [{ localDate: dateStr(30), weightKg: 100 }]
    expect(trendWeightAt(points, dateStr(0), 7)).toBeNull()
  })
})

describe('weightChangesOverPeriods', () => {
  it('returns null deltas for periods with no comparison point yet', () => {
    const points: WeightPoint[] = [{ localDate: dateStr(0), weightKg: 80 }]
    const changes = weightChangesOverPeriods(points)
    expect(changes.find((c) => c.label === '7 day')?.deltaLb).toBeNull()
  })

  it('reports a real weight-loss delta once enough history exists', () => {
    const points: WeightPoint[] = [
      { localDate: dateStr(7), weightKg: 82 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const changes = weightChangesOverPeriods(points)
    const sevenDay = changes.find((c) => c.label === '7 day')?.deltaLb
    expect(sevenDay).not.toBeNull()
    expect(sevenDay!).toBeCloseTo(-2 * KG_TO_LB, 3) // lost 2kg over 7 days -> negative lb delta
  })

  it('computes an all-time delta from the very first reading', () => {
    const points: WeightPoint[] = [
      { localDate: dateStr(90), weightKg: 90 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const changes = weightChangesOverPeriods(points)
    const allTime = changes.find((c) => c.label === 'All time')?.deltaLb
    expect(allTime!).toBeCloseTo(-10 * KG_TO_LB, 3)
  })
})

describe('currentPaceLbPerWeek', () => {
  it('matches the 7-day change', () => {
    const points: WeightPoint[] = [
      { localDate: dateStr(7), weightKg: 82 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    expect(currentPaceLbPerWeek(points)).toBeCloseTo(-2 * KG_TO_LB, 3)
  })

  it('returns null with insufficient history', () => {
    expect(currentPaceLbPerWeek([{ localDate: dateStr(0), weightKg: 80 }])).toBeNull()
  })
})
