import { describe, expect, it } from 'vitest'
import { ageFromBirthDate } from './dateMath'

// Built with new Date(year, month, day) rather than ISO 'Z' strings, matching
// how the native date picker actually produces a Date (local calendar
// fields) — using UTC timestamps here would make this test's pass/fail
// depend on the machine's timezone, since ageFromBirthDate reads local
// getMonth()/getDate().
describe('ageFromBirthDate', () => {
  it('counts a full year once the birthday has passed', () => {
    const birth = new Date(1998, 2, 10).getTime() // March 10, 1998
    const now = new Date(2026, 2, 15).getTime() // March 15, 2026
    expect(ageFromBirthDate(birth, now)).toBe(28)
  })

  it('counts the birthday itself as already turned', () => {
    const birth = new Date(1998, 2, 10).getTime()
    const now = new Date(2026, 2, 10).getTime()
    expect(ageFromBirthDate(birth, now)).toBe(28)
  })

  it('has not incremented yet the day before the birthday', () => {
    const birth = new Date(1998, 2, 10).getTime()
    const now = new Date(2026, 2, 9).getTime()
    expect(ageFromBirthDate(birth, now)).toBe(27)
  })

  it('handles a birth month later in the year than the current month', () => {
    const birth = new Date(1998, 10, 20).getTime() // November 20, 1998
    const now = new Date(2026, 1, 1).getTime() // February 1, 2026
    expect(ageFromBirthDate(birth, now)).toBe(27)
  })
})
