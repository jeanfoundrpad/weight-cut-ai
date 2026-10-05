import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { putSetting, setting } from './repo'

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 }

/**
 * Monochrome by default: black/white/gray for chrome, layout, and text
 * everywhere. A small, fixed set of accent colors is deliberately carved
 * out for the handful of places color actually carries meaning (a streak,
 * a trend line, telling four rings apart, showing progress toward a goal)
 * — each chosen from the dataviz skill's validated palette and checked
 * with its validator script against these exact app surfaces (lightness
 * band, chroma floor, CVD separation, normal-vision floor, contrast — both
 * modes). This is still a bounded list, not a general "add more color"
 * opening: buttons, cards, and every other surface stay monochrome.
 */
const dark = {
  bg: '#0B0B0F',
  surface: '#17171D',
  surfaceRaised: '#202028',
  border: '#2A2A33',
  text: '#F5F5F7',
  textMuted: '#9A9AA5',
  textFaint: '#5C5C66',
  /** Primary action fill — text-on-bg inverted, not a separate brand color. */
  primary: '#F5F5F7',
  onPrimary: '#0B0B0F',
  /** Reserved for genuine problems (validation errors, safety-floor warnings) — never decorative. */
  danger: '#FF5C5C',
  /** Streak flame (Today, Progress). */
  accentFlame: '#d95926',
  /** Weight-trend line (Progress) and the calorie ring (Today) — same hue, both "the primary metric." */
  accentLine: '#3987e5',
  /** Macro-ring identity colors (Today) — distinct from accentFlame since the streak badge and these rings share a screen. */
  accentProtein: '#199e70',
  accentCarbs: '#c98500',
  accentFat: '#d55181',
  isDark: true,
}

const light = {
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceRaised: '#F2F2F5',
  border: '#E4E4E9',
  text: '#15151A',
  textMuted: '#6B6B75',
  textFaint: '#A6A6AF',
  primary: '#15151A',
  onPrimary: '#FAFAFA',
  danger: '#D63B3B',
  accentFlame: '#eb6834',
  accentLine: '#2a78d6',
  accentProtein: '#1baf7a',
  accentCarbs: '#eda100',
  accentFat: '#e87ba4',
  isDark: false,
}

export type Theme = typeof dark

/**
 * Low-to-high "meter" colors (weight-progress bar, the Progress tab icon's
 * bars) — the dataviz skill's fixed status palette (critical/serious/
 * warning/good), reused here for its real intended purpose: showing where
 * a value sits on a bad-to-good scale. Mode-invariant by design (the skill
 * documents these as "fixed — never themed"), unlike every other accent
 * above.
 */
export const meterColors = {
  low: '#d03b3b',
  mid1: '#ec835a',
  mid2: '#fab219',
  high: '#0ca30c',
}

export type ThemePreference = 'system' | 'light' | 'dark'
const THEME_PREFERENCE_KEY = 'theme.preference.v1'

const ThemePreferenceContext = createContext<{
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
}>({ preference: 'light', setPreference: () => {} })

/**
 * Wraps the whole app (see app/_layout.tsx) so every screen's useTheme()
 * reacts live to a change made from Profile, not just on next app launch.
 * Loads the persisted choice once on mount via the existing settings
 * key-value store — same pattern as ONBOARDING_DONE_KEY, no new storage
 * mechanism needed for a single string preference.
 *
 * Defaults to 'light', not 'system' — Jean's explicit call ("I want the
 * white background to be the main color"): the app's own first
 * impression is the white/light look regardless of the device's OS theme,
 * not whatever the phone happens to be set to. Dark and System stay
 * available from Profile's theme picker for whoever wants them.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('light')

  useEffect(() => {
    void setting(THEME_PREFERENCE_KEY, 'light').then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v)
    })
  }, [])

  function setPreference(p: ThemePreference) {
    setPreferenceState(p)
    void putSetting(THEME_PREFERENCE_KEY, p)
  }

  return <ThemePreferenceContext.Provider value={{ preference, setPreference }}>{children}</ThemePreferenceContext.Provider>
}

/** For the Profile screen's theme picker — everywhere else just wants the resolved colors from useTheme(). */
export function useThemePreference() {
  return useContext(ThemePreferenceContext)
}

export function useTheme(): Theme {
  const scheme = useColorScheme()
  const { preference } = useThemePreference()
  const isDark = preference === 'system' ? scheme !== 'light' : preference === 'dark'
  return isDark ? dark : light
}

export const type = {
  title: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6 },
  heading: { fontSize: 20, fontWeight: '700' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '700' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
}
