// Weight Cut AI — RevenueCat webhook receiver.
//
// Configure this function's URL in the RevenueCat dashboard (Project
// Settings -> Integrations -> Webhooks), along with a shared secret set as
// this function's REVENUECAT_WEBHOOK_SECRET env var and sent by RevenueCat
// as `Authorization: Bearer <secret>`. Rejects anything that doesn't match.
//
// RevenueCat's `app_user_id` is set client-side to the Supabase Auth user's
// id at login (Purchases.logIn(supabaseUserId)) — that's what links a
// purchase event back to a specific account here.

import { createClient } from 'jsr:@supabase/supabase-js@2'

type RevenueCatEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'PRODUCT_CHANGE'
  | 'UNCANCELLATION'

interface RevenueCatEvent {
  type: RevenueCatEventType
  app_user_id: string
  product_id: string
  expiration_at_ms: number | null
}

const STATUS_FOR_EVENT: Record<RevenueCatEventType, string> = {
  INITIAL_PURCHASE: 'trial',
  RENEWAL: 'active',
  UNCANCELLATION: 'active',
  PRODUCT_CHANGE: 'active',
  CANCELLATION: 'canceled',
  EXPIRATION: 'expired',
  BILLING_ISSUE: 'billing_issue',
}

// Plain !== leaks secret-guess progress via response-timing differences.
// This compares in constant time regardless of where the mismatch is.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!expectedSecret || !timingSafeEqual(authHeader, `Bearer ${expectedSecret}`)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = (await req.json()) as { event: RevenueCatEvent }
  const event = body.event
  const status = STATUS_FOR_EVENT[event.type]
  if (!status) {
    // Unrecognized event type — acknowledge rather than error, so
    // RevenueCat doesn't retry forever for event types we don't act on.
    return new Response('ok (ignored)', { status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    // Service-role key — bypasses RLS. This function is the ONLY writer of
    // subscription_status; see the migration's comment for why.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { error } = await supabase.from('subscription_status').upsert({
    user_id: event.app_user_id,
    status,
    product_id: event.product_id,
    expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    console.error('subscription_status upsert failed', error)
    return new Response('Internal error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})
