import { StatusBar } from 'expo-status-bar'
import { Stack } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import '../lib/pendingDeepLink'
import { setting } from '../lib/repo'
import { supabase, supabaseConfigured } from '../lib/supabaseClient'
import { ThemeProvider, useTheme } from '../lib/theme'

const ONBOARDING_DONE_KEY = 'onboarding.completed.v1'

type Route = 'onboarding' | 'app'

/**
 * Where to land on launch. Free launch (Jean's call, 2026-09-21): no
 * paywall gate for now, real payments come in a later update. Once
 * onboarding is done, straight to the app -- checkEntitlement() in
 * lib/entitlement.ts still exists for wiring a real entitlement check back
 * in here later.
 *
 * app/paywall.tsx itself was deleted outright (2026-09-29), not just left
 * unreached: it showed a hardcoded "$9.00/month" / "Start free trial"
 * mock, tied to no real StoreKit purchase. Nothing in the app ever
 * navigated to it, but its pricing/trial copy still shipped as plain
 * strings inside the compiled JS bundle either way, and that's very
 * likely what triggered Apple's Guideline 2.1(b) business-model questions
 * on this build (paid-subscription language in the binary with no real
 * In-App Purchase behind it) -- unreachable at runtime isn't unreachable
 * to a binary string scan. Rebuilding it for real once RevenueCat is
 * actually wired in means pulling live pricing from StoreKit rather than
 * hardcoding a number anyway, so nothing of real value was lost by
 * removing the mock now instead of neutering its copy in place.
 *
 * The onboarding-completed flag alone used to be enough to grant 'app' --
 * a real gap (Jean, testing directly): that flag just means this device
 * finished onboarding at some point, it says nothing about whether the
 * session is still valid right now. Sign out already clears it (see
 * profile.tsx's signOut()), but a session can also go stale on its own
 * (a revoked/expired token, or, concretely, this exact project sitting
 * paused for weeks), and the flag stays true through that with nothing
 * to catch it. Every 'app' grant now confirms a real signed-in user
 * first; app/onboarding/index.tsx handles the "flag says done but no
 * session" case by skipping straight to sign in instead of the full
 * onboarding pitch, since this device has clearly done this before.
 */
function useLaunchRoute(): Route | null {
  const [route, setRoute] = useState<Route | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const done = await setting(ONBOARDING_DONE_KEY, '')
      if (!alive) return
      if (done !== 'true') {
        setRoute('onboarding')
        return
      }
      if (supabaseConfigured && supabase) {
        const { data } = await supabase.auth.getUser()
        if (!alive) return
        if (!data.user) {
          setRoute('onboarding')
          return
        }
      }
      setRoute('app')
    })()
    return () => {
      alive = false
    }
  }, [])

  return route
}

function RootNavigator() {
  const theme = useTheme()
  const launchRoute = useLaunchRoute()
  // expo-status-bar was already a dependency but never actually rendered
  // anywhere, so the status bar (clock, wifi, battery) just followed
  // whatever the OS's own dark/light setting happened to be — completely
  // independent of this app's own theme. Someone with their phone in Dark
  // Mode but the app set to Light (the app's own default now) got white
  // status-bar icons on this app's white background: invisible. Tying it
  // directly to `theme.isDark` keeps it legible regardless of what the OS
  // is set to.
  const statusBarStyle = theme.isDark ? 'light' : 'dark'

  if (launchRoute === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg, gap: 20, paddingHorizontal: 40 }}>
        <StatusBar style={statusBarStyle} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: theme.text, textAlign: 'center', letterSpacing: -0.4 }}>
          If you ain't trackin, you slackin.
        </Text>
        <ActivityIndicator color={theme.text} />
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false }} initialRouteName={launchRoute === 'app' ? '(tabs)' : launchRoute}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="log-weight" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-exercise" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-body-comp" options={{ presentation: 'modal' }} />
        <Stack.Screen name="log-recent" options={{ presentation: 'modal' }} />
        <Stack.Screen name="fight-week" options={{ presentation: 'modal' }} />
        <Stack.Screen name="meal-plan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="group/[id]" />
        <Stack.Screen name="group/[id]/chat" options={{ presentation: 'modal' }} />
        <Stack.Screen name="fighter/[slug]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="fighter/edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="fighter/add-fight" options={{ presentation: 'modal' }} />
        <Stack.Screen name="gym/[name]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="weight-class/[lb]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="admin/claims" options={{ presentation: 'modal' }} />
        <Stack.Screen name="join/[code]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="refer/[code]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="reset-password" options={{ presentation: 'modal', gestureEnabled: false }} />
        <Stack.Screen name="day/[date]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="range" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pick-date" options={{ presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  )
}

/**
 * ThemeProvider wraps everything so a theme change made from Profile
 * re-renders every already-mounted screen immediately via context, rather
 * than only taking effect after the app restarts.
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  )
}

export { ONBOARDING_DONE_KEY }
