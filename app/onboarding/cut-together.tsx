import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  displayCase, fightersInMyCutWindow, weightClassLabel, type Fighter,
} from '../../lib/fightersClient'
import { inviteToCutTogether } from '../../lib/groupsClient'
import { currentFightGoal } from '../../lib/repo'
import { supabase, supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB } from '../../lib/units'

function FighterCard({
  f, onInvite, status, theme,
}: {
  f: Fighter
  onInvite: () => void
  status: 'idle' | 'sending' | 'sent' | 'error'
  theme: ReturnType<typeof useTheme>
}) {
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={[type.bodyStrong, { color: theme.text }]}>{displayCase(f.name)}</Text>
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
          {[displayCase(f.gym) ?? 'Gym unknown', f.weightKg != null ? weightClassLabel(f.weightKg) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={status === 'sending' || status === 'sent'}
        onPress={onInvite}
        style={{
          height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
          backgroundColor: status === 'sent' ? theme.surfaceRaised : theme.primary,
        }}
      >
        <Text style={[type.caption, { color: status === 'sent' ? theme.textMuted : theme.onPrimary, fontWeight: '700' }]}>
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Invited' : status === 'error' ? 'Try again' : 'Invite'}
        </Text>
      </Pressable>
    </View>
  )
}

/**
 * The "Cut together" invite flow already existed (fighter/[slug].tsx), but
 * was invisible until someone found their way to another fighter's profile
 * -- per Jean directly, and the code review's own retention research: this
 * makes it part of the actual activation moment, right after signup, while
 * there's still a reason to open the app tomorrow.
 *
 * Only ever reached with a real fight goal already set (claim.tsx's
 * next(), once a fresh fighter signup is done with that screen) -- a
 * coach has no personal cut to match against. Silently skips
 * straight to the app if nobody real turns up (a claimed fighter, not the
 * whole scraped directory -- inviteToCutTogether only works on a real
 * account), rather than showing a dead-end "nobody found" screen during
 * onboarding.
 */
export default function CutTogether() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(true)
  const [fighters, setFighters] = useState<Fighter[]>([])
  const [status, setStatus] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      const goal = await currentFightGoal()
      if (!goal) {
        router.replace('/(tabs)')
        return
      }
      let selfId: string | null = null
      if (supabaseConfigured && supabase) {
        const { data } = await supabase.auth.getUser()
        selfId = data.user?.id ?? null
      }
      const targetWeightLb = goal.weighInTargetKg * KG_TO_LB
      const rows = await fightersInMyCutWindow(targetWeightLb, goal.weighInDateMs)
      const real = rows.filter((f) => f.claimedByUserId != null && f.claimedByUserId !== selfId)
      if (!alive) return
      if (real.length === 0) {
        router.replace('/(tabs)')
        return
      }
      setFighters(real)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  async function invite(slug: string) {
    setStatus((s) => ({ ...s, [slug]: 'sending' }))
    const { ok } = await inviteToCutTogether(slug)
    setStatus((s) => ({ ...s, [slug]: ok ? 'sent' : 'error' }))
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.text} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>
        {fighters.length} fighter{fighters.length === 1 ? ' is' : 's are'} cutting near you
      </Text>
      <Text style={[type.body, { color: theme.textMuted, paddingHorizontal: spacing.lg, marginTop: spacing.xs }]}>
        Same weight class, fighting within 30 days of your date. Invite one to cut together and keep each other honest.
      </Text>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}>
        {fighters.map((f) => (
          <FighterCard key={f.slug} f={f} onInvite={() => invite(f.slug)} status={status[f.slug] ?? 'idle'} theme={theme} />
        ))}
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/(tabs)')}
          style={{ height: 56, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 17 }]}>Continue</Text>
        </Pressable>
      </View>
    </View>
  )
}
