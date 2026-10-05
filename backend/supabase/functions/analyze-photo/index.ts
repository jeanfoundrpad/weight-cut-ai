// Weight Cut AI — AI vision proxy.
//
// The one endpoint every paying user hits repeatedly. Three jobs, in
// order, each a real cost/abuse control: (1) confirm there's an active
// entitlement before spending anything on the AI call, (2) apply a daily
// scan cap so one account can't run up an unbounded bill, (3) log real
// token usage so unit economics are visible from day one — not something
// to bolt on after costs are already a mystery.
//
// This is a paid subscription product, not BYOK — the AI provider key is
// this function's own secret, never something the client holds or sends.
// Multi-provider on purpose: not locked to one lab, matching Cursor's own
// "integrates models from OpenAI, Anthropic, and Google" reasoning for
// avoiding being "just a wrapper" around a single provider.
//
// Two intents share everything below (auth, entitlement, rate limit,
// provider dispatch, cost logging) and only differ in prompt + response
// shape: "log" (default) turns a meal photo into loggable items, "suggest"
// turns a photo of raw/uncooked ingredients (a fridge, a pantry, groceries)
// plus the caller's remaining calorie/macro budget into 2-3 meal ideas
// built from what's actually visible. Kept as one function rather than two
// specifically so the cost controls can't be bypassed by hitting a
// differently-audited second endpoint.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Split rather than one shared 30/day cap: "suggest" is a browsable,
// experimentation-prone feature (nice to have, not core), and a shared
// cap let repeated suggestion attempts crowd out a user's actual ability
// to log meals that day. The two still sum to the old ceiling.
const MAX_LOG_SCANS_PER_DAY = 25
const MAX_SUGGEST_SCANS_PER_DAY = 5
// A 7-day plan is a bigger single output than a log/suggest call, and
// "manually regenerate if you don't like it" (Jean's call) only needs a
// couple of retries, not a browsable-many-times budget like "suggest".
const MAX_MEAL_PLAN_PER_DAY = 3
// ~6MB decoded (base64 is ~4/3 the decoded size) — generous headroom over a
// compressed phone photo, cheap fail-fast guard before the paid AI call.
const MAX_IMAGE_BASE64_LENGTH = 8_000_000

// Server-side only, deliberately not something a client can pass in — a
// client-selectable model would let a tampered/malicious caller pick the
// most expensive one and run up the bill, same class of hole as everything
// else this function guards against. Set ANALYZE_PHOTO_MODEL as a Supabase
// Edge Function secret to change it (and, implicitly, the provider — see
// providerFor() below) without a code change. Moved from gpt-4o-mini to
// gpt-4o (2026-08-10, Jean's call, "faster and more accurate for
// scanning") after real accuracy concerns with mini — roughly 16.7x the
// per-call cost (both input and output scale the same ratio for this
// model family), worth knowing if the daily scan caps below ever need
// revisiting for margin. Switching to a Claude or Gemini model is still a
// one-line secret change, not a redeploy, as long as that provider's own
// API key secret is set.
const MODEL = Deno.env.get('ANALYZE_PHOTO_MODEL') ?? 'gpt-4o'

type Provider = 'anthropic' | 'openai' | 'gemini'

// Perplexity and DeepSeek were considered and deliberately left out — as of
// this check, neither documents image/vision input support in their public
// APIs (Perplexity's Sonar models are text/search-only; DeepSeek's models
// are text-only), so they can't power a "analyze this food photo" endpoint.
// Worth revisiting if either ships real vision support later, or for a
// future text-only feature that isn't this one.
function providerFor(model: string): Provider {
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-')) return 'openai'
  if (model.startsWith('gemini-')) return 'gemini'
  throw new Error(`Unrecognized model "${model}" — no known provider prefix (claude-/gpt-/gemini-).`)
}

// Prices per each provider's own pricing page, checked 2026-08-09. Whatever
// model MODEL points at MUST have an entry here or cost tracking silently
// reports $0 for it — see the fallback below. Any model used here also
// needs to actually support image input.
const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  // Anthropic (platform.claude.com/docs/en/about-claude/pricing)
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
  // Introductory price through 2026-08-31; becomes $3 / $15 on 2026-09-01 — update this row then.
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-fable-5': { inputPerMTok: 10, outputPerMTok: 50 },
  // OpenAI (platform.openai.com/docs/pricing)
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  // Google Gemini (ai.google.dev/gemini-api/docs/pricing), standard (non-batch) paid tier
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
}

