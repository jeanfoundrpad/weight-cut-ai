import { describe, expect, it } from 'vitest'
import {
  KCAL_PER_POUND,
  bmi,
  bmiCategory,
  dailyTargetForRate,
  macroSplit,
  requiredWeeklyRate,
  restingEnergy,
  safeMaxWeeklyLossLb,
  totalEnergyExpenditure,
  type Athlete,
} from './weightCutMath'

const athlete: Athlete = { sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30 }

describe('restingEnergy (Mifflin-St Jeor)', () => {
  it('applies the sex-specific constant', () => {
    // 10*80 + 6.25*180 - 5*30 = 1775, +5 male / -161 female
    expect(restingEnergy(athlete)).toBeCloseTo(1780, 6)
    expect(restingEnergy({ ...athlete, sex: 'female' })).toBeCloseTo(1614, 6)
  })

  it('splits the difference for unspecified rather than picking a side', () => {
    const male = restingEnergy(athlete)
    const female = restingEnergy({ ...athlete, sex: 'female' })
    const unspecified = restingEnergy({ ...athlete, sex: 'unspecified' })
    expect(unspecified).toBeCloseTo((male + female) / 2, 6)
    expect(unspecified).toBeGreaterThan(female)
    expect(unspecified).toBeLessThan(male)
  })

  it('scales with weight, height, and age in the expected directions', () => {
    const base = restingEnergy(athlete)
    expect(restingEnergy({ ...athlete, weightKg: 90 })).toBeGreaterThan(base)
    expect(restingEnergy({ ...athlete, heightCm: 190 })).toBeGreaterThan(base)
    expect(restingEnergy({ ...athlete, ageYears: 40 })).toBeLessThan(base)
  })
})

describe('totalEnergyExpenditure', () => {
  it('multiplies resting energy by the activity factor', () => {
    expect(totalEnergyExpenditure(1780, 'sedentary')).toBeCloseTo(1780 * 1.2, 6)
    expect(totalEnergyExpenditure(1780, 'moderate')).toBeCloseTo(1780 * 1.55, 6)
    expect(totalEnergyExpenditure(1780, 'very_high')).toBeCloseTo(1780 * 1.9, 6)
  })

  it('is monotonically increasing across the activity scale', () => {
    const levels = ['sedentary', 'light', 'moderate', 'high', 'very_high'] as const
    const values = levels.map((l) => totalEnergyExpenditure(1780, l))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!)
    }
  })
})

