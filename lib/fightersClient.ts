import { supabase, supabaseConfigured } from './supabaseClient'
import { KG_TO_LB, LB_TO_KG } from './units'

/**
 * A directory of real fighters (see backend/scraper/) -- lets a fighter
 * already using the app look up who else is out there: name, gym, current
 * weight class, and their most recent promotion/event. Deliberately still
 * no win/loss record on the browse/search list (explicitly ruled out at
 * first, then reversed for the detail view -- see fighterAppearances) --
 * this is "who's active and where," not a rankings mechanism.
 *
 * Reads from the `fighter_directory` view (0013, extended by 0015/0017/0020),
 * which joins the one-row-per-fighter `fighters` table to each fighter's
 * single most recent `fighter_appearances` row via a stable slug (not raw
 * name text -- the same real person's name can render with different
 * casing across sources, e.g. "Connor Duffy" vs "Connor DUFFY", which used
 * to make the join miss real appearances).
 */

export interface Fighter {
  slug: string
  name: string
  gym: string | null
  weightKg: number | null
  promotion: string | null
  eventName: string | null
  eventDateMs: number | null
  /**
   * division/age/height/asOfDateMs only come from sources whose data is a
   * point-in-time event snapshot (see 0014_fighter_directory_snapshot_fields.sql)
   * rather than a continuously-updated profile -- always null together,
   * and asOfDateMs should be shown alongside any of the others whenever
   * they're rendered, so nobody's shown as their weight/record from a
   * fight that may no longer reflect where they are now.
   */
  division: 'amateur' | 'pro' | null
  age: number | null
  height: string | null
  asOfDateMs: number | null
  /**
   * Record source differs by promotion: muaythairecords.com presents this
   * as a continuously-updated career total (same status as gym/weight, no
   * as_of_date), No Boundary Fight's is the record as of asOfDateMs like
   * division/age/height.
   */
  /** Raw scraped/self-typed total (muaythairecords.com's own field, or a manual edit) -- kept only as a fallback for a fighter with no tracked appearances at all. See computedWins etc. for the number actually worth displaying. */
  wins: number | null
  losses: number | null
  draws: number | null
  /**
   * The record actually worth showing -- counted directly from this
   * fighter's own fighter_appearances rows (fighter_directory, 0037), the
   * same data Trending is built from, rather than a separately scraped
   * snapshot that has no structural reason to agree with it. Real case
   * that prompted this: Dennis Dang showed "3 fights" in Trending but a
   * scraped "0-1" record with nothing explaining the gap -- computedPending
   * is what makes that self-explanatory (4 of his 5 tracked appearances
   * are still unverified, only 1 has ever actually been decided).
   */
  computedWins: number
  computedLosses: number
  computedDraws: number
  computedPending: number
  /** Only ever set from a source that explicitly states it (muaythairecords.com's own per-fighter data) -- never inferred from a name. */
  sex: 'male' | 'female' | null
  claimedByUserId: string | null
  photoUrl: string | null
}

interface FighterRow {
  slug: string
  name: string
  gym: string | null
  weight_kg: number | null
  promotion: string | null
  event_name: string | null
  event_date: string | null
  division: string | null
  age: number | null
  height: string | null
  as_of_date: string | null
  wins: number | null
  losses: number | null
  draws: number | null
  computed_wins: number
  computed_losses: number
  computed_draws: number
  computed_pending: number
  sex: string | null
  claimed_by_user_id: string | null
  photo_url: string | null
}

function rowToFighter(row: FighterRow): Fighter {
  return {
    slug: row.slug,
    name: row.name,
    gym: row.gym,
    weightKg: row.weight_kg,
    promotion: row.promotion,
    eventName: row.event_name,
    eventDateMs: row.event_date ? new Date(row.event_date).getTime() : null,
    division: row.division === 'amateur' || row.division === 'pro' ? row.division : null,
    age: row.age,
    height: row.height,
    asOfDateMs: row.as_of_date ? new Date(row.as_of_date).getTime() : null,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    computedWins: row.computed_wins,
    computedLosses: row.computed_losses,
    computedDraws: row.computed_draws,
    computedPending: row.computed_pending,
    sex: row.sex === 'male' || row.sex === 'female' ? row.sex : null,
    claimedByUserId: row.claimed_by_user_id,
    photoUrl: row.photo_url,
  }
}