// Calorie and carb accuracy specifically were flagged as weak (Jean,
// 2026-08-10) — the original version of this prompt was a one-line "guess
// the nutrition" instruction with no portion-reference methodology, no
// prompt toward the calorie/carb sources that are easy to miss visually
// (oil, sauces, glazes, breading), and no cross-check step. This version
// encodes the same reasoning a careful human estimator would actually use,
// even though the model still only returns the final JSON — the steps
// shape what it computes, not what it shows.
const LOG_SYSTEM_PROMPT = `You are a nutrition estimator specializing in accurate calorie and
carbohydrate estimation from food photos. Given a photo of food or drink, identify each distinct
item and estimate its nutrition, including drinks and zero-calorie items like plain water, black
coffee, or diet soda (use 0 for calories/macros when that's genuinely accurate, rather than
omitting the item).

Work through each item before answering:
1. Identify the food and how it was prepared (fried, grilled, steamed, baked, raw, sauced,
   glazed, breaded). Preparation changes calorie and carb density substantially even when two
   foods look visually similar — fried rice vs. steamed rice, breaded vs. plain chicken. Prefer
   the plain, literal identification over a named dish unless the photo actually shows that
   dish's other components — a plate of plain grilled chicken pieces is "grilled chicken breast,"
   not "chicken salad," and calling it the wrong dish silently pulls in that dish's usual
   ingredients and skews every macro, not just the label.
2. Count discrete items precisely rather than defaulting to one. A four-egg omelette is four
   eggs' worth of protein and fat even though you can't see four separate eggs once they're
   mixed and cooked — judge total volume/mass against the dish (an omelette filling most of a
   dinner plate is not a one-egg omelette), not just "how many egg-shaped things are visible."
   The same applies to slices of cheese, pieces of bacon, or any other item that can appear more
   than once in a photo — count what's actually there.
3. Estimate portion mass in grams using visual reference cues rather than an arbitrary guess: a
   standard dinner plate is about 25-28cm (10-11in) across, a fork is about 18-20cm, a
   deck-of-cards-sized portion of meat is roughly 85g, and a fist-sized portion of cooked
   rice/pasta is roughly 150-200g. Alongside the gram figure, also give a natural serving
   description a person would actually say out loud — "1 cup," "2 tablespoons," "1 medium," "3
   large eggs" — matched to the food (cups/tablespoons for loose or liquid foods, a count for
   discrete items, "small/medium/large" for whole produce), not a generic fallback.
4. Actively look for calorie- and carb-dense components that are easy to miss: cooking oil or
   butter (a visible sheen or shine implies real added fat — a couple of tablespoons used in
   cooking adds 25-30g of fat that never shows up as its own item on the plate), sauces,
   dressings, glazes, and sugar or starch in marinades or coatings. These are a more common
   source of underestimated meals than the main visible ingredient, and the single biggest
   reason a photo-based estimate misses badly.
5. For carbohydrates specifically, account for every carb source separately rather than
   estimating from only the most obvious one: the visible starch (rice, bread, pasta, potatoes),
   any breading or batter, and any sugar in sauces, glazes, dressings, or drinks.
6. Sanity-check that your calorie estimate matches your grams estimate at a plausible caloric
   density for that food (for example, cooked white rice is roughly 130 kcal/100g and olive oil
   is roughly 880 kcal/100g) — if the implied density is far outside what's normal for that food,
   reconsider the estimate before answering.

Respond with ONLY a JSON object, no other text, shaped exactly like:
{"items":[{"label":"grilled chicken breast","servingLabel":"1 medium breast","grams":170,"calories":280,"proteinG":53,"carbsG":0,"fatG":6}]}
"servingLabel" is the natural serving description from step 3 (use null if nothing more useful
than the gram figure applies, e.g. an already-precise weighed item). Grams and macros are your
best estimate for the portion actually visible in the photo. Only respond with {"items":[]} if
the photo genuinely shows no food or drink at all.`

const LOG_USER_PROMPT = 'Estimate the nutrition for the food in this photo.'

