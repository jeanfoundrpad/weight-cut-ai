// Weight Cut AI — account deletion.
//
// Apple Guideline 5.1.1(v): any app that supports account creation must
// also support account deletion from within the app, not a "contact us
// to delete your account" workaround. Deleting the auth.users row is the
// one operation that actually satisfies this — every app table already
// has `on delete cascade` back to auth.users(id) (profiles,
// subscription_status, scan_usage, groups, group_members,
// progress_snapshots, referrals, scan_slot_counters — see the
// migrations), so removing that one row removes everything else app-side
// too, with no per-table cleanup needed here.
//
// This can't be a plain client RPC: deleting an auth user needs the
// service-role key via Supabase's Auth admin API, and that key must never
// reach the client. The caller's own session proves *who* they are; the
// service-role client is only ever used to delete exactly that verified
// user, never an id taken from the request body.

import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 })
  const userId = userData.user.id

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('[delete-account] deleteUser failed', deleteError)
    return new Response(JSON.stringify({ error: 'delete_failed' }), { status: 500 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
})
