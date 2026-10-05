import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Sharing from 'expo-sharing'
import { deleteAccount } from '../../lib/accountClient'
import { ageFromBirthDate } from '../../lib/dateMath'
import { isAdmin } from '../../lib/fightersClient'
import { disablePushNotifications, getNotificationPreference, registerForPushNotifications } from '../../lib/notifications'
import { claimPendingReferral, myReferralCode, referralLinkFor } from '../../lib/referralClient'
import {
  EXCLUDE_EXERCISE_CALORIES_KEY, exportAllData, importAllData, loadProfile, putSetting, setting,
  wipeAllLocalData, type Profile,
} from '../../lib/repo'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme, useThemePreference, type ThemePreference } from '../../lib/theme'
import { OptionRow } from '../../lib/components/OptionRow'
import { CM_TO_IN, KG_TO_LB } from '../../lib/units'

const SEX_LABEL: Record<Profile['sex'], string> = {
  male: 'Male',
  female: 'Female',
  unspecified: 'Prefer not to say',
}

function Row({ label, value, theme, last }: { label: string; value: string; theme: ReturnType<typeof useTheme>; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.border,
      }}
    >
      <Text style={[type.body, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{value}</Text>
    </View>
  )
}

export default function ProfileScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [excludeExerciseCalories, setExcludeExerciseCaloriesState] = useState(false)
  const [notifyOnResult, setNotifyOnResult] = useState(false)
  const [savingNotify, setSavingNotify] = useState(false)
  const [admin, setAdmin] = useState(false)

  useFocusEffect(
    useCallback(() => {
      let alive = true
      // Best-effort retry: if the referral claim silently no-op'd right
      // after signup (no live session yet, e.g. "confirm email" is on),
      // this picks it back up once a real session exists. No-ops instantly
      // if there's nothing pending.
      void claimPendingReferral()
      void Promise.all([loadProfile(), myReferralCode(), setting(EXCLUDE_EXERCISE_CALORIES_KEY, 'false')]).then(
        ([p, r, excludeSetting]) => {
          if (!alive) return
          setProfile(p)
          setReferralCode(r)
          setExcludeExerciseCaloriesState(excludeSetting === 'true')
        },
      )
      void getNotificationPreference().then((v) => {
        if (alive) setNotifyOnResult(v)
      })
      void isAdmin().then((v) => {
        if (alive) setAdmin(v)
      })
      // Onboarding only reaches account.tsx once, on the way through — a
      // device that finished onboarding before a real backend existed (or
      // whose local "onboarding done" flag predates ever signing up) has
      // no way back to account creation otherwise, since the main tabs
      // never link to it. This surfaces that state instead of silently
      // leaving every backend-dependent feature (groups, scans, referrals)
      // quietly no-op forever.
      if (supabaseConfigured && supabase) {
        void supabase.auth.getUser().then(({ data }) => {
          if (!alive) return
          setSignedIn(data.user != null)
          setUserEmail(data.user?.email ?? null)
        })
      } else {
        setSignedIn(null)
      }
      return () => {
        alive = false
      }
    }, []),
  )

  async function toggleNotifyOnResult(next: boolean) {
    if (savingNotify) return
    setSavingNotify(true)
    if (next) {
      const { ok, error } = await registerForPushNotifications()
      setSavingNotify(false)
      if (ok) {
        setNotifyOnResult(true)
      } else {
        Alert.alert("Couldn't turn that on", error ?? 'Try again.')
      }
    } else {
      const { ok } = await disablePushNotifications()
      setSavingNotify(false)
      if (ok) setNotifyOnResult(false)
    }
  }

  // Local data deliberately is NOT wiped here anymore (found as a real
  // bug, Jean testing his own account directly: signing back into the
  // *same* account after signing out lost everything -- body stats, fight
  // goal, history -- with nowhere to recover it from, since none of that
  // is synced to the server). account.tsx's next() now owns the decision
  // of when local data actually needs wiping, by checking whether the
  // account signing in next is actually the one that already owns this
  // device's data (see LOCAL_DATA_OWNER_KEY) -- so switching to a
  // genuinely different account still wipes, but signing back into this
  // one doesn't.
  async function signOut() {
    if (signingOut || !supabase) return
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
      setSignedIn(false)
      setUserEmail(null)
      router.replace('/onboarding')
    } catch (e) {
      console.error('[profile] signOut failed', e)
      Alert.alert('Sign out failed', 'Try again.')
    } finally {
      setSigningOut(false)
    }
  }

  // Apple Guideline 5.1.1(v): account creation requires in-app self-service
  // deletion, not a support-email workaround — this is the one destructive
  // action on this screen that gets its own explicit warning of exactly
  // what's being lost, since "delete your account" is easy to tap without
  // registering it also means every goal, meal, and group membership.
  function promptDeleteAccount() {
    if (deletingAccount || !supabase) return
    Alert.alert(
      'Delete your account?',
      "This permanently deletes your account and everything tied to it: your profile, goals, meal history, and groups. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true)
            try {
              const { ok } = await deleteAccount()
              if (!ok) {
                Alert.alert('Delete failed', 'Try again.')
                return
              }
              // Wiped regardless of what screen the user lands on next —
              // the account is already gone server-side at this point, so
              // leaving local data behind would just be a stale copy of
              // an account that no longer exists.
              await wipeAllLocalData()
              Alert.alert('Account deleted', "We've deleted your account and data.", [
                { text: 'OK', onPress: () => router.replace('/onboarding') },
              ])
            } catch (e) {
              console.error('[profile] deleteAccount failed', e)
              Alert.alert('Delete failed', 'Try again.')
            } finally {
              setDeletingAccount(false)
            }
          },
        },
      ],
    )
  }

  function setExcludeExerciseCalories(exclude: boolean) {
    setExcludeExerciseCaloriesState(exclude)
    void putSetting(EXCLUDE_EXERCISE_CALORIES_KEY, exclude ? 'true' : 'false')
  }

  async function shareReferral() {
    if (!referralCode) return
    await Share.share({
      message: `Train and cut weight with me on Weight Cut AI: ${referralLinkFor(referralCode)} (or enter code ${referralCode})`,
    })
  }

  async function exportData() {
    if (exporting) return
    setExporting(true)
    try {
      const data = await exportAllData()
      const file = new File(Paths.cache, `weight-cut-ai-export-${Date.now()}.json`)
      file.create({ overwrite: true })
      file.write(JSON.stringify(data, null, 2))
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json' })
      } else {
        Alert.alert('Export ready', `Saved to ${file.uri}`)
      }
    } catch (e) {
      console.error('[profile] exportData failed', e)
      Alert.alert('Export failed', "Couldn't export your data. Try again.")
    } finally {
      setExporting(false)
    }
  }

  async function restoreFromBackup() {
    if (importing) return
    const picked = await DocumentPicker.getDocumentAsync({ type: 'application/json' })
    if (picked.canceled || !picked.assets[0]) return

    Alert.alert(
      "Replace this device's data?",
      "This restores everything from the backup file and replaces what's currently on this device. This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            setImporting(true)
            try {
              const text = await new File(picked.assets[0].uri).text()
              const data = JSON.parse(text) as Record<string, unknown>
              await importAllData(data)
              setProfile(await loadProfile())
              Alert.alert('Restored', 'Your data has been restored from the backup.')
            } catch (e) {
              console.error('[profile] restoreFromBackup failed', e)
              Alert.alert('Restore failed', "Couldn't read that file. Make sure it's a Weight Cut AI export.")
            } finally {
              setImporting(false)
            }
          },
        },
      ],
    )
  }

  // Free launch (Jean's call, 2026-09-21) -- no paywall right now, so this
  // is just honest, not a fetched/computed status. See app/_layout.tsx's
  // useLaunchRoute() for the fuller reasoning; swap this back to a real
  // entitlement-derived label once RevenueCat lands.
  const statusLabel = 'Free'

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg, paddingBottom: 140 }}
    >
      <Text style={[type.title, { color: theme.text }]}>Profile</Text>

      {supabaseConfigured && signedIn === true ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg }}>
          <Row label="Account" value={userEmail ?? 'Signed in'} theme={theme} last />
        </View>
      ) : null}

      {supabaseConfigured && signedIn === false ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: theme.danger }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>You're not signed in</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
            Groups, meal scans, and referrals all need a real account.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/onboarding/account?mode=signin')}
            style={{
              marginTop: spacing.md, height: 48, borderRadius: radius.pill, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Sign in</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => router.push('/onboarding/account')} style={{ marginTop: spacing.md, alignSelf: 'center' }}>
            <Text style={[type.body, { color: theme.textMuted }]}>
              New here? <Text style={{ color: theme.primary, fontWeight: '700' }}>Create an account</Text>
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
        <Text style={[type.bodyStrong, { color: theme.text, marginBottom: spacing.sm }]}>Appearance</Text>
        <OptionRow<ThemePreference>
          label="Theme"
          value={themePreference}
          onChange={setThemePreference}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </View>

      <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
        <Text style={[type.bodyStrong, { color: theme.text, marginBottom: spacing.sm }]}>Exercise calories</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginBottom: spacing.sm, lineHeight: 18 }]}>
          Device and app estimates of calories burned commonly run high. Adding an inflated number back
          to your daily budget is a common reason a cut quietly stalls even while you're "in a deficit."
        </Text>
        <OptionRow<'add' | 'exclude'>
          label="When you log exercise"
          value={excludeExerciseCalories ? 'exclude' : 'add'}
          onChange={(v) => setExcludeExerciseCalories(v === 'exclude')}
          options={[
            { value: 'add', label: 'Add to my budget' },
            { value: 'exclude', label: "Don't add" },
          ]}
        />
      </View>

      {profile ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg }}>
          <Row label="Sex" value={SEX_LABEL[profile.sex]} theme={theme} />
          <Row label="Weight" value={`${(profile.weightKg * KG_TO_LB).toFixed(1)} lb`} theme={theme} />
          <Row label="Height" value={`${Math.round(profile.heightCm * CM_TO_IN)} in`} theme={theme} />
          <Row label="Age" value={`${ageFromBirthDate(profile.birthDateMs, Date.now())}`} theme={theme} last />
        </View>
      ) : null}

      {supabaseConfigured && signedIn === true ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Fighter profile</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
            Search the fighter directory and request to link your real fight history to your account. Reviewed before it's approved.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/onboarding/claim', params: { standalone: '1' } })}
            style={{
              marginTop: spacing.md, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Claim your fighter profile</Text>
          </Pressable>
        </View>
      ) : null}

      {supabaseConfigured && signedIn === true ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Fight result notifications</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
            Get notified when your claimed fighter profile's result gets posted.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={savingNotify}
            onPress={() => toggleNotifyOnResult(!notifyOnResult)}
            style={{
              marginTop: spacing.md, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: notifyOnResult ? theme.primary : 'transparent',
              borderWidth: 1, borderColor: notifyOnResult ? theme.primary : theme.border, opacity: savingNotify ? 0.6 : 1,
            }}
          >
            <Text style={[type.bodyStrong, { color: notifyOnResult ? theme.onPrimary : theme.text }]}>
              {notifyOnResult ? 'Notifications on' : 'Turn on notifications'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {admin ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/admin/claims')}
          style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: theme.border }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Review claim requests</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>Admin only</Text>
        </Pressable>
      ) : null}

      {supabaseConfigured && referralCode ? (
        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Invite a training partner</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
            Your code: {referralCode}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={shareReferral}
            style={{
              marginTop: spacing.md, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Share invite</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Your data</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
          One JSON file with everything: meals, weights, goals, water, exercise, and body scans.
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={exportData}
            style={{
              flex: 1, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center', opacity: exporting ? 0.6 : 1,
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>{exporting ? 'Exporting…' : 'Export data'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={importing}
            onPress={restoreFromBackup}
            style={{
              flex: 1, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center', opacity: importing ? 0.6 : 1,
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>{importing ? 'Restoring…' : 'Restore backup'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>Body scan</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
          Log real body fat and lean mass from a DEXA, InBody, or BodPod scan done elsewhere.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/log-body-comp')}
          style={{
            marginTop: spacing.md, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Import a body scan</Text>
        </Pressable>
      </View>

      <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.lg, lineHeight: 18, textAlign: 'center' }]}>
        Weight Cut AI's estimates are AI-generated approximations and may not be accurate. It is not a medical
        device and does not diagnose, treat, cure, or prevent any condition. Consult a registered dietitian or
        healthcare provider before making medical decisions.
      </Text>

      <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg }}>
        <Row label="Subscription" value={statusLabel} theme={theme} last />
      </View>

      {supabaseConfigured && signedIn === true ? (
        <Pressable
          accessibilityRole="button"
          disabled={signingOut}
          onPress={signOut}
          style={{
            marginTop: spacing.md, height: 48, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border,
            alignItems: 'center', justifyContent: 'center', opacity: signingOut ? 0.6 : 1,
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
        </Pressable>
      ) : null}

      {supabaseConfigured && signedIn === true ? (
        <Pressable
          accessibilityRole="button"
          disabled={deletingAccount}
          onPress={promptDeleteAccount}
          style={{ marginTop: spacing.lg, alignSelf: 'center', opacity: deletingAccount ? 0.6 : 1 }}
        >
          <Text style={[type.caption, { color: theme.danger }]}>
            {deletingAccount ? 'Deleting account…' : 'Delete account'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}