const SUGGEST_SYSTEM_PROMPT = `You are a meal-planning assistant for a combat-sport athlete managing a
weight cut. Given a photo of raw, uncooked ingredients (a fridge, a pantry, or groceries just
bought) and the athlete's remaining calorie and macro budget for today, suggest up to 3 realistic
meal ideas built from ingredients actually visible in the photo, sized in portions that help hit
that remaining budget without meaningfully exceeding it. Respond with ONLY a JSON object, no
other text, shaped exactly like:
{"suggestions":[{"title":"Grilled steak and eggs","items":[{"label":"steak","servingLabel":"1 medium steak","grams":150,"calories":330,"proteinG":31,"carbsG":0,"fatG":22},{"label":"eggs","servingLabel":"2 large eggs","grams":100,"calories":155,"proteinG":13,"carbsG":1,"fatG":11}]}]}
"servingLabel" is a natural serving description a person would say out loud (use null if nothing
more useful than the gram figure applies). Every item must include it — do not omit the key.
Only use ingredients actually visible in the photo — never invent ones that aren't there. If
nothing usable for a meal is visible, respond with {"suggestions":[]}.`

const MEAL_PLAN_SYSTEM_PROMPT = `You are a meal-planning assistant for a combat-sport athlete managing a
weight cut. Given the athlete's daily calorie and macro targets and a requested number of days,
build a realistic meal plan (3-4 meals per day unless told otherwise) that hits those targets each
day using ordinary, easy-to-prepare food, not exotic or hard-to-source ingredients. Vary the meals
across the plan rather than repeating the same few days on a loop. If the athlete lists dietary
restrictions or allergies, treat them as a hard requirement, never include a restricted ingredient
or an obvious derivative of one, even if it makes hitting the macro target harder. Respond with
ONLY a JSON object, no other text, shaped exactly like:
{"days":[{"day":1,"meals":[{"title":"Grilled chicken and rice","items":[{"label":"chicken breast","servingLabel":"1 medium breast","grams":170,"calories":280,"proteinG":53,"carbsG":0,"fatG":6}]}]}]}
"day" is 1 through the requested number of days, one entry per day, no gaps or repeats of the day
number. Every item must include "servingLabel", a natural serving description a person would say
out loud (use null if nothing more useful than the gram figure applies). Each day's items should
sum close to the given targets without meaningfully exceeding them.`

// Built as a list of sentences rather than one long template literal --
// restrictions/notes/previousFeedback are all optional and each needs its
// own conditional clause, which turns unreadable fast as one inline
// ternary chain.
function buildMealPlanPrompt(body: {
  targetKcal?: number; targetProteinG?: number; targetCarbsG?: number; targetFatG?: number
  planDays?: number; mealsPerDay?: number; restrictions?: string; notes?: string; previousFeedback?: string
}): string {
  const days = body.planDays && body.planDays > 0 ? body.planDays : 7
  const parts = [
    `Build a ${days}-day meal plan. My daily target is about ${Math.round(body.targetKcal ?? 0)} kcal, ` +
      `${Math.round(body.targetProteinG ?? 0)}g protein, ${Math.round(body.targetCarbsG ?? 0)}g carbs, and ` +
      `${Math.round(body.targetFatG ?? 0)}g fat.`,
  ]
  if (body.mealsPerDay) parts.push(`I want ${body.mealsPerDay} meals per day.`)
  if (body.restrictions?.trim()) parts.push(`Dietary restrictions/allergies, must follow: ${body.restrictions.trim()}.`)
  if (body.notes?.trim()) parts.push(`Other preferences: ${body.notes.trim()}.`)
  if (body.previousFeedback?.trim()) {
    parts.push(`Feedback on the last plan I generated, apply this to the new one: ${body.previousFeedback.trim()}.`)
  }
  return parts.join(' ')
}

interface AiResult {
  text: string
  inputTokens: number
  outputTokens: number
}

// Low, not zero: this is a numeric-estimation task, not a creative-writing
// one, so the default temperature (~1.0) just adds estimate-to-estimate
// jitter on the same photo without improving accuracy. Kept above 0 rather
// than fully deterministic to avoid degenerate/repetitive output on edge
// cases (e.g. genuinely ambiguous photos).
const ESTIMATION_TEMPERATURE = 0.2

