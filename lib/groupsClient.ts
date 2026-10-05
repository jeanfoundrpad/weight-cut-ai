import * as Linking from 'expo-linking'
import { currentFightGoal, weightHistory } from './repo'
import { supabase, supabaseConfigured } from './supabaseClient'

/**
 * All of this gracefully no-ops when Supabase isn't configured yet — same
 * reasoning as entitlement.ts/aiProxy.ts. Groups are the one feature that
 * fundamentally CAN'T be meaningfully mocked locally (the whole point is
 * seeing other people's data), so until a real backend exists these
 * functions just return empty results rather than fake data that would be
 * actively misleading.
 */

function randomInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I — easy to misread aloud
  let code = ''
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}

export function inviteLinkFor(code: string): string {
  return Linking.createURL(`join/${code}`)
}

export interface Group {
  id: string
  name: string
  inviteCode: string
}

export async function createGroup(name: string): Promise<Group | null> {
  if (!supabaseConfigured || !supabase) return null

  // A plain insert().select() here compiles to INSERT ... RETURNING, and
  // Postgres RLS applies the groups SELECT policy to that RETURNING output
  // — which requires an existing group_members row the caller doesn't have
  // yet at insert time. Same chicken-and-egg problem join_group_by_code
  // solves for joining; create_group() (0004_fix_create_group.sql) is the
  // security-definer equivalent for creating, doing both inserts
  // atomically before any SELECT policy gets evaluated.
  const inviteCode = randomInviteCode()
  const { data, error } = await supabase.rpc('create_group', { p_name: name, p_invite_code: inviteCode })
  if (error || !data || data.length === 0) return null

  const group = data[0]
  return { id: group.id, name: group.name, inviteCode: group.invite_code }
}

export async function joinGroupByCode(code: string): Promise<Group | null> {
  if (!supabaseConfigured || !supabase) return null
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return null

  // Plain select-by-code can't work here: the groups SELECT policy requires
  // existing membership, which a joiner by definition doesn't have yet. The
  // join_group_by_code() function (security definer) does the lookup +
  // membership insert atomically instead. See 0002_groups.sql.
  const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code.toUpperCase() })
  if (error || !data || data.length === 0) return null

  const group = data[0]
  return { id: group.id, name: group.name, inviteCode: group.invite_code }
}

export async function myGroups(): Promise<Group[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  // Two plain queries, not one embedded select('groups(...)') off
  // group_members — PostgREST/Postgres RLS returns an RLS-denied embedded
  // resource as null rather than excluding the parent row, and this
  // previously fed that null straight into a .filter(g => g != null),
  // silently dropping groups a member should be able to see. A direct
  // select on `groups` applies its own SELECT policy normally (no embed
  // involved), which doesn't have that ambiguity.
  const { data: memberships } = await supabase.from('group_members').select('group_id').eq('user_id', userData.user.id)
  if (!memberships || memberships.length === 0) return []

  const { data } = await supabase
    .from('groups')
    .select('id, name, invite_code')
    .in('id', memberships.map((m) => m.group_id))
  if (!data) return []
  return data.map((g) => ({ id: g.id, name: g.name, inviteCode: g.invite_code }))
}

export interface MemberProgress {
  userId: string
  email: string | null
  currentWeightKg: number | null
  weighInTargetKg: number | null
  weighInDateMs: number | null
  lastUpdatedMs: number | null
}

export async function groupMemberProgress(groupId: string): Promise<MemberProgress[]> {
  if (!supabaseConfigured || !supabase) return []

  const { data: members } = await supabase.from('group_members').select('user_id').eq('group_id', groupId)
  if (!members || members.length === 0) return []
  const userIds = members.map((m) => m.user_id)

  const { data: snapshots } = await supabase
    .from('progress_snapshots')
    .select('user_id, current_weight_kg, weigh_in_target_kg, weigh_in_date, updated_at')
    .in('user_id', userIds)

  return userIds.map((userId) => {
    const s = snapshots?.find((row) => row.user_id === userId)
    return {
      userId,
      email: null, // Supabase Auth user emails aren't exposed via the anon client by design; a display-name field is a reasonable Phase 2 addition.
      currentWeightKg: s?.current_weight_kg ?? null,
      weighInTargetKg: s?.weigh_in_target_kg ?? null,
      weighInDateMs: s?.weigh_in_date ? new Date(s.weigh_in_date).getTime() : null,
      lastUpdatedMs: s?.updated_at ? new Date(s.updated_at).getTime() : null,
    }
  })
}

