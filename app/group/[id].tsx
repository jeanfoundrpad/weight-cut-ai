import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, FlatList, Linking, Platform, Pressable, Share, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { attentionFor, groupMemberProgress, inviteLinkFor, myGroups, type Group, type MemberProgress } from '../../lib/groupsClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB } from '../../lib/units'

// Loose enough to catch "looks like an email" vs "everything else is a phone
// number" — this only decides which native compose sheet to open, so it
// doesn't need to be a strict validator.
const EMAIL_LIKE = /\S+@\S+\.\S+/

function daysUntil(ms: number): number {
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000))
}

function MemberRow({ m, theme }: { m: MemberProgress; theme: ReturnType<typeof useTheme> }) {
  const hasTarget = m.weighInTargetKg != null && m.weighInDateMs != null
  const { needsAttention, reason } = attentionFor(m, Date.now())

  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
      <Text style={[type.bodyStrong, { color: theme.text }]}>{m.email ?? 'Member'}</Text>
      {m.currentWeightKg != null ? (
        <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
          {(m.currentWeightKg * KG_TO_LB).toFixed(1)} lbs now
          {hasTarget ? ` → ${(m.weighInTargetKg! * KG_TO_LB).toFixed(1)} lbs` : ''}
          {hasTarget ? `, ${daysUntil(m.weighInDateMs!)} days left` : ''}
        </Text>
      ) : (
        <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>No weigh-in logged yet</Text>
      )}
      <Text
        style={[
          type.caption,
          { color: needsAttention ? theme.danger : theme.textMuted, marginTop: spacing.xs, fontWeight: '700' },
        ]}
      >
        {needsAttention ? reason : 'Up to date'}
      </Text>
    </View>
  )
}

export default function GroupDetail() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [group, setGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<MemberProgress[]>([])
  const [contact, setContact] = useState('')

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void Promise.all([myGroups(), groupMemberProgress(id)]).then(([groups, progress]) => {
        if (!alive) return
        setGroup(groups.find((g) => g.id === id) ?? null)
        setMembers(progress)
      })
      return () => {
        alive = false
      }
    }, [id]),
  )

  function inviteMessage(): string {
    if (!group) return ''
    return `Join my weight-cut group "${group.name}" on Weight Cut AI: ${inviteLinkFor(group.inviteCode)} (or enter code ${group.inviteCode})`
  }

  // The !group guards below are only reachable in the brief window before
  // myGroups()/groupMemberProgress() resolve on mount — but a silent no-op
  // there is exactly the "I tapped it and nothing happened" bug class that
  // caused real confusion tonight (the share button looked broken when the
  // actual cause was myGroups() returning empty). A brief, honest message
  // costs nothing and rules out "is this button broken" as a question.
  async function shareInvite() {
    if (!group) {
      Alert.alert('Still loading', "Give it a second and try again.")
      return
    }
    await Share.share({ message: inviteMessage() })
  }

  // Native share sheet — kept alongside real in-app messaging (see
  // group/[id]/chat.tsx) as the true zero-effort broadcast option: no typing,
  // no app-open required from the recipient, works over the fighter's own
  // texts. Real chat covers back-and-forth; this covers the "one tap update"
  // case chat doesn't.
  async function shareTeamUpdate() {
    if (!group) {
      Alert.alert('Still loading', "Give it a second and try again.")
      return
    }
    const upToDate = members.filter((m) => !attentionFor(m, Date.now()).needsAttention).length
    await Share.share({
      message: `Update from "${group.name}" on Weight Cut AI: ${upToDate} of ${members.length} teammates are on track this week.`,
    })
  }

  // Opens the fighter's own Messages/Mail app pre-filled with the invite —
  // no server, no third-party SMS/email API, no cost or delivery/consent
  // surface, since it's sent from the fighter's own number or account, same
  // as if they'd copy-pasted it themselves.
  async function inviteContact() {
    const target = contact.trim()
    if (!target) return
    if (!group) {
      Alert.alert('Still loading', "Give it a second and try again.")
      return
    }

    const message = inviteMessage()
    const url = EMAIL_LIKE.test(target)
      ? `mailto:${target}?subject=${encodeURIComponent('Join me on Weight Cut AI')}&body=${encodeURIComponent(message)}`
      : `sms:${target}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`

    const canOpen = await Linking.canOpenURL(url)
    if (!canOpen) {
      Alert.alert('Nothing to send with', "Couldn't find a Messages or Mail app to open on this device.")
      return
    }
    await Linking.openURL(url)
    setContact('')
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>{group?.name ?? 'Group'}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
        </Pressable>
      </View>

      {members.length > 0 ? (
        <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg }}>
          <Text style={[type.label, { color: theme.textMuted }]}>Team momentum</Text>
          {(() => {
            const upToDate = members.filter((m) => !attentionFor(m, Date.now()).needsAttention).length
            const pct = (upToDate / members.length) * 100
            return (
              <>
                <Text style={[type.bodyStrong, { color: theme.text, fontSize: 20, marginTop: spacing.xs }]}>
                  {upToDate} of {members.length} on track
                </Text>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.border, marginTop: spacing.sm, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${pct}%`, backgroundColor: theme.text, borderRadius: 3 }} />
                </View>
              </>
            )
          })()}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.lg }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/group/${id}/chat`)}
          style={{
            flex: 1, height: 52, borderRadius: radius.pill,
            backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Messages</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={shareInvite}
          style={{
            flex: 1, height: 52, borderRadius: radius.pill,
            borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={[type.bodyStrong, { color: theme.text }]}>Share invite</Text>
        </Pressable>
        {members.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={shareTeamUpdate}
            style={{
              flex: 1, height: 52, borderRadius: radius.pill,
              borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>Share update</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg }}>
        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>
          Add your coach or nutritionist
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TextInput
            value={contact}
            onChangeText={setContact}
            placeholder="Phone number or email"
            placeholderTextColor={theme.textFaint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1,
              borderColor: theme.border, padding: spacing.md, color: theme.text,
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!contact.trim()}
            onPress={inviteContact}
            style={{
              paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center', opacity: contact.trim() ? 1 : 0.5,
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Invite</Text>
          </Pressable>
        </View>
        <Text style={[type.caption, { color: theme.textFaint, marginTop: spacing.xs }]}>
          Opens a text or email, already written, from your own phone.
        </Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(m) => m.userId}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        renderItem={({ item }) => <MemberRow m={item} theme={theme} />}
      />
    </View>
  )
}