const SELECT_COLUMNS =
  'slug, name, gym, weight_kg, promotion, event_name, event_date, division, age, height, as_of_date, wins, losses, draws, computed_wins, computed_losses, computed_draws, computed_pending, sex, claimed_by_user_id, photo_url'

/**
 * The record line to actually show, one place so every screen agrees.
 * Prefers the computed record (real tracked appearances) whenever there
 * is one; falls back to the raw scraped/self-typed total only for a
 * fighter with zero tracked appearances, where there's nothing to
 * compute from. Appends a pending count whenever it's relevant, so "more
 * activity than record" reads as an explanation instead of a
 * contradiction.
 */
export function recordSummary(f: Fighter): string | null {
  const computedTotal = f.computedWins + f.computedLosses + f.computedDraws + f.computedPending
  if (computedTotal > 0) {
    const base = `${f.computedWins}-${f.computedLosses}-${f.computedDraws}`
    return f.computedPending > 0 ? `${base} · ${f.computedPending} pending` : base
  }
  if (f.wins != null || f.losses != null || f.draws != null) {
    return `${f.wins ?? 0}-${f.losses ?? 0}-${f.draws ?? 0}`
  }
  return null
}

/** Fighters within `rangeLb` pounds of `centerWeightLb`, alphabetical by name. */
export async function fightersNearWeight(centerWeightLb: number, rangeLb = 10): Promise<Fighter[]> {
  if (!supabaseConfigured || !supabase) return []

  const minKg = (centerWeightLb - rangeLb) * LB_TO_KG
  const maxKg = (centerWeightLb + rangeLb) * LB_TO_KG

  const { data, error } = await supabase
    .from('fighter_directory')
    .select(SELECT_COLUMNS)
    .gte('weight_kg', minKg)
    .lte('weight_kg', maxKg)
    .order('name', { ascending: true })
    .limit(200)

  if (error || !data) return []
  return data.map(rowToFighter)
}

/**
 * Fighters near the user's own weight-cut target AND active around the
 * same fight-date window -- not weight alone (see fightersNearWeight,
 * which predates this app tracking any fight-goal data at all). Built
 * directly from the user's own FightGoal (weighInTargetKg/weighInDateMs,
 * lib/repo.ts): a fighter cutting to 145 lb for a fight in October should
 * see other fighters near 145 who were active around October, not a
 * static weight list disconnected from timing -- the actual "who am I
 * cutting alongside" question, not just "who's ever fought near my
 * weight." `event_date` on this view is each fighter's single most recent
 * appearance (see 0013's LATERAL join), so this can surface fighters on
 * either side of the window -- someone who just fought near that weight,
 * or someone with an upcoming card in it.
 */
export async function fightersInMyCutWindow(
  targetWeightLb: number,
  fightDateMs: number,
  rangeLb = 10,
  dayWindow = 30,
): Promise<Fighter[]> {
  if (!supabaseConfigured || !supabase) return []

  const minKg = (targetWeightLb - rangeLb) * LB_TO_KG
  const maxKg = (targetWeightLb + rangeLb) * LB_TO_KG
  const dayMs = 24 * 60 * 60 * 1000
  const minDate = new Date(fightDateMs - dayWindow * dayMs).toISOString().slice(0, 10)
  const maxDate = new Date(fightDateMs + dayWindow * dayMs).toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('fighter_directory')
    .select(SELECT_COLUMNS)
    .gte('weight_kg', minKg)
    .lte('weight_kg', maxKg)
    .gte('event_date', minDate)
    .lte('event_date', maxDate)
    .order('event_date', { ascending: true })
    .limit(50)

  if (error || !data) return []
  return data.map(rowToFighter)
}

/** Matches on fighter name OR gym name, so searching a gym surfaces its whole roster. */
export async function searchFighters(query: string): Promise<Fighter[]> {
  if (!supabaseConfigured || !supabase) return []
  // Strip characters meaningful to PostgREST's .or() filter syntax
  // (comma separates conditions, parentheses group them) -- none of them
  // are meaningful in a name/gym search anyway, so dropping them avoids a
  // malformed filter rather than needing to escape them.
  const q = query.trim().replace(/[,()]/g, '')
  if (!q) return []

  const { data, error } = await supabase
    .from('fighter_directory')
    .select(SELECT_COLUMNS)
    .or(`name.ilike.%${q}%,gym.ilike.%${q}%`)
    .order('name', { ascending: true })
    .limit(100)

  if (error || !data) return []
  return data.map(rowToFighter)
}

