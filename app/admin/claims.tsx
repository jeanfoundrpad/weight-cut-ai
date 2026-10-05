import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  approveClaimRequest, displayCase, isAdmin, pendingClaimRequests, rejectClaimRequest, type ClaimRequest,
} from '../../lib/fightersClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function RequestCard({
  r, theme, responding, onRespond,
}: {
  r: ClaimRequest
  theme: ReturnType<typeof useTheme>
  responding: boolean
  onRespond: (id: string, approve: boolean) => void
}) {
  const isNewProfile = r.fighterSlug == null
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <Text style={[type.label, { color: theme.textMuted }]}>{isNewProfile ? 'New profile' : 'Claiming existing profile'}</Text>
      <Text style={[type.bodyStrong, { color: theme.text, marginTop: spacing.xs }]}>
        {displayCase(isNewProfile ? r.requestedName : r.fighterName)}
      </Text>
      {!isNewProfile && r.fighterGym ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{displayCase(r.fighterGym)}</Text>
      ) : null}
      <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>Requested {dateLabel(r.createdAtMs)}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          disabled={responding}
          onPress={() => onRespond(r.id, true)}
          style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: responding ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Approve</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={responding}
          onPress={() => onRespond(r.id, false)}
          style={{ flex: 1, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', opacity: responding ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Reject</Text>
        </Pressable>
      </View>
    </View>
  )
}

/**
 * Every fighter-profile claim now goes through here before it takes
 * effect (0036) -- per Jean directly, after a real mistaken claim during
 * testing showed the old instant self-claim flow had no verification at
 * all. Gated on profiles.is_admin, checked server-side by every RPC this
 * screen calls regardless of what the client shows -- this client-side
 * check is just so a non-admin sees a clear message instead of a raw
 * permission error.
 */
export default function AdminClaims() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [requests, setRequests] = useState<ClaimRequest[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void isAdmin().then((ok) => {
      setAllowed(ok)
      if (ok) void pendingClaimRequests().then(setRequests)
    })
  }, [])

  useFocusEffect(refresh)

  async function respond(id: string, approve: boolean) {
    if (respondingId) return
    setRespondingId(id)
    const { ok, error } = approve ? await approveClaimRequest(id) : await rejectClaimRequest(id)
    setRespondingId(null)
    if (ok) {
      refresh()
    } else {
      Alert.alert("Couldn't do that", error ?? 'Try again.')
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Claim requests</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      {allowed === false ? (
        <Text style={[type.body, { color: theme.textMuted, padding: spacing.lg }]}>You don't have access to this.</Text>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
          ListEmptyComponent={
            <Text style={[type.body, { color: theme.textMuted, textAlign: 'center', marginTop: spacing.xl }]}>
              {allowed === null ? 'Loading…' : 'No pending requests.'}
            </Text>
          }
          renderItem={({ item }) => (
            <RequestCard r={item} theme={theme} responding={respondingId === item.id} onRespond={respond} />
          )}
        />
      )}
    </View>
  )
}
