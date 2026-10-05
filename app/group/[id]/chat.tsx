import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { loadFullName, saveFullName } from '../../../lib/accountClient'
import {
  blockUser,
  groupMessages,
  reportMessage,
  sendGroupMessage,
  shareMealToGroup,
  type GroupMessage,
} from '../../../lib/groupsClient'
import { localDateFrom, recentMeals, type MealSummary } from '../../../lib/repo'
import { supabase, supabaseConfigured } from '../../../lib/supabaseClient'
import { radius, spacing, type, useTheme } from '../../../lib/theme'

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function MealShareBubble({ m, theme }: { m: GroupMessage; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: theme.border }}>
      <Text style={[type.caption, { color: theme.textMuted, fontWeight: '700' }]}>Recommended a meal</Text>
      <Text style={[type.bodyStrong, { color: theme.text, marginTop: spacing.xs }]}>{m.mealLabel}</Text>
      <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
        {Math.round(m.mealKcal ?? 0)} kcal · {Math.round(m.mealProteinG ?? 0)}g protein · {Math.round(m.mealCarbsG ?? 0)}g carbs · {Math.round(m.mealFatG ?? 0)}g fat
      </Text>
    </View>
  )
}

function MessageBubble({
  m,
  isMine,
  theme,
  onLongPress,
}: {
  m: GroupMessage
  isMine: boolean
  theme: ReturnType<typeof useTheme>
  onLongPress: () => void
}) {
  return (
    <Pressable onLongPress={isMine ? undefined : onLongPress} style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}>
      <Text style={[type.caption, { color: theme.textFaint, marginBottom: 2 }]}>
        {isMine ? 'You' : m.senderLabel} · {timeLabel(m.createdAtMs)}
      </Text>
      {m.kind === 'meal_share' ? (
        <MealShareBubble m={m} theme={theme} />
      ) : (
        <View
          style={{
            maxWidth: '85%',
            backgroundColor: isMine ? theme.primary : theme.surface,
            borderRadius: radius.lg,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
          }}
        >
          <Text style={[type.body, { color: isMine ? theme.onPrimary : theme.text }]}>{m.body}</Text>
        </View>
      )}
    </Pressable>
  )
}