export async function fighterBySlug(slug: string): Promise<Fighter | null> {
  if (!supabaseConfigured || !supabase) return null
  const { data, error } = await supabase.from('fighter_directory').select(SELECT_COLUMNS).eq('slug', slug).maybeSingle()
  if (error || !data) return null
  return rowToFighter(data)
}

export interface FighterAppearance {
  id: string
  promotion: string
  eventName: string
  eventDateMs: number | null
  opponentName: string
  /** Null on a handful of older rows scraped before opponent_slug existed -- the UI should fall back to non-interactive text for those rather than link to nowhere. */
  opponentSlug: string | null
  /** Not every promotion lists a weight on every bout (confirmed live on Warrior's Cup: most real bouts have no weight in the compact card at all) -- null here is real data, not a missing-field bug, and the UI needs to handle it. */
  weightKg: number | null
  /**
   * From this fighter's side of the bout (a scraped row is already
   * per-fighter, not per-bout -- see 0011's module comment). Always
   * 'pending' when the source hasn't posted a verified result yet, which
   * is real and common for recently-added promotions/events, not a
   * missing-field bug. Was scraped and stored from the very first
   * migration but never actually selected here or shown anywhere in the
   * UI until now.
   */
  result: 'win' | 'loss' | 'draw' | 'pending'
  /** True for a row a fighter added themselves (add_self_reported_appearance, 0028), false for anything the scraper found. The UI must badge these differently -- this is a public fight-record directory, and letting a self-typed entry read as indistinguishable from sourced data would be a real trust problem, not a cosmetic one. */
  isSelfReported: boolean
  /**
   * True when a genuinely scraped row's win/loss/draw was filled in by a
   * claimed fighter (update_appearance_result, 0043) rather than the
   * source -- distinct from isSelfReported, which is about the whole row
   * being fabricated. This one's real bout data, just an unverified
   * outcome, and needs its own badge for the same trust reason.
   */
  resultSelfReported: boolean
}

/** Full appearance history for one fighter (by slug, not raw name text -- see the module comment on why that matters), most recent first. This is where win/loss context lives, deliberately not on the browse list. opponentSlug is what makes "click an opponent to see who *they* fought" possible -- the actual point of tracking this data at all. */
export async function fighterAppearances(slug: string): Promise<FighterAppearance[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase
    .from('fighter_appearances')
    .select('id, promotion, event_name, event_date, opponent_name, opponent_slug, weight_kg, result, is_self_reported, result_reported_by_user_id')
    .eq('fighter_slug', slug)
    .order('event_date', { ascending: false, nullsFirst: false })

  if (error || !data) return []
  return data.map((row) => ({
    id: row.id,
    promotion: row.promotion,
    eventName: row.event_name,
    eventDateMs: row.event_date ? new Date(row.event_date).getTime() : null,
    opponentName: row.opponent_name,
    opponentSlug: row.opponent_slug,
    weightKg: row.weight_kg,
    result: row.result,
    isSelfReported: row.is_self_reported,
    resultSelfReported: row.result_reported_by_user_id != null,
  }))
}

export interface NewSelfReportedFight {
  promotion: string
  eventName: string
  eventDateMs: number | null
  weightKg: number | null
  opponentName: string
  opponentSlug: string | null
  result: 'win' | 'loss' | 'draw' | 'pending'
}

