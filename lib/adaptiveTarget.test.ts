import { describe, expect, it } from 'vitest'
import { recalibrateTarget, type IntakeDay } from './adaptiveTarget'
import type { WeightPoint } from './trend'

function dateStr(daysAgo: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function intakeRange(days: number, kcal: number): IntakeDay[] {
  return Array.from({ length: days }, (_, i) => ({ localDate: dateStr(days - 1 - i), totalKcal: kcal }))
}

describe('recalibrateTarget', () => {
  it('refuses to recalibrate with too few logged days', () => {
    const weightPoints: WeightPoint[] = [{ localDate: dateStr(0), weightKg: 80 }]
    const result = recalibrateTarget(weightPoints, intakeRange(3, 2000), 2500, 500, 2000, 1500)
    expect(result.hasEnoughData).toBe(false)
    expect(result.newTargetKcal).toBe(2000)
  })

  it('refuses to recalibrate without matching weight-trend data', () => {
    const weightPoints: WeightPoint[] = [] // no weigh-ins at all
    const result = recalibrateTarget(weightPoints, intakeRange(7, 2000), 2500, 500, 2000, 1500)
    expect(result.hasEnoughData).toBe(false)
    expect(result.reason).toMatch(/weight/i)
  })

  it('leaves the target unchanged when logged intake matches the formula maintenance exactly', () => {
    // 14 days, flat trend weight, average intake == formula maintenance -> implied TDEE == formula TDEE, no change.
    const weightPoints: WeightPoint[] = Array.from({ length: 14 }, (_, i) => ({ localDate: dateStr(13 - i), weightKg: 80 }))
    const result = recalibrateTarget(weightPoints, intakeRange(14, 2500), 2500, 500, 2000, 1500)
    expect(result.hasEnoughData).toBe(true)
    expect(result.blendedTdeeKcal).toBeCloseTo(2500, 0)
    expect(result.newTargetKcal).toBeCloseTo(2000, 0)
    expect(result.isMaterialChange).toBe(false)
  })

  it('raises the target when the athlete is losing weight faster than the formula predicted (real TDEE is higher)', () => {
    // Ate 2000 kcal/day for 14 days, formula predicted maintenance 2500 (so a 500 kcal deficit was intended),
    // but actually lost 3.5kg over the window -> real TDEE is well above 2500, so more food is needed to hit the SAME deficit.
    const weightPoints: WeightPoint[] = [
      { localDate: dateStr(13), weightKg: 83.5 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const result = recalibrateTarget(weightPoints, intakeRange(14, 2000), 2500, 500, 2000, 1500)
    expect(result.hasEnoughData).toBe(true)
    expect(result.impliedTdeeKcal).toBeGreaterThan(2500)
    expect(result.newTargetKcal).toBeGreaterThan(2000)
    expect(result.isMaterialChange).toBe(true)
    expect(result.deltaKcal).toBeGreaterThan(0)
  })

  it('lowers the target when weight loss stalled despite an intended deficit (real TDEE is lower)', () => {
    // Same intended 500 kcal deficit off a 2500 formula maintenance, but weight barely moved -> real TDEE is lower than 2500.
    const weightPoints: WeightPoint[] = [
      { localDate: dateStr(13), weightKg: 80.1 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const result = recalibrateTarget(weightPoints, intakeRange(14, 2000), 2500, 500, 2000, 1500)
    expect(result.hasEnoughData).toBe(true)
    expect(result.impliedTdeeKcal).toBeLessThan(2500)
    expect(result.newTargetKcal).toBeLessThan(2000)
    expect(result.isMaterialChange).toBe(true)
  })

  it('never recommends below the safety floor, even if implied TDEE would otherwise call for it', () => {
    const weightPoints: WeightPoint[] = [
      { localDate: dateStr(13), weightKg: 80.05 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    // Huge intended deficit off a low formula maintenance -> raw target would fall well under the floor.
    const result = recalibrateTarget(weightPoints, intakeRange(14, 1400), 1800, 1000, 1400, 1500)
    expect(result.newTargetKcal).toBeGreaterThanOrEqual(1500)
    expect(result.wasFloorClamped).toBe(true)
  })

  it('weights the blend more toward the implied TDEE as more days of data accumulate', () => {
    const weightPointsFor = (days: number): WeightPoint[] => [
      { localDate: dateStr(days - 1), weightKg: 83.5 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const short = recalibrateTarget(weightPointsFor(5), intakeRange(5, 2000), 2500, 500, 2000, 1500)
    const long = recalibrateTarget(weightPointsFor(14), intakeRange(14, 2000), 2500, 500, 2000, 1500)
    expect(short.confidence).toBeLessThan(long.confidence)
    // Both pull the target up (real TDEE > formula), but more data pulls it further toward the implied value.
    expect(long.newTargetKcal).toBeGreaterThan(short.newTargetKcal)
  })

  it('caps confidence below 1 even with a large data window, as a guardrail against one noisy stretch', () => {
    const weightPoints: WeightPoint[] = [
      { localDate: dateStr(29), weightKg: 87 },
      { localDate: dateStr(0), weightKg: 80 },
    ]
    const result = recalibrateTarget(weightPoints, intakeRange(30, 2000), 2500, 500, 2000, 1500)
    expect(result.confidence).toBeLessThan(1)
    // Formula estimate should still carry some weight, so blended TDEE shouldn't fully equal the implied one.
    expect(result.blendedTdeeKcal).not.toBeCloseTo(result.impliedTdeeKcal!, 0)
  })
})