async function callAnthropic(model: string, systemPrompt: string, userPrompt: string, imageBase64: string | null, maxTokens: number): Promise<AiResult> {
  const content = imageBase64
    ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } }, { type: 'text', text: userPrompt }]
    : userPrompt
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: ESTIMATION_TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`)
  const result = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
    usage: { input_tokens: number; output_tokens: number }
  }
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}'
  return { text, inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }
}

async function callOpenAI(model: string, systemPrompt: string, userPrompt: string, imageBase64: string | null, maxTokens: number): Promise<AiResult> {
  const content = imageBase64
    ? [{ type: 'text', text: userPrompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }]
    : userPrompt
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY') ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: ESTIMATION_TEMPERATURE,
      response_format: { type: 'json_object' }, // OpenAI-specific: forces valid JSON, no fence-stripping needed
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`)
  const result = (await res.json()) as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }
  const text = result.choices[0]?.message?.content ?? '{}'
  return { text, inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens }
}

async function callGemini(model: string, systemPrompt: string, userPrompt: string, imageBase64: string | null, maxTokens: number): Promise<AiResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const parts = imageBase64
    ? [{ text: userPrompt }, { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }]
    : [{ text: userPrompt }]
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: ESTIMATION_TEMPERATURE, maxOutputTokens: maxTokens },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`)
  const result = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text?: string }> } }>
    usageMetadata: { promptTokenCount: number; candidatesTokenCount: number }
  }
  const text = result.candidates[0]?.content?.parts?.find((p) => p.text)?.text ?? '{}'
  return { text, inputTokens: result.usageMetadata.promptTokenCount, outputTokens: result.usageMetadata.candidatesTokenCount }
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401 })
  const userId = userData.user.id

  // Free launch (Jean's call, 2026-09-21): the app ships with no paywall
  // for now, real payments come in a later update. Every signed-in user is
  // entitled. subscription_status stays queried (not deleted) so it's
  // still there for anything that wants to know it, and so wiring
  // RevenueCat later is just replacing the line below with the real
  // gate, not rebuilding this from scratch. The old ALLOW_UNENTITLED_SCANS
  // testing-only bypass is gone -- it would otherwise be sitting right
  // next to `entitled = true` as confusing, pointless dead code.
  const { data: sub } = await supabase
    .from('subscription_status')
    .select('status, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  void sub
  const entitled = true

  if (!entitled) {
    return new Response(JSON.stringify({ error: 'no_active_subscription' }), { status: 402 })
  }

  let body: {
    imageBase64?: string
    intent?: 'log' | 'suggest' | 'meal-plan'
    remainingKcal?: number
    remainingProteinG?: number
    remainingCarbsG?: number
    remainingFatG?: number
    targetKcal?: number
    targetProteinG?: number
    targetCarbsG?: number
    targetFatG?: number
    planDays?: number
    mealsPerDay?: number
    restrictions?: string
    notes?: string
    previousFeedback?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 })
  }

  // Free-text fields flow straight into the AI prompt -- unbounded length
  // is a token-cost lever a tampered client could hammer (found by an
  // independent code review), same class of concern reserve_scan_slot
  // already guards on call *count*, this guards call *size*.
  const MAX_FREE_TEXT_LENGTH = 500
  if (body.restrictions) body.restrictions = body.restrictions.slice(0, MAX_FREE_TEXT_LENGTH)
  if (body.notes) body.notes = body.notes.slice(0, MAX_FREE_TEXT_LENGTH)
  if (body.previousFeedback) body.previousFeedback = body.previousFeedback.slice(0, MAX_FREE_TEXT_LENGTH)

  const { imageBase64 } = body
  const intent = body.intent === 'suggest' ? 'suggest' : body.intent === 'meal-plan' ? 'meal-plan' : 'log'
  // Clamped server-side regardless of what the UI offers (5/7/30) -- a
  // tampered client value feeding straight into the token budget below
  // would otherwise be a real cost-abuse lever.
  const planDays = Math.min(30, Math.max(1, Math.round(body.planDays ?? 7)))
  // Only log/suggest are vision calls -- meal-plan is text-only, built from
  // the caller's stored daily targets, not a photo.
  if (intent !== 'meal-plan' && !imageBase64) return new Response('Missing imageBase64', { status: 400 })

  // Reserve a slot atomically BEFORE the paid AI call, rather than counting
  // existing scan_usage rows after it — a plain check-then-insert here let
  // N concurrent requests all read the same pre-insert count and all pass
  // the cap (found by a Fable 5 security review). reserve_scan_slot() is a
  // single `INSERT ... ON CONFLICT DO UPDATE ... WHERE count < max`
  // statement, which Postgres serializes via row-level locking, so this is
  // atomic even under real concurrency.
  const dailyCap = intent === 'suggest' ? MAX_SUGGEST_SCANS_PER_DAY : intent === 'meal-plan' ? MAX_MEAL_PLAN_PER_DAY : MAX_LOG_SCANS_PER_DAY
  const { data: reserved, error: reserveError } = await supabase.rpc('reserve_scan_slot', {
    p_intent: intent,
    p_max: dailyCap,
  })
  if (reserveError) {
    console.error('reserve_scan_slot error', reserveError)
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })
  }
  if (!reserved) {
    return new Response(JSON.stringify({ error: 'daily_scan_limit_reached' }), { status: 429 })
  }
  if (imageBase64 && imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    await supabase.rpc('release_scan_slot', { p_intent: intent })
    return new Response(JSON.stringify({ error: 'image_too_large' }), { status: 413 })
  }

  const systemPrompt = intent === 'suggest' ? SUGGEST_SYSTEM_PROMPT : intent === 'meal-plan' ? MEAL_PLAN_SYSTEM_PROMPT : LOG_SYSTEM_PROMPT
  const userPrompt =
    intent === 'suggest'
      ? `Suggest meals using what's in this photo. I have about ${Math.round(body.remainingKcal ?? 0)} kcal, ` +
        `${Math.round(body.remainingProteinG ?? 0)}g protein, ${Math.round(body.remainingCarbsG ?? 0)}g carbs, and ` +
        `${Math.round(body.remainingFatG ?? 0)}g fat left for today.`
      : intent === 'meal-plan'
        ? buildMealPlanPrompt({ ...body, planDays })
        : LOG_USER_PROMPT

  // A 30-day plan's JSON is far larger than a single meal's -- a flat cap
  // sized for "log"/"suggest" truncates a real long plan mid-object,
  // producing unparseable JSON (silently falls back to an empty plan
  // below). Scaled by requested days only for meal-plan; log/suggest keep
  // a fixed, generous-enough budget.
  const maxTokens = intent === 'meal-plan' ? Math.min(16000, 800 + planDays * 380) : 2048

  let aiResult: AiResult
  try {
    const provider = providerFor(MODEL)
    aiResult =
      provider === 'anthropic' ? await callAnthropic(MODEL, systemPrompt, userPrompt, imageBase64 ?? null, maxTokens)
      : provider === 'openai' ? await callOpenAI(MODEL, systemPrompt, userPrompt, imageBase64 ?? null, maxTokens)
      : await callGemini(MODEL, systemPrompt, userPrompt, imageBase64 ?? null, maxTokens)
  } catch (e) {
    console.error('AI provider error', e)
    // Give the reserved slot back — a transient provider error shouldn't
    // silently cost the user one of their daily scans.
    await supabase.rpc('release_scan_slot', { p_intent: intent })
    return new Response(JSON.stringify({ error: 'ai_provider_error' }), { status: 502 })
  }

  const pricing = MODEL_PRICING[MODEL]
  if (!pricing) {
    // Don't fabricate a number for a model with no known price — $0 is an
    // obvious, visible red flag in scan_usage; a wrong guess wouldn't be.
    console.error(`No MODEL_PRICING entry for "${MODEL}" — add one before relying on cost tracking. Logging $0 for this call.`)
  }
  const costUsd = pricing
    ? (aiResult.inputTokens / 1_000_000) * pricing.inputPerMTok + (aiResult.outputTokens / 1_000_000) * pricing.outputPerMTok
    : 0

  await supabase.from('scan_usage').insert({
    user_id: userId,
    tokens_in: aiResult.inputTokens,
    tokens_out: aiResult.outputTokens,
    cost_usd: costUsd,
    intent,
  })

  const fallback = intent === 'suggest' ? { suggestions: [] } : intent === 'meal-plan' ? { days: [] } : { items: [] }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(aiResult.text)
  } catch {
    parsed = fallback
  }

  return new Response(JSON.stringify(parsed), { status: 200, headers: { 'content-type': 'application/json' } })
})