const STALE_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000
const CLOSE_TO_WEIGH_IN_DAYS = 7
const LARGE_REMAINING_GAP_FRACTION = 0.03 // 3% of current bodyweight still left to cut

export interface Attention {
  needsAttention: boolean
  reason: string | null
}

/**
 * The two signals below are deliberately the only ones computed, because
 * they're the only ones honestly derivable from what progress_snapshots
 * actually stores (one point-in-time snapshot per user, not a full weight
 * history) — no fabricated "trend," just staleness (the actual TrueCoach
 * "Automated Risk Assessment" signal — compliance dropping) and a real
 * safety signal (large last-minute cut = the dangerous rapid-cut scenario
 * the weight-cut safety research flagged). Shared by the cross-group
 * dashboard and the single-group member list so both agree.
 */
export function attentionFor(m: MemberProgress, now: number): Attention {
  if (m.lastUpdatedMs == null) {
    return { needsAttention: true, reason: "Hasn't logged progress yet" }
  }
  const staleDays = Math.floor((now - m.lastUpdatedMs) / DAY_MS)
  if (staleDays >= STALE_DAYS) {
    return { needsAttention: true, reason: `No update in ${staleDays} days` }
  }
  if (
    m.weighInDateMs != null &&
    m.currentWeightKg != null &&
    m.weighInTargetKg != null &&
    m.weighInDateMs - now <= CLOSE_TO_WEIGH_IN_DAYS * DAY_MS &&
    m.weighInDateMs - now > 0
  ) {
    const remainingKg = m.currentWeightKg - m.weighInTargetKg
    if (remainingKg > m.currentWeightKg * LARGE_REMAINING_GAP_FRACTION) {
      return { needsAttention: true, reason: 'Large cut remaining this close to weigh-in' }
    }
  }
  return { needsAttention: false, reason: null }
}

export interface Connection extends MemberProgress {
  groupId: string
  groupName: string
  needsAttention: boolean
  attentionReason: string | null
}

/**
 * Everyone the signed-in user shares a group with, flattened into one list
 * across every group instead of requiring a coach/buddy to open each group
 * individually — this is the actual gap the research (TrueCoach's
 * "Automated Risk Assessment") pointed at: a coach dashboard is only useful
 * if it surfaces who needs a check-in, not just raw numbers.
 */
export async function allConnections(): Promise<Connection[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []
  const selfId = userData.user.id

  const groups = await myGroups()
  const now = Date.now()
  const seen = new Set<string>()
  const results: Connection[] = []

  for (const g of groups) {
    const members = await groupMemberProgress(g.id)
    for (const m of members) {
      if (m.userId === selfId || seen.has(m.userId)) continue
      seen.add(m.userId)
      const { needsAttention, reason } = attentionFor(m, now)
      results.push({ ...m, groupId: g.id, groupName: g.name, needsAttention, attentionReason: reason })
    }
  }

  // Needs-attention people surface first so a coach with many clients sees
  // who to check on without scanning the whole list.
  return results.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention))
}

/**
 * Push this device's latest weight + fight goal up as the one shared
 * snapshot. Called from onboarding (right after the fight goal is set,
 * before any real weigh-in exists yet) as well as from log-weight.
 *
 * Skips entirely when there's no real weigh-in on this device yet. An
 * earlier version upserted unconditionally, which set `updated_at` to "now"
 * even with `current_weight_kg: null` — that made `attentionFor()`'s
 * "hasn't logged progress yet" check see a fresh-looking row for someone
 * who has never actually weighed in, hiding exactly the people a coach
 * most needs to see. `updated_at` must only ever mean "last real progress
 * update," not "last time this function happened to run."
 */
export async function syncProgressSnapshot(): Promise<void> {
  if (!supabaseConfigured || !supabase) return
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return

  const [points, goal] = await Promise.all([weightHistory(), currentFightGoal()])
  const lastWeight = points[points.length - 1]
  if (!lastWeight) return

  await supabase.from('progress_snapshots').upsert({
    user_id: userData.user.id,
    current_weight_kg: lastWeight.weightKg,
    weigh_in_target_kg: goal?.weighInTargetKg ?? null,
    weigh_in_date: goal ? new Date(goal.weighInDateMs).toISOString() : null,
    updated_at: new Date().toISOString(),
  })
}

