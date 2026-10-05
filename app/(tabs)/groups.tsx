import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { displayCase } from '../../lib/fightersClient'
import {
  allConnections, createGroup, joinGroupByCode, myGroups, myPendingInvites, respondToCutTogetherInvite,
  type Connection, type Group, type PendingInvite,
} from '../../lib/groupsClient'
import { supabaseConfigured } from '../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB } from '../../lib/units'

function ConnectionRow({ c, theme }: { c: Connection; theme: ReturnType<typeof useTheme> }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/group/[id]', params: { id: c.groupId } })}
      style={{
        backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg,
        borderWidth: c.needsAttention ? 1 : 0, borderColor: theme.danger,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>{c.email ?? 'Member'}</Text>
          <Text style={[type.caption, { color: theme.textFaint, marginTop: 2 }]}>{c.groupName}</Text>
        </View>
        {c.currentWeightKg != null ? (
          <Text style={[type.caption, { color: theme.textMuted }]}>{(c.currentWeightKg * KG_TO_LB).toFixed(1)} lbs</Text>
        ) : null}
      </View>
      <Text
        style={[type.caption, { color: c.needsAttention ? theme.danger : theme.textMuted, marginTop: spacing.xs, fontWeight: '700' }]}
      >
        {c.needsAttention ? c.attentionReason : 'Up to date'}
      </Text>
    </Pressable>
  )
}

function InviteRow({
  invite, theme, responding, onRespond,
}: {
  invite: PendingInvite
  theme: ReturnType<typeof useTheme>
  responding: boolean
  onRespond: (id: string, accept: boolean) => void
}) {
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: theme.primary }}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>
        {displayCase(invite.inviterFighterName) ?? 'Someone'} wants to cut together
      </Text>
      <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>{invite.groupName}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable
          accessibilityRole="button"
          disabled={responding}
          onPress={() => onRespond(invite.id, true)}
          style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: responding ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Accept</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={responding}
          onPress={() => onRespond(invite.id, false)}
          style={{ flex: 1, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center', opacity: responding ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Decline</Text>
        </Pressable>
      </View>
    </View>
  )
}

export default function GroupsScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [groups, setGroups] = useState<Group[]>([])
  const [connections, setConnections] = useState<Connection[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void myGroups().then(setGroups)
    void allConnections().then(setConnections)
    void myPendingInvites().then(setInvites)
  }, [])

  useFocusEffect(refresh)

  async function respondToInvite(id: string, accept: boolean) {
    if (respondingId) return
    setRespondingId(id)
    const { ok, error } = await respondToCutTogetherInvite(id, accept)
    setRespondingId(null)
    if (ok) {
      refresh()
    } else {
      Alert.alert("Couldn't respond to that invite", error ?? 'Try again.')
    }
  }

  async function create() {
    if (!newGroupName.trim() || busy) return
    setBusy(true)
    const group = await createGroup(newGroupName.trim())
    setBusy(false)
    if (group) {
      setNewGroupName('')
      setGroups((g) => [...g, group])
      router.push({ pathname: '/group/[id]', params: { id: group.id } })
    } else {
      // Without this, a failed create (not signed in, network error, RPC
      // failure) looked identical to a successful tap that just did
      // nothing — the exact "is this broken?" confusion that cost real
      // time to diagnose earlier tonight.
      Alert.alert("Couldn't create group", "Make sure you're signed in, then try again.")
    }
  }

  async function join() {
    if (!joinCode.trim() || busy) return
    setBusy(true)
    const group = await joinGroupByCode(joinCode.trim())
    setBusy(false)
    if (group) {
      setJoinCode('')
      refresh()
      router.push({ pathname: '/group/[id]', params: { id: group.id } })
    } else {
      Alert.alert("Couldn't join group", "Check the code and make sure you're signed in, then try again.")
    }
  }

  if (!supabaseConfigured) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Groups</Text>
        <View style={{ marginTop: spacing.lg, borderWidth: 1, borderColor: theme.border, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.body, { color: theme.textMuted, lineHeight: 22 }]}>
            Groups need the backend connected (accounts + a shared place to sync progress). See
            backend/README.md. Everything else in the app works without it.
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <Text style={[type.title, { color: theme.text, paddingHorizontal: spacing.lg }]}>Groups</Text>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        ListHeaderComponent={
          <>
            {invites.length > 0 ? (
              <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Invites</Text>
                {invites.map((i) => (
                  <InviteRow key={i.id} invite={i} theme={theme} responding={respondingId === i.id} onRespond={respondToInvite} />
                ))}
              </View>
            ) : null}

            {connections.length > 0 ? (
              <View style={{ marginBottom: spacing.xl }}>
                <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>
                  Your people{connections.some((c) => c.needsAttention) ? ', needs attention' : ''}
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {connections.map((c) => (
                    <ConnectionRow key={`${c.groupId}:${c.userId}`} c={c} theme={theme} />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ marginBottom: spacing.lg }}>
              <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Start a group</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  placeholder="e.g. Downtown Muay Thai"
                  placeholderTextColor={theme.textFaint}
                  style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing.md, color: theme.text }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={create}
                  style={{ paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Create</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ marginBottom: spacing.xl }}>
              <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Join with a code</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput
                  value={joinCode}
                  onChangeText={(v) => setJoinCode(v.toUpperCase())}
                  placeholder="ABC123"
                  placeholderTextColor={theme.textFaint}
                  autoCapitalize="characters"
                  style={{ flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing.md, color: theme.text, letterSpacing: 2 }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={join}
                  style={{ paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={[type.bodyStrong, { color: theme.text }]}>Join</Text>
                </Pressable>
              </View>
            </View>

            {groups.length > 0 ? (
              <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Your groups</Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <Text style={[type.body, { color: theme.textMuted }]}>
            No groups yet. Start one for your gym, or join with a code someone shares with you.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.id } })}
            style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>{item.name}</Text>
            <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>Code: {item.inviteCode}</Text>
          </Pressable>
        )}
      />
    </View>
  )
}