describe('dailyTargetForRate — the number a fighter actually eats to', () => {
  it('computes maintenance minus the requested deficit when nothing needs clamping', () => {
    const result = dailyTargetForRate(athlete, 'moderate', 1)
    // resting 1780 * 1.55 = 2759 maintenance; 1 lb/week = 500 kcal/day deficit
    expect(result.maintenanceKcal).toBeCloseTo(2759, 6)
    expect(result.requestedDeficitKcal).toBeCloseTo(500, 6)
    expect(result.targetKcal).toBeCloseTo(2259, 6)
    expect(result.wasClamped).toBe(false)
    expect(result.clampReason).toBeNull()
  })

  it('never returns a target below the safety floor, no matter how aggressive the rate', () => {
    for (const lbPerWeek of [1, 2, 3, 5, 8]) {
      for (const sex of ['male', 'female', 'unspecified'] as const) {
        const result = dailyTargetForRate({ ...athlete, sex }, 'sedentary', lbPerWeek)
        const floor = sex === 'male' ? Math.max(1500, result.restingKcal * 1.2) : Math.max(1200, result.restingKcal * 1.2)
        expect(result.targetKcal).toBeGreaterThanOrEqual(floor - 1e-9)
      }
    }
  })

  it('reports exactly when and why the floor fired', () => {
    // Small, sedentary athlete at an aggressive cut — the arithmetic wants
    // well under 1200, so the floor should visibly override it.
    const small: Athlete = { sex: 'female', weightKg: 55, heightCm: 160, ageYears: 30 }
    const result = dailyTargetForRate(small, 'sedentary', 2)
    expect(result.wasClamped).toBe(true)
    expect(result.targetKcal).toBeGreaterThan(result.maintenanceKcal - result.requestedDeficitKcal)
    expect(result.clampReason).toMatch(/we don't recommend going under/)
    expect(result.clampReason).toMatch(String(Math.round(result.maintenanceKcal - result.requestedDeficitKcal)))
  })

  it('warns on a pace faster than 1000 kcal/day without silently blocking it', () => {
    const result = dailyTargetForRate(athlete, 'moderate', 3)
    expect(result.requestedDeficitKcal).toBeGreaterThan(1000)
    expect(result.cautions.some((c) => c.includes('aggressive'))).toBe(true)
  })

  it('warns on a pace faster than 1% bodyweight/week', () => {
    // 80kg * 2.20462262 * 0.01 ≈ 1.76 lb/week is the 1% threshold here.
    const result = dailyTargetForRate(athlete, 'moderate', 2.5)
    expect(result.cautions.some((c) => c.includes('1% of bodyweight'))).toBe(true)
  })

  it('says nothing when the pace is genuinely reasonable', () => {
    const result = dailyTargetForRate(athlete, 'moderate', 0.5)
    expect(result.cautions).toHaveLength(0)
    expect(result.wasClamped).toBe(false)
  })

  it('computes a real surplus for a negative (gain) rate, never the safety floor', () => {
    const result = dailyTargetForRate(athlete, 'moderate', -1)
    // resting 1780 * 1.55 = 2759 maintenance; -1 lb/week = -500 kcal/day deficit (a surplus)
    expect(result.requestedDeficitKcal).toBeCloseTo(-500, 6)
    expect(result.targetKcal).toBeCloseTo(3259, 6)
    expect(result.wasClamped).toBe(false)
    expect(result.clampReason).toBeNull()
  })

  it('warns on an aggressive surplus the same way it warns on an aggressive deficit', () => {
    const result = dailyTargetForRate(athlete, 'moderate', -3)
    expect(result.requestedDeficitKcal).toBeLessThan(-1000)
    expect(result.cautions.some((c) => c.includes('aggressive') && c.includes('surplus'))).toBe(true)
  })
})

describe('requiredWeeklyRate — the fight-cut question inverted', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.parse('2026-06-01T00:00:00Z')

  it('derives the rate needed to land exactly on the weigh-in', () => {
    // 90kg -> 85kg (11.023 lb) over exactly 4 weeks.
    const rate = requiredWeeklyRate(90, 85, now + 28 * DAY, now)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo((5 * 2.20462262) / 4, 4)
  })

  it('a tighter deadline for the same cut implies a faster required rate', () => {
    const slow = requiredWeeklyRate(90, 85, now + 56 * DAY, now)
    const fast = requiredWeeklyRate(90, 85, now + 14 * DAY, now)
    expect(fast!).toBeGreaterThan(slow!)
  })

  it('returns null once the weigh-in date has passed', () => {
    expect(requiredWeeklyRate(90, 85, now - DAY, now)).toBeNull()
  })

  it('returns null the day of the weigh-in itself — no weeks left to spread it over', () => {
    expect(requiredWeeklyRate(90, 85, now, now)).toBeNull()
  })

  it('returns exactly 0 when the target equals current weight (a maintain goal)', () => {
    expect(requiredWeeklyRate(85, 85, now + 28 * DAY, now)).toBe(0)
  })

  it('returns a negative rate for a target above current weight (a gain goal), not null', () => {
    // 85kg -> 90kg (11.023 lb) over exactly 4 weeks — same magnitude as the
    // cut case above, opposite sign, same formula, not a special case.
    const rate = requiredWeeklyRate(85, 90, now + 28 * DAY, now)
    expect(rate).not.toBeNull()
    expect(rate!).toBeCloseTo(-(5 * 2.20462262) / 4, 4)
  })
})

describe('macroSplit', () => {
  it('sets protein from bodyweight and lets carbs absorb the remainder', () => {
    const result = macroSplit(2259, 80)
    expect(result.proteinG).toBeCloseTo(176, 6)
    expect(result.fatG).toBeCloseTo(62.75, 2)
    // The four numbers must reconcile: kcal == 4p + 4c + 9f.
    const reconciled = 4 * result.proteinG + 4 * result.carbsG + 9 * result.fatG
    expect(reconciled).toBeCloseTo(2259, 1)
  })

  it('floors carbs at zero rather than going negative when the budget is too tight', () => {
    // Heavy athlete, very low target — protein + fat alone can exceed it.
    const result = macroSplit(1200, 100)
    expect(result.carbsG).toBe(0)
    expect(result.proteinG + result.fatG).toBeGreaterThan(0)
  })

  it('keeps fat from dropping below the per-kg floor even on a very low-calorie target', () => {
    const result = macroSplit(900, 90)
    expect(result.fatG).toBeGreaterThanOrEqual(0.6 * 90 - 1e-9)
  })
})

describe('constants stay the documented values', () => {
  it('KCAL_PER_POUND is the standard 3500 estimate', () => {
    expect(KCAL_PER_POUND).toBe(3500)
  })
})

describe('bmi / bmiCategory', () => {
  it('computes kg / m^2', () => {
    // 80kg at 180cm -> 80 / 1.8^2
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2)
  })

  it('categorizes across all four bands', () => {
    expect(bmiCategory(17)).toBe('Underweight')
    expect(bmiCategory(22)).toBe('Normal')
    expect(bmiCategory(27)).toBe('Overweight')
    expect(bmiCategory(32)).toBe('Obese')
  })

  it('treats the band boundaries as inclusive on the lower edge', () => {
    expect(bmiCategory(18.5)).toBe('Normal')
    expect(bmiCategory(25)).toBe('Overweight')
    expect(bmiCategory(30)).toBe('Obese')
  })
})

describe('safeMaxWeeklyLossLb', () => {
  it('is 1.5% of current bodyweight, the NWCA-certified max sustained rate', () => {
    // 80kg -> 176.37 lb, 1.5% of that
    expect(safeMaxWeeklyLossLb(80)).toBeCloseTo(176.3698 * 0.015, 2)
  })
})
