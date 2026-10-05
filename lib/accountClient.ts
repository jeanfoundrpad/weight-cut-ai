import Constants from 'expo-constants'
import { supabase, supabaseConfigured } from './supabaseClient'

const API_BASE = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ?? ''

/**
 * Persists the name entered on the onboarding claim screen as the
 * account's actual name (see 0026_profile_full_name.sql) — that screen's
 * "search your name" box used to be a throwaway query, discarded whether
 * or not a match was found. Called regardless of outcome (claimed, no
 * match, or skipped with something typed) since claiming is now the only
 * time this app ever asks for a real name at all.
 */
export async function saveFullName(name: string): Promise<void> {
  if (!supabaseConfigured || !supabase || !name.trim()) return
  try {
    await supabase.rpc('save_full_name', { p_name: name.trim() })
  } catch (e) {
    console.error('[accountClient] saveFullName failed', e)
  }
}

/** Own row only (profiles' own SELECT policy) -- used by group chat to know whether a name has already been set, since send_group_message (0046) now derives the chat label from this same column server-side. */
export async function loadFullName(): Promise<string> {
  if (!supabaseConfigured || !supabase) return ''
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user) return ''
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userData.user.id).maybeSingle()
  return data?.full_name ?? ''
}

/**
 * Calls the delete-account Edge Function, which needs the service-role key
 * to actually remove the auth.users row — a credential the client can
 * never hold, so this can't be a plain client-side call. The caller is
 * responsible for wiping local data and signing out afterward regardless
 * of the result; a failed server call still leaves the caller able to
 * retry, so this only reports success/failure rather than doing cleanup
 * itself.
 */
export async function deleteAccount(): Promise<{ ok: boolean }> {
  if (!API_BASE || !supabaseConfigured || !supabase) return { ok: false }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false }

  try {
    const res = await fetch(`${API_BASE}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    return { ok: res.ok }
  } catch (e) {
    console.error('[accountClient] deleteAccount failed', e)
    return { ok: false }
  }
}