export default function GroupChat() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [selfId, setSelfId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [showMealPicker, setShowMealPicker] = useState(false)
  const [todaysMeals, setTodaysMeals] = useState<MealSummary[]>([])
  const [displayName, setDisplayName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const listRef = useRef<FlatList<GroupMessage>>(null)

  const load = useCallback(async () => {
    const [msgs, name] = await Promise.all([groupMessages(id), loadFullName()])
    setMessages(msgs)
    setDisplayName(name)
    if (supabaseConfigured && supabase) {
      const { data } = await supabase.auth.getUser()
      setSelfId(data.user?.id ?? null)
    }
  }, [id])

  /** Saves to profiles.full_name (the server-authoritative source send_group_message, 0046, actually labels messages with), not a local-only setting -- this is what fixed the impersonation hole, so it has to be the same field. */
  async function saveDisplayName() {
    const name = nameDraft.trim()
    if (!name) return
    await saveFullName(name)
    setDisplayName(name)
  }

  useFocusEffect(
    useCallback(() => {
      let alive = true
      void load().then(() => {
        if (alive) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50)
      })
      const interval = setInterval(() => {
        if (alive) void load()
      }, 4000)
      return () => {
        alive = false
        clearInterval(interval)
      }
    }, [load]),
  )

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    const ok = await sendGroupMessage(id, body)
    if (!ok) {
      Alert.alert('Message failed', 'Try again.')
      setDraft(body)
    } else {
      await load()
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    }
    setSending(false)
  }

  async function openMealPicker() {
    const meals = await recentMeals(localDateFrom(Date.now()), 20)
    setTodaysMeals(meals)
    setShowMealPicker(true)
  }

  async function pickMeal(m: MealSummary) {
    setShowMealPicker(false)
    const ok = await shareMealToGroup(id, {
      label: m.title,
      kcal: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
    })
    if (ok) {
      await load()
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50)
    } else {
      Alert.alert('Couldn\'t share', 'Try again.')
    }
  }

  function onLongPressMessage(m: GroupMessage) {
    Alert.alert(m.senderLabel, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report message',
        onPress: () => {
          void reportMessage(m.id, `kind:${m.kind}`)
          Alert.alert('Reported', 'Thanks, we\'ll take a look.')
        },
      },
      {
        text: `Block ${m.senderLabel}`,
        style: 'destructive',
        onPress: async () => {
          await blockUser(m.senderId)
          await load()
        },
      },
    ])
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
          <Text style={[type.title, { color: theme.text }]}>Messages</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
            <Text style={[type.body, { color: theme.textMuted }]}>Close</Text>
          </Pressable>
        </View>

        {!displayName ? (
          <View style={{ margin: spacing.lg, padding: spacing.md, backgroundColor: theme.surface, borderRadius: radius.lg, gap: spacing.sm }}>
            <Text style={[type.caption, { color: theme.textMuted }]}>What should teammates see next to your messages?</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Your name"
                placeholderTextColor={theme.textFaint}
                style={{ flex: 1, backgroundColor: theme.bg, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, padding: spacing.sm, color: theme.text }}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!nameDraft.trim()}
                onPress={saveDisplayName}
                style={{ paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: nameDraft.trim() ? 1 : 0.5 }}
              >
                <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          renderItem={({ item }) => (
            <MessageBubble m={item} isMine={item.senderId === selfId} theme={theme} onLongPress={() => onLongPressMessage(item)} />
          )}
          ListEmptyComponent={
            <Text style={[type.caption, { color: theme.textFaint, textAlign: 'center', marginTop: spacing.xl }]}>
              No messages yet. Say hi to the team.
            </Text>
          }
        />

        {showMealPicker ? (
          <View style={{ maxHeight: 260, borderTopWidth: 1, borderColor: theme.border, backgroundColor: theme.surface }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md }}>
              <Text style={[type.label, { color: theme.textMuted }]}>Share a meal you logged today</Text>
              <Pressable onPress={() => setShowMealPicker(false)}>
                <Text style={[type.caption, { color: theme.textMuted }]}>Cancel</Text>
              </Pressable>
            </View>
            <FlatList
              data={todaysMeals}
              keyExtractor={(m) => String(m.id)}
              contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm }}
              ListEmptyComponent={
                <Text style={[type.caption, { color: theme.textFaint, paddingHorizontal: spacing.sm }]}>
                  Nothing logged today yet.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => pickMeal(item)}
                  style={{ backgroundColor: theme.bg, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: theme.border }}
                >
                  <Text style={[type.bodyStrong, { color: theme.text }]}>{item.title}</Text>
                  <Text style={[type.caption, { color: theme.textMuted, marginTop: 2 }]}>
                    {Math.round(item.calories)} kcal · {Math.round(item.proteinG)}g protein
                  </Text>
                </Pressable>
              )}
            />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            padding: spacing.lg,
            paddingBottom: Math.max(spacing.lg, insets.bottom),
            borderTopWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={openMealPicker}
            style={{ width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[type.bodyStrong, { color: theme.text }]}>+</Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the team"
            placeholderTextColor={theme.textFaint}
            style={{
              flex: 1, backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1,
              borderColor: theme.border, paddingHorizontal: spacing.md, color: theme.text,
            }}
            multiline
          />
          <Pressable
            accessibilityRole="button"
            disabled={!draft.trim() || sending}
            onPress={send}
            style={{
              paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: theme.primary,
              alignItems: 'center', justifyContent: 'center', opacity: draft.trim() && !sending ? 1 : 0.5,
            }}
          >
            <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>Send</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
