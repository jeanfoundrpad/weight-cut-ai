# Weight Cut AI

AI photo calorie tracking built specifically for fighters managing a weight
cut. Clean-room build — proprietary, not derived from any AGPL or otherwise
separately-licensed codebase. See [LICENSE](LICENSE) and `AGENTS.md`.

## Status (built overnight — everything below is real, working code, not stubs of stubs)

**Mobile app** — builds clean, zero typecheck errors, bundles successfully
in Expo Go (SDK 54, matched to your installed Expo Go client on purpose —
see `AGENTS.md`). Full flow: welcome → body stats → fight-cut goal (target
weight + weigh-in date, same math family as the earlier app but
independently reimplemented) → plan reveal → account creation → paywall →
scan/log/history/profile tabs.

**What's mocked, and why, clearly marked in code**:
- `lib/entitlement.ts` — subscription status. Real version calls
  RevenueCat; RevenueCat's SDK is a native module that can't run in Expo
  Go, same wall hit repeatedly building the last app. Fully swappable,
  isolated to one function.
- `lib/aiProxy.ts` — falls back to a labeled placeholder estimate when no
  backend is configured. Once you deploy the backend (see below) and set
  `apiBase` in `app.json`, this calls it for real.
- `lib/supabaseClient.ts` / the account-creation screen — same story;
  gracefully skips forward when `supabaseUrl`/`supabaseAnonKey` aren't set.

**Backend** (`backend/`) — Supabase migrations + two Edge Functions,
written and reviewed but **not deployed** (needs your own Supabase
project). Full setup steps in `backend/README.md`.

## What needs you, specifically, before this goes further

1. **Create a Supabase project** and follow `backend/README.md` to deploy
   the schema and both Edge Functions. Free tier is enough to start.
2. **Get an Anthropic API key** (or swap `analyze-photo` for a different
   provider) — this is what actually gets billed per scan.
3. **Apple Developer account** — still the same blocker noted for the
   earlier app. Needed for App Store Connect (to create the actual $9/mo
   subscription product with its 7-day trial) and to build a real Dev
   Client, since RevenueCat's SDK — like every native module hit so far —
   won't run in Expo Go.
4. **Create a RevenueCat project**, configure the subscription product,
   point its webhook at your deployed `revenuecat-webhook` function.
5. Decide on final branding/app icon — "Weight Cut AI" and the current look
   are both easy to change; nothing below is locked in.

## Explicitly not built yet (deferred on purpose, see the plan this was built from)

Local nutrition-database matching (app currently logs the AI's direct
estimate — this is what the reference product it's competing with appears
to do too), confidence bands, adaptive calorie-target adjustment,
gram-estimation refinement, barcode scanning, saved meals. All real
Phase 2 differentiators, sequenced after there's a working, payable
product to learn from — not missing by accident.

## Running it

```
npm install
npx expo start
```

Scan the QR with Expo Go (SDK 54). Runs fully standalone right now with
every backend call mocked — no external accounts needed to see the whole
flow end to end.
