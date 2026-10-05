import { setting, putSetting } from './repo'

/**
 * Subscription entitlement.
 *
 * MOCKED FOR NOW. The real implementation calls RevenueCat's
 * `Purchases.getCustomerInfo()` — but RevenueCat's SDK is a native module
 * and (like every other native module this project has hit) does not run
 * inside Expo Go. It only works in a real Dev Client build, which itself
 * needs an Apple Developer account that doesn't exist yet. Rather than
 * block all UI work on that, this reads a local flag so the paywall and
 * the rest of the app are fully buildable and demoable today; swapping in
 * the real RevenueCat call later is a one-function change, isolated here.
 *
 * 'trial' and 'active' both grant full app access — the paywall only
 * needs to distinguish "has an entitlement right now" from "doesn't".
 * 'not_subscribed' (never started a subscription) and 'expired' (lapsed)
 * both route to the paywall; kept as separate states because their copy
 * differs ("start your trial" vs "your trial ended").
 */
export type EntitlementStatus = 'not_subscribed' | 'trial' | 'active' | 'expired'

export interface Entitlement {
  status: EntitlementStatus
  trialEndsAtMs: number | null
}

const MOCK_STATUS_KEY = 'entitlement.mock_status'
const TRIAL_STARTED_AT_KEY = 'entitlement.trial_started_at'
const TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000

export async function checkEntitlement(): Promise<Entitlement> {
  const status = (await setting(MOCK_STATUS_KEY, 'not_subscribed')) as EntitlementStatus
  if (status !== 'trial') return { status, trialEndsAtMs: null }

  const startedAt = Number(await setting(TRIAL_STARTED_AT_KEY, '0'))
  const endsAt = startedAt + TRIAL_LENGTH_MS
  if (Date.now() >= endsAt) {
    await putSetting(MOCK_STATUS_KEY, 'expired' satisfies EntitlementStatus)
    return { status: 'expired', trialEndsAtMs: null }
  }
  return { status: 'trial', trialEndsAtMs: endsAt }
}

/**
 * Stands in for RevenueCat's purchase flow completing successfully. The
 * paywall calls this after the (currently mocked) "enter card details"
 * step. Real version: `Purchases.purchasePackage(offering)`.
 */
export async function startTrial(now: number): Promise<void> {
  await putSetting(TRIAL_STARTED_AT_KEY, String(now))
  await putSetting(MOCK_STATUS_KEY, 'trial' satisfies EntitlementStatus)
}
