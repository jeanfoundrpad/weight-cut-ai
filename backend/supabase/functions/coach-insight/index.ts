// Weight Cut AI — adaptive-plan narration.
//
// lib/adaptiveTarget.ts (client-side, pure, tested) does the actual
// recalibration math and already produces a plain-language `reason`
// string with no AI involved — this function only exists to optionally
// make that message feel personal, not to compute anything itself. The
// payload it receives is exclusively already-computed numbers (old
// target, new target, streak, days of data); the model's job is to phrase
// them, never to invent or adjust a calorie number of its own. That
// boundary matters here specifically: this app's audience is actively
// cutting weight, and a hallucinated calorie figure is a real safety
// concern, not just a UX nitpick — so the actual math has exactly one
// source of truth (adaptiveTarget.ts), and this function isn't it.
//
// Same auth/entitlement/cost-tracking shape as analyze-photo, reusing its
// scan_slot_counters/scan_usage machinery under a new 'coach_insight'
// intent — deliberately not sharing its vision-specific call functions
// (different message shape, no image), so the provider dispatch here is
// its own small, text-only version rather than a forced abstraction over
// two different request shapes.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const MAX_INSIGHTS_PER_DAY = 5

// Independent of ANALYZE_PHOTO_MODEL on purpose — this is a short
// text-only completion, not a vision task, so it doesn't need vision-tier
// accuracy or cost. Set COACH_INSIGHT_MODEL as its own secret to change it.
const MODEL = Deno.env.get('COACH_INSIGHT_MODEL') ?? 'gpt-4o-mini'

type Provider = 'anthropic' | 'openai' | 'gemini'

function providerFor(model: string): Provider {
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-')) return 'openai'
  if (model.startsWith('gemini-')) return 'gemini'
  throw new Error(`Unrecognized model "${model}" — no known provider prefix (claude-/gpt-/gemini-).`)
}

// Same source/date as analyze-photo's pricing table — kept as a separate
// copy since this function's model choice is independent (see MODEL above).
const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
}

const SYSTEM_PROMPT = `You are a plain-spoken coaching voice inside a calorie-tracking app for combat-sport
athletes managing a weight cut. You will be given a JSON object of already-computed facts about one
athlete's plan. Write a short message (2 to 4 sentences) explaining what changed and why, in the
athlete's own terms, using ONLY the numbers given to you. Never invent, estimate, adjust, or suggest
any calorie or macro number that isn't already present in the input. Never suggest eating below the
given target. No clinical jargon, no hype, no exclamation points, no em dashes or hyphens used as
connectors. Write in plain sentences. If deltaKcal is 0 or the data says nothing changed, write a
short, reassuring message that the plan is on track instead. Respond with ONLY a JSON object shaped
exactly like: {"message":"..."}`

interface AiResult {
  text: string
  inputTokens: number
  outputTokens: number
}

const TEMPERATURE = 0.4

async function callAnthropic(model: string, userPrompt: string): Promise<AiResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
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

async function callOpenAI(model: string, userPrompt: string): Promise<AiResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY') ?? ''}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      temperature: TEMPERATURE,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
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

async function callGemini(model: string, userPrompt: string): Promise<AiResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: TEMPERATURE },
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

  // Free launch (Jean's call, 2026-09-21) -- see analyze-photo/index.ts's
  // matching comment for the full reasoning. Same change here: every
  // signed-in user is entitled until real payments land.
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

  let rawBody: Record<string, unknown>
  try {
    rawBody = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 })
  }

  // Was `JSON.stringify(entire unvalidated body)` straight into the
  // prompt -- a tampered client could send arbitrary-length text (token
  // cost) or arbitrary instructions (prompt injection), with nothing
  // bounding either. Whitelisted to exactly the numeric/boolean fields
  // lib/coachClient.ts actually sends (found by an independent code
  // review); anything else in the request body is simply never read.
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const body = {
    daysOfData: num(rawBody.daysOfData),
    confidence: num(rawBody.confidence),
    previousTargetKcal: num(rawBody.previousTargetKcal),
    newTargetKcal: num(rawBody.newTargetKcal),
    deltaKcal: num(rawBody.deltaKcal),
    isMaterialChange: rawBody.isMaterialChange === true,
    wasFloorClamped: rawBody.wasFloorClamped === true,
  }

  const { data: reserved, error: reserveError } = await supabase.rpc('reserve_scan_slot', {
    p_intent: 'coach_insight',
    p_max: MAX_INSIGHTS_PER_DAY,
  })
  if (reserveError) {
    console.error('reserve_scan_slot error', reserveError)
    return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 })
  }
  if (!reserved) {
    return new Response(JSON.stringify({ error: 'daily_insight_limit_reached' }), { status: 429 })
  }

  const userPrompt = JSON.stringify(body)

  let aiResult: AiResult
  try {
    const provider = providerFor(MODEL)
    aiResult =
      provider === 'anthropic' ? await callAnthropic(MODEL, userPrompt)
      : provider === 'openai' ? await callOpenAI(MODEL, userPrompt)
      : await callGemini(MODEL, userPrompt)
  } catch (e) {
    console.error('AI provider error', e)
    await supabase.rpc('release_scan_slot', { p_intent: 'coach_insight' })
    return new Response(JSON.stringify({ error: 'ai_provider_error' }), { status: 502 })
  }

  const pricing = MODEL_PRICING[MODEL]
  if (!pricing) {
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
    intent: 'coach_insight',
  })

  let parsed: { message?: string }
  try {
    parsed = JSON.parse(aiResult.text)
  } catch {
    parsed = {}
  }

  return new Response(JSON.stringify({ message: parsed.message ?? null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
