// Weight Cut AI — flushes push_notification_outbox (0030) via Expo's push
// service.
//
// Deliberately a standalone function, not wired into the scraper or a
// database trigger directly: an HTTP call to Expo's push API can be slow
// or fail, and that must never block or fail the scraper's own upsert, or
// require the trigger (which runs inside the same transaction as the
// fighter_appearances write) to reach out to the network at all. Invoke
// this after a scrape run to actually flush whatever the trigger queued.
//
// Gated by a shared secret, same pattern as revenuecat-webhook — this was
// previously reachable by anyone who found the URL (found by an
// independent code review). The data it touches was already locked down
// (RLS/grants), so the real exposure was forcing early delivery / burning
// invocations, not data access, but an open endpoint is still the wrong
// default. Set SEND_PUSH_SECRET as this function's own secret and pass it
// as `Authorization: Bearer <secret>` from wherever this gets invoked
// after a scrape run.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH_LIMIT = 100

// Plain !== leaks secret-guess progress via response-timing differences.
// Same helper as revenuecat-webhook; duplicated rather than shared since
// Supabase Edge Functions don't share modules across functions without
// extra deploy config, same reasoning as MODEL_PRICING's duplication
// between analyze-photo and coach-insight.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  if (aBytes.length !== bBytes.length) return false
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get('SEND_PUSH_SECRET')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!expectedSecret || !timingSafeEqual(authHeader, `Bearer ${expectedSecret}`)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: outbox, error: outboxError } = await supabase
    .from('push_notification_outbox')
    .select('id, user_id, title, body, data')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (outboxError) {
    console.error('[send-push-notifications] outbox query failed', outboxError)
    return new Response(JSON.stringify({ error: 'outbox_query_failed' }), { status: 500 })
  }
  if (!outbox || outbox.length === 0) {
    return new Response(JSON.stringify({ sent: 0, skipped: 0 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const userIds = [...new Set(outbox.map((o) => o.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, expo_push_token, notify_on_result')
    .in('id', userIds)
  const tokenByUser = new Map((profiles ?? []).map((p) => [p.id, p]))

  let sent = 0
  let skipped = 0
  const settledIds: string[] = []

  for (const item of outbox) {
    const profile = tokenByUser.get(item.user_id)
    settledIds.push(item.id)

    // No token, or the user turned notifications off since this was
    // queued -- marked settled either way rather than retried forever,
    // since there's no path to ever successfully deliver it.
    if (!profile?.expo_push_token || !profile.notify_on_result) {
      skipped++
      continue
    }

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          to: profile.expo_push_token,
          title: item.title,
          body: item.body,
          data: item.data ?? {},
        }),
      })
      if (res.ok) {
        sent++
      } else {
        console.error('[send-push-notifications] Expo push API rejected', item.id, await res.text())
        skipped++
      }
    } catch (e) {
      console.error('[send-push-notifications] fetch failed', item.id, e)
      skipped++
    }
  }

  await supabase.from('push_notification_outbox').update({ sent_at: new Date().toISOString() }).in('id', settledIds)

  return new Response(JSON.stringify({ sent, skipped }), { status: 200, headers: { 'content-type': 'application/json' } })
})
