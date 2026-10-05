# Weight Cut AI — backend

Supabase project: Postgres (accounts + subscription state), Auth
(email/password), and two Edge Functions. Nothing here is deployed yet —
this is real, working code, but it needs your own Supabase project and API
keys before it does anything.

## What each piece does

- **`supabase/migrations/0001_init.sql`** — `profiles`, `subscription_status`,
  `scan_usage` tables, with row-level security so a user can only ever read
  their own rows (never write `subscription_status` directly — only the
  webhook function can, via the service-role key).
- **`supabase/migrations/0002_groups.sql`** — private accountability groups
  (`groups`, `group_members`, `progress_snapshots`) plus `join_group_by_code`,
  a narrow security-definer function that's the only way joining by invite
  code actually works under RLS — see the comment on it for why.
- **`supabase/migrations/0003_referrals.sql`** — referral *attribution* only:
  a `referral_code` column on `profiles`, a `referrals` table (who invited
  whom), and two security-definer functions (`ensure_referral_code`,
  `claim_referral`). Deliberately has no credit/discount/percentage field —
  that depends on live subscription events, which is still paused. This
  just makes sure the attribution data exists so a payout feature can be
  added later without a backfill problem.
- **`supabase/functions/revenuecat-webhook`** — receives subscription
  lifecycle events from RevenueCat and updates `subscription_status`. **Not
  needed yet** — payment/RevenueCat work is paused, skip step 4 below until
  that resumes.
- **`supabase/functions/analyze-photo`** — the AI vision proxy the app
  calls to scan a meal. Checks the caller has an active subscription,
  enforces a 30-scans/day cap, calls the configured provider's API using
  *your* key (not the user's), and logs real cost per call. Note: since
  RevenueCat is paused, `subscription_status` will stay empty for real
  users, so this function will normally reject every call with
  `402 no_active_subscription`. **Currently relaxed for testing** via the
  `ALLOW_UNENTITLED_SCANS` secret (set to `true`) — every bypassed call
  logs a loud `[TESTING BYPASS]` warning so it can't silently stay on.
  **Unset this the moment real subscriptions exist**:
  `supabase secrets unset ALLOW_UNENTITLED_SCANS`.
  **Which model (and therefore which provider) it calls is a config value,
  not hardcoded** — see below. Multi-provider on purpose: Anthropic, OpenAI,
  and Gemini are all supported, picked automatically from the model name's
  prefix (`claude-`/`gpt-`/`gemini-`), so swapping providers is a secret
  change, not a redeploy.

## One-time setup (payments-paused version — steps 1-3 and 6 only)

1. **Create a Supabase project** at supabase.com (free tier is enough to
   start).
2. Install the Supabase CLI, then from `backend/`:
   ```
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push          # applies 0001_init.sql, 0002_groups.sql, 0003_referrals.sql
   supabase functions deploy analyze-photo
   ```
   (Skip deploying `revenuecat-webhook` for now — nothing points at it yet.)
3. **Set the Edge Function secrets** (Supabase dashboard -> Edge Functions
   -> Secrets, or `supabase secrets set`):
   - Provider API key for whichever model `ANALYZE_PHOTO_MODEL` points at —
     `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`. Only the one
     matching the active model needs to actually be set; the others can stay
     unset until you switch. This is what gets billed for every scan.
   - `ANALYZE_PHOTO_MODEL` (optional) — which model to use for photo
     analysis, and implicitly which provider (`providerFor()` in
     `analyze-photo/index.ts` picks the provider from the model name's
     prefix). Defaults to `gpt-4o-mini` (OpenAI, cheapest vision-capable
     option there) if unset. To switch providers or models later, just set
     this secret to the new model ID and make sure that provider's API key
     secret is also set — no code change or redeploy needed. **Whatever
     model you set must already have a price entry in `MODEL_PRICING`
     inside `analyze-photo/index.ts`, or cost tracking silently logs $0 for
     every call** — add the entry first. Current entries (checked against
     each provider's own pricing page 2026-08-09):
     - Anthropic: Haiku 4.5 ($1/$5 per MTok), Sonnet 5 ($2/$10 through
       2026-08-31, then $3/$15), Opus 5 ($5/$25), Fable 5 ($10/$50).
     - OpenAI: gpt-4o-mini ($0.15/$0.60), gpt-4o ($2.50/$10).
     - Gemini: gemini-2.5-flash ($0.30/$2.50, standard non-batch tier).
     Whatever model you pick also needs to support image input — Perplexity
     and DeepSeek were considered and ruled out for this endpoint since
     neither documents vision/image-input support in their public APIs as
     of this check.
6. **Wire the app's config**: set `apiBase` in the app's `app.json`
   (`expo.extra.apiBase`) to `https://<your-project-ref>.supabase.co`, and
   the Supabase anon key + URL wherever the app's auth client gets set up.

### Paused for now — resume when payment work restarts

4. **Set `REVENUECAT_WEBHOOK_SECRET`**, deploy `revenuecat-webhook`, create a
   RevenueCat project (revenuecat.com), configure the $9/month + 7-day-trial
   product, and point RevenueCat's webhook at
   `https://<your-project-ref>.supabase.co/functions/v1/revenuecat-webhook`.
5. Needs the **Apple Developer account** (still not set up) for App Store
   Connect's subscription product and a real Dev Client build — RevenueCat's
   SDK, like every native module hit building this and the last app, does
   not run inside Expo Go.

None of the paused steps block deploying and testing everything else above —
auth, groups, referral attribution, and the analyze-photo scan flow (once
the entitlement gate is either satisfied by a manually-inserted
`subscription_status` row for testing, or temporarily relaxed) all work
without RevenueCat in the picture.