/** Adds a fight to a fighter's own history (add_self_reported_appearance, 0028) -- only succeeds against a profile the caller has actually claimed, same ownership check as updateFighterProfile/uploadFighterPhoto. */
export async function addSelfReportedFight(slug: string, fight: NewSelfReportedFight): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('add_self_reported_appearance', {
    p_slug: slug,
    p_promotion: fight.promotion,
    p_event_name: fight.eventName,
    p_event_date: fight.eventDateMs ? new Date(fight.eventDateMs).toISOString().slice(0, 10) : null,
    p_weight_kg: fight.weightKg,
    p_opponent_name: fight.opponentName,
    p_opponent_slug: fight.opponentSlug,
    p_result: fight.result,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Removes a self-reported fight the caller themselves added -- never a scraped row, regardless of which fighter it's attached to (see the migration's delete_self_reported_appearance for the exact scoping). */
export async function deleteSelfReportedFight(appearanceId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('delete_self_reported_appearance', { p_id: appearanceId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Resolves a fight still stuck at 'pending' on a profile the caller has
 * claimed (update_appearance_result, 0040) -- for the common real case
 * where the source itself never published a result. Only works on a
 * 'pending' row; correcting an already-decided win/loss stays a manual
 * reviewed action, same posture as a disputed claim.
 */
export async function updateAppearanceResult(appearanceId: string, result: 'win' | 'loss' | 'draw'): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('update_appearance_result', { p_id: appearanceId, p_result: result })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * The soonest still-unfought bout in a fighter's appearance list, if any --
 * 'pending' with a real future date, not just any unverified row (a past
 * event the source hasn't gotten around to updating is also 'pending', and
 * showing that as someone's "next fight" would be actively wrong). `nowMs`
 * is a parameter rather than reading Date.now() internally so this stays
 * pure and testable, same reasoning as the rest of this app's date/math
 * helpers (dateMath.ts, weightCutMath.ts).
 */
export function nextScheduledFight(appearances: FighterAppearance[], nowMs: number): FighterAppearance | null {
  const upcoming = appearances.filter((a) => a.result === 'pending' && a.eventDateMs != null && a.eventDateMs > nowMs)
  if (upcoming.length === 0) return null
  return upcoming.reduce((soonest, a) => (a.eventDateMs! < soonest.eventDateMs! ? a : soonest))
}

/**
 * Links the signed-in user's account to a scraped fighter row. Calls the
 * claim_fighter() RPC (security definer -- see 0019_fighter_claims.sql)
 * rather than a direct update, since a plain client-facing UPDATE policy
 * on `fighters` would also let a claiming user rewrite gym/weight/record
 * on any row, not just claim it.
 */
/**
 * Requests to claim an existing scraped profile -- doesn't claim it
 * outright. Every claim now goes through review (0036) after a real
 * mistaken claim happened during testing (claiming a profile that
 * obviously wasn't the claimer) with zero verification in the way.
 * claimed_by_user_id only gets set once an admin approves the request.
 */
export async function requestFighterClaim(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('request_fighter_claim', { p_slug: slug })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function unclaimFighter(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('unclaim_fighter', { p_slug: slug })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export interface FighterProfileEdit {
  gym: string | null
  weightKg: number | null
  division: 'amateur' | 'pro' | null
  age: number | null
  height: string | null
  sex: 'male' | 'female' | null
  wins: number | null
  losses: number | null
  draws: number | null
}

/**
 * Self-service edit for a fighter the signed-in user has claimed. Calls
 * update_fighter_profile() (security definer, 0021_fighter_profile_edit.sql)
 * rather than a direct table update, same reasoning as claim/unclaim --
 * the RPC only touches these specific columns and only on a row the
 * caller actually claimed, so it can't be used to edit slug/
 * claimed_by_user_id or anyone else's profile. Bumps as_of_date to today
 * server-side, since a self-edit is itself a fresh "this is accurate as
 * of now" statement, the same way a scrape's as_of_date is.
 */
export async function updateFighterProfile(slug: string, edit: FighterProfileEdit): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('update_fighter_profile', {
    p_slug: slug,
    p_gym: edit.gym,
    p_weight_kg: edit.weightKg,
    p_division: edit.division,
    p_age: edit.age,
    p_height: edit.height,
    p_sex: edit.sex,
    p_wins: edit.wins,
    p_losses: edit.losses,
    p_draws: edit.draws,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Uploads a photo to the fighter-photos bucket under the caller's own
 * folder (the bucket's own Storage policies only allow writing there --
 * see 0023_fighter_photos_storage.sql), then attaches the resulting
 * public URL to the claimed fighter row via update_fighter_photo() --
 * ownership of *that specific fighter* is checked again there, since a
 * user being allowed to upload *a* photo somewhere isn't the same thing
 * as being allowed to attach it to *this* fighter's profile.
 */
export async function uploadFighterPhoto(slug: string, base64Jpeg: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return { ok: false, error: 'Not signed in.' }

  const path = `${userData.user.id}/${slug}-${Date.now()}.jpg`
  const bytes = Uint8Array.from(atob(base64Jpeg), (c) => c.charCodeAt(0))
  const { error: uploadError } = await supabase.storage.from('fighter-photos').upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (uploadError) return { ok: false, error: uploadError.message }

  const { data: publicUrlData } = supabase.storage.from('fighter-photos').getPublicUrl(path)
  const { error: rpcError } = await supabase.rpc('update_fighter_photo', { p_slug: slug, p_photo_url: publicUrlData.publicUrl })
  if (rpcError) return { ok: false, error: rpcError.message }
  return { ok: true }
}

export function weightClassLabel(weightKg: number): string {
  return `${Math.round(weightKg * KG_TO_LB)} lb`
}

/**
 * Display-only cleanup, never touches stored data. Both sources render
 * some text in ALL CAPS by their own design (No Boundary Fight's PDF
 * layout puts a fighter's surname and every gym name in caps, e.g. "Zach
 * FERRIS" / "NORTH SHORE MUAY THAI") -- readable as raw data but jarring
 * in a list. Only re-cases a word that's *entirely* uppercase, so an
 * already-natural-case name or gym (muaythairecords.com's own text, or a
 * real acronym like "TFA"/"USA"/"M.A") is never touched -- a naive
 * blanket title-case would also mangle a name like "McDonald". Words of
 * 3 letters or fewer are left alone even if all-caps, since those are
 * the ones most likely to actually be acronyms/initials, not styling.
 */
export function displayCase(text: string | null): string | null {
  if (!text) return text
  return text
    .split(' ')
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, '')
      const isAllCaps = letters.length > 0 && word === word.toUpperCase()
      if (!isAllCaps || letters.length <= 3) return word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export interface SharedProgress {
  currentWeightKg: number
  weighInTargetKg: number | null
  weighInDateMs: number | null
  updatedAtMs: number
}

/**
 * A claimed fighter's real tracked weight, if and only if they've opted in
 * (progress_snapshots.share_publicly, 0029 -- RLS enforces this server-side
 * too, so a false/missing flag returns nothing regardless of what this
 * function does). Distinct from Fighter.weightKg, which is either a
 * scraped "last weight" from a fight-record site or something the fighter
 * self-typed in the edit screen -- this is their real, actively-tracked
 * app weight instead, worth labeling differently in the UI so it doesn't
 * read as the same kind of claim.
 */
export async function sharedProgressFor(claimedByUserId: string): Promise<SharedProgress | null> {
  if (!supabaseConfigured || !supabase) return null
  const { data, error } = await supabase
    .from('progress_snapshots')
    .select('current_weight_kg, weigh_in_target_kg, weigh_in_date, updated_at')
    .eq('user_id', claimedByUserId)
    .eq('share_publicly', true)
    .maybeSingle()

  if (error || !data || data.current_weight_kg == null) return null
  return {
    currentWeightKg: data.current_weight_kg,
    weighInTargetKg: data.weigh_in_target_kg,
    weighInDateMs: data.weigh_in_date ? new Date(data.weigh_in_date).getTime() : null,
    updatedAtMs: new Date(data.updated_at).getTime(),
  }
}

// ---------------------------------------------------------------------
// Self-created profiles + yearly fight records (0032). For a fighter the
// scraper never found (no promotion in backend/scraper/ has ever covered
// them) -- `fighters` was previously only ever written by the scraper, so
// there was no way to exist in the directory at all otherwise. Yearly
// records are the low-friction alternative to logging every individual
// bout (app/fighter/add-fight.tsx): "5 fights in 2023," no opponent names
// required, and both feed the same Trending activity signal below.

/** Creates a brand-new fighter row and claims it as the caller's own, for someone not found anywhere in the scraped directory. Returns the generated slug. */
/** Requests a brand-new profile -- the fighters row itself isn't created until an admin approves it (0036), so an unreviewed request never briefly pollutes the public directory. */
export async function requestNewFighterProfile(name: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('request_new_fighter_profile', { p_name: name.trim() })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export interface ClaimRequest {
  id: string
  requesterUserId: string
  fighterSlug: string | null
  requestedName: string | null
  /** Only set for an existing-profile request (fighterSlug non-null) -- what the request is actually claiming, for the reviewer to sanity-check. */
  fighterName: string | null
  fighterGym: string | null
  createdAtMs: number
}

/**
 * Pending claim requests -- readable by an admin only (RLS, 0036). Shown
 * on the admin review screen. Doesn't surface the requester's own account
 * name (profiles isn't readable across users, even for an admin, without
 * a new policy this doesn't add yet) -- the fighter identity being
 * claimed (name/gym for an existing profile, or the requested name for a
 * new one) is the actual decision signal for approving or rejecting.
 */
export async function pendingClaimRequests(): Promise<ClaimRequest[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase
    .from('fighter_claim_requests')
    .select('id, requester_user_id, fighter_slug, requested_name, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error || !data) return []

  const slugs = [...new Set(data.map((row) => row.fighter_slug).filter((s): s is string => s != null))]
  const fighterBySlug = new Map<string, { name: string; gym: string | null }>()
  if (slugs.length > 0) {
    const { data: fighterRows } = await supabase.from('fighters').select('slug, name, gym').in('slug', slugs)
    for (const f of fighterRows ?? []) fighterBySlug.set(f.slug, { name: f.name, gym: f.gym })
  }

  return data.map((row) => ({
    id: row.id,
    requesterUserId: row.requester_user_id,
    fighterSlug: row.fighter_slug,
    requestedName: row.requested_name,
    fighterName: row.fighter_slug ? (fighterBySlug.get(row.fighter_slug)?.name ?? null) : null,
    fighterGym: row.fighter_slug ? (fighterBySlug.get(row.fighter_slug)?.gym ?? null) : null,
    createdAtMs: new Date(row.created_at).getTime(),
  }))
}

export async function approveClaimRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('approve_claim_request', { p_request_id: requestId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function rejectClaimRequest(requestId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('reject_claim_request', { p_request_id: requestId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Whether the signed-in user is allowed to review claim requests (profiles.is_admin, 0036). */
export async function isAdmin(): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return false
  const { data } = await supabase.from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle()
  return data?.is_admin ?? false
}

export interface YearRecord {
  year: number
  fights: number
  wins: number | null
  losses: number | null
  draws: number | null
}

export async function fighterYearRecords(slug: string): Promise<YearRecord[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase
    .from('fighter_year_records')
    .select('year, fights, wins, losses, draws')
    .eq('fighter_slug', slug)
    .order('year', { ascending: false })
  if (error || !data) return []
  return data
}

export async function upsertFighterYearRecord(
  slug: string,
  record: { year: number; fights: number; wins: number | null; losses: number | null; draws: number | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('upsert_fighter_year_record', {
    p_slug: slug, p_year: record.year, p_fights: record.fights, p_wins: record.wins, p_losses: record.losses, p_draws: record.draws,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteFighterYearRecord(slug: string, year: number): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase) return { ok: false }
  const { error } = await supabase.rpc('delete_fighter_year_record', { p_slug: slug, p_year: year })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export interface TrendingFighter {
  slug: string
  name: string
  gym: string | null
  weightKg: number | null
  sex: 'male' | 'female' | null
  fightsThisYear: number
  claimedByUserId: string | null
}

/** Most active fighters this calendar year, combining logged bouts and self-reported yearly counts (trending_fighters view, 0032). Gets more useful as fighters log their own activity -- there's no other source for this. */
export async function trendingFighters(limit = 20): Promise<TrendingFighter[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase
    .from('trending_fighters')
    .select('slug, name, gym, weight_kg, sex, fights_this_year, claimed_by_user_id')
    .order('fights_this_year', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((row) => ({
    slug: row.slug,
    name: row.name,
    gym: row.gym,
    weightKg: row.weight_kg,
    sex: row.sex,
    fightsThisYear: row.fights_this_year,
    claimedByUserId: row.claimed_by_user_id,
  }))
}

// ---------------------------------------------------------------------
// Gym rosters and upcoming fights (0034) -- two more ways into the same
// directory, both pure reads over data that already existed.

export interface GymSummary {
  gym: string
  fighterCount: number
}

/** Gyms with the most fighters first -- feeds a "Browse gyms" section and each gym's own roster page. */
export async function gymsSummary(limit = 20): Promise<GymSummary[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase.from('gyms_summary').select('gym, fighter_count').limit(limit)
  if (error || !data) return []
  return data.map((row) => ({ gym: row.gym, fighterCount: row.fighter_count }))
}

/** Every claimed-or-scraped fighter at a specific gym, alphabetical. */
export async function fightersAtGym(gym: string): Promise<Fighter[]> {
  if (!supabaseConfigured || !supabase) return []
  const { data, error } = await supabase
    .from('fighter_directory')
    .select(SELECT_COLUMNS)
    .eq('gym', gym)
    .order('name', { ascending: true })
  if (error || !data) return []
  return data.map(rowToFighter)
}

