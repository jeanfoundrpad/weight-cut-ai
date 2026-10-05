import Constants from 'expo-constants'
import type { AdaptiveRecalibration } from './repo'
import { supabase, supabaseConfigured } from './supabaseClient'

/**
 * Calls the backend's coach-insight function to phrase an already-computed
 * AdaptiveRecalibration result (see lib/adaptiveTarget.ts) in plain
 * language. Same graceful-fallback shape as aiProxy.ts: this always has a
 * real, correct message to show even if the AI call never happens — the
 * `reason` string adaptiveTarget.ts already computed, no AI involved — so a
 * missing backend, signed-out state, or a failed/rate-limited AI call just
 * means the plain version is what's shown, never a broken screen.
 */

const API_BASE = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ?? ''

export async function narrateRecalibration(result: AdaptiveRecalibration): Promise<string> {
  const fallback = result.reason

  if (!API_BASE || !supabaseConfigured || !supabase) return fallback
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return fallback

  try {
    const res = await fetch(`${API_BASE}/functions/v1/coach-insight`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        daysOfData: result.daysOfData,
        confidence: Math.round(result.confidence * 100) / 100,
        previousTargetKcal: Math.round(result.previousTargetKcal),
        newTargetKcal: Math.round(result.newTargetKcal),
        deltaKcal: Math.round(result.deltaKcal),
        isMaterialChange: result.isMaterialChange,
        wasFloorClamped: result.wasFloorClamped,
      }),
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as { message: string | null }
    return data.message?.trim() || fallback
  } catch (e) {
    console.error('[coachClient] narrateRecalibration failed', e)
    return fallback
  }
}
