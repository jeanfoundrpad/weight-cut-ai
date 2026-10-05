// Pure date math, deliberately kept free of any React Native / expo-sqlite
// imports — repo.ts pulls in native modules that plain Node test runners
// (vitest) can't parse, so anything that needs to be unit-testable in
// isolation lives here instead, same reasoning as weightCutMath.ts.

/** Calendar-accurate age (accounts for whether this year's birthday has happened yet), not a year-subtraction approximation. */
export function ageFromBirthDate(birthDateMs: number, nowMs: number): number {
  const birth = new Date(birthDateMs)
  const now = new Date(nowMs)
  let age = now.getFullYear() - birth.getFullYear()
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hadBirthdayThisYear) age -= 1
  return age
}