/** Whether the signed-in user currently shares their tracked weight on their public fighter profile, if they have one (0029). Off by default. */
export async function shareProgressPublicly(): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false
  const { data } = await supabase.from('progress_snapshots').select('share_publicly').eq('user_id', userData.user.id).maybeSingle()
  return data?.share_publicly ?? false
}

/**
 * Toggles public sharing. Uses upsert rather than update -- a user could
 * flip this on before ever weighing in (no progress_snapshots row exists
 * yet at all, since syncProgressSnapshot() deliberately skips writing one
 * until a real weigh-in exists), and a plain update would silently affect
 * zero rows in that case, the exact bug class 0005's ensure_referral_code
 * fix already documented once for a different table.
 */
export async function setShareProgressPublicly(share: boolean): Promise<{ ok: boolean }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { ok: false }
  const { error } = await supabase
    .from('progress_snapshots')
    .upsert({ user_id: userData.user.id, share_publicly: share }, { onConflict: 'user_id' })
  return { ok: !error }
}

// ---------------------------------------------------------------------
// Messaging — reopens the "no UGC" scoping decision from 0002_groups.sql
// and the Share.share-instead-of-chat call in app/group/[id].tsx, both
// made specifically to stay out of App Store Guideline 1.2's moderation
// requirements. Built anyway because coach<->fighter and fighter<->fighter
// communication is a real, explicitly requested need — but paired with
// the two things Guideline 1.2 actually asks for: blockUser/reportMessage
// below, not just send/read.
// ---------------------------------------------------------------------

// Display name for chat is profiles.full_name now (accountClient.ts's
// loadFullName/saveFullName), not a local setting -- see 0046's migration
// comment for why the local version was a real impersonation hole.

export interface GroupMessage {
  id: string
  groupId: string
  senderId: string
  senderLabel: string
  kind: 'text' | 'meal_share'
  body: string | null
  mealLabel: string | null
  mealKcal: number | null
  mealProteinG: number | null
  mealCarbsG: number | null
  mealFatG: number | null
  createdAtMs: number
}

function rowToMessage(row: {
  id: string
  group_id: string
  sender_id: string
  sender_label: string
  kind: string
  body: string | null
  meal_label: string | null
  meal_kcal: number | null
  meal_protein_g: number | null
  meal_carbs_g: number | null
  meal_fat_g: number | null
  created_at: string
}): GroupMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    senderId: row.sender_id,
    senderLabel: row.sender_label,
    kind: row.kind === 'meal_share' ? 'meal_share' : 'text',
    body: row.body,
    mealLabel: row.meal_label,
    mealKcal: row.meal_kcal,
    mealProteinG: row.meal_protein_g,
    mealCarbsG: row.meal_carbs_g,
    mealFatG: row.meal_fat_g,
    createdAtMs: new Date(row.created_at).getTime(),
  }
}

/** IDs this device's user has blocked, for filtering out their messages client-side (see the blocked_users comment in 0010_group_messages.sql for why this isn't enforced at the RLS layer). */
export async function myBlockedUserIds(): Promise<Set<string>> {
  if (!supabaseConfigured || !supabase) return new Set()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return new Set()

  const { data } = await supabase.from('blocked_users').select('blocked_id').eq('blocker_id', userData.user.id)
  return new Set((data ?? []).map((r) => r.blocked_id))
}

export async function groupMessages(groupId: string): Promise<GroupMessage[]> {
  if (!supabaseConfigured || !supabase) return []

  const [{ data }, blocked] = await Promise.all([
    supabase
      .from('group_messages')
      .select('id, group_id, sender_id, sender_label, kind, body, meal_label, meal_kcal, meal_protein_g, meal_carbs_g, meal_fat_g, created_at')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true }),
    myBlockedUserIds(),
  ])
  if (!data) return []
  return data.filter((row) => !blocked.has(row.sender_id)).map(rowToMessage)
}

