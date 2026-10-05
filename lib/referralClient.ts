import * as Linking from 'expo-linking'
import { putSetting, setting } from './repo'
import { supabase, supabaseConfigured } from './supabaseClient'

/**
 * Referral ATTRIBUTION only — who invited whom. No credit, discount, or
 * percentage-of-payment logic here on purpose: that depends on live
 * subscription events (RevenueCat), which is still paused. This exists so
 * attribution data isn't missing once payouts are actually built.
 */

const PENDING_KEY = 'pending_referral_code'

export function referralLinkFor(code: string): string {
  return Linking.createURL(`refer/${code}`)
}

/** Called when a refer/[code] deep link opens and the user isn't signed in yet. */
export async function stashPendingReferral(code: string): Promise<void> {
  await putSetting(PENDING_KEY, code.toUpperCase())
}

/**
 * Called right after signUp() succeeds, and again opportunistically from
 * the Profile screen (cheap and idempotent) to self-heal one specific
 * case: if the Supabase project has "confirm email" on, there's no live
 * session yet immediately after signUp(), so claim_referral() legitimately
 * no-ops the first time. Only clears the pending code once the RPC reports
 * it actually attributed something — otherwise the code would be silently
 * lost forever with no way to recover it.
 */
export async function claimPendingReferral(): Promise<void> {
  if (!supabaseConfigured || !supabase) return
  const code = await setting(PENDING_KEY, '')
  if (!code) return
  const { data } = await supabase.rpc('claim_referral', { p_referrer_code: code })
  if (data === true) {
    await putSetting(PENDING_KEY, '')
  }
}

/** Lazily creates (if needed) and returns the signed-in user's own referral code. */
export async function myReferralCode(): Promise<string | null> {
  if (!supabaseConfigured || !supabase) return null
  const { data, error } = await supabase.rpc('ensure_referral_code')
  if (error) return null
  return (data as string | null) ?? null
}