/**
 * Routed through send_group_message (0046), not a direct insert -- the
 * label used to be stamped from myDisplayName() (a purely local,
 * unvalidated setting), which meant anyone could post as anyone. The RPC
 * derives the label from the caller's own profiles.full_name server-side
 * and is the only way to insert a row at all now (the direct-insert
 * policy was dropped in the same migration).
 */
export async function sendGroupMessage(groupId: string, body: string): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_kind: 'text',
    p_body: body.trim(),
  })
  return !error
}

export interface SharedMeal {
  label: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * Posts one specific, deliberately-chosen meal as a recommendation to the
 * group — NOT an automatic feed of everything a member eats. A member
 * decides, per meal, whether to share it; nothing is visible to the group
 * unless they take this explicit action. This is the deliberate middle
 * path between "no food visibility at all" and "everyone's full food
 * diary is visible," the latter being the thing the research (social
 * comparison around food as a documented eating-disorder risk factor) and
 * this app's already-cutting-weight audience argue against building.
 */
export async function shareMealToGroup(groupId: string, meal: SharedMeal): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_kind: 'meal_share',
    p_meal_label: meal.label,
    p_meal_kcal: meal.kcal,
    p_meal_protein_g: meal.proteinG,
    p_meal_carbs_g: meal.carbsG,
    p_meal_fat_g: meal.fatG,
  })
  return !error
}

export async function blockUser(userId: string): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false

  const { error } = await supabase.from('blocked_users').insert({ blocker_id: userData.user.id, blocked_id: userId })
  return !error
}

export async function unblockUser(userId: string): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false

  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', userData.user.id)
    .eq('blocked_id', userId)
  return !error
}

export async function reportMessage(messageId: string, reason: string): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false

  const { error } = await supabase
    .from('message_reports')
    .insert({ message_id: messageId, reporter_id: userData.user.id, reason: reason.trim() || null })
  return !error
}

// ---------------------------------------------------------------------
// Cut together — the bridge between the public fighter directory
// (discovery) and Groups (shared progress tracking). See
// 0031_cut_together_invites.sql for why this is a real request/accept
// flow rather than an instant add: group_members' own INSERT policy only
// ever lets a user add *themselves*, by design, so silently pulling a
// stranger into a group where they'd see your weight (and you theirs)
// isn't something either RLS or good judgment allows.

/** Invites a claimed fighter (found via the directory) to a new or existing shared group. Fails with a clear message if they haven't claimed a profile yet, if you're already cutting together, or resolves to the existing pending invite if you already sent one. */
export async function inviteToCutTogether(targetSlug: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('invite_to_cut_together', { p_target_slug: targetSlug })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export interface PendingInvite {
  id: string
  groupId: string
  groupName: string
  inviterUserId: string
  inviterFighterName: string | null
  createdAtMs: number
}

/** Invites the signed-in user has received and not yet responded to. Shown at the top of the Groups tab -- this is meant to be the most visible thing there, not a buried settings item. */
export async function myPendingInvites(): Promise<PendingInvite[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return []

  const { data: invites } = await supabase
    .from('group_invites')
    .select('id, group_id, inviter_user_id, created_at, groups(name)')
    .eq('invitee_user_id', userData.user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (!invites || invites.length === 0) return []

  // fighters.claimed_by_user_id isn't a declared FK to group_invites, so
  // PostgREST can't embed it in the query above -- a second lookup, same
  // reasoning as groupMemberProgress not embedding auth.users emails.
  const inviterIds = [...new Set(invites.map((i) => i.inviter_user_id))]
  const { data: fighters } = await supabase.from('fighters').select('claimed_by_user_id, name').in('claimed_by_user_id', inviterIds)
  const nameByUser = new Map((fighters ?? []).map((f) => [f.claimed_by_user_id, f.name]))

  return invites.map((i) => ({
    id: i.id,
    groupId: i.group_id,
    groupName: (i.groups as unknown as { name: string } | null)?.name ?? 'Cutting together',
    inviterUserId: i.inviter_user_id,
    inviterFighterName: nameByUser.get(i.inviter_user_id) ?? null,
    createdAtMs: new Date(i.created_at).getTime(),
  }))
}

export async function respondToCutTogetherInvite(inviteId: string, accept: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('respond_to_cut_together_invite', { p_invite_id: inviteId, p_accept: accept })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
