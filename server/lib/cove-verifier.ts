/**
 * R123 — Chain-of-Verification (CoVe) Verifier
 *
 * Implements Dhuliawala et al. (Meta FAIR, Sept 2023, arXiv:2309.11495) for
 * single-model longform factuality hardening. NOT a generator — caller provides
 * the draft; this helper runs the 4-step CoVe pipeline:
 *
 *   1. (caller) Generate baseline draft.
 *   2. PLAN: Extract atomic factual claims from the draft and rewrite each as
 *      a standalone verification question.
 *   3. EXECUTE INDEPENDENTLY: Answer each question in a FRESH context that
 *      does NOT include the original draft. This is the core trick — the model
 *      can't repeat its own bias if it can't see what it previously wrote.
 *   4. REVISE: Show the model its draft + the independent Q/A pairs, ask it
 *      to flag contradictions and rewrite using only verified facts.
 *
 * Why it pays rent on VisionClaw:
 *   - Cheaper than ensemble_query (single model, multiple short calls vs N
 *     proposers + κ math) — good for the "narrative correctness on a longform
 *     paragraph" surface that the MoA jury is overkill for.
 *   - Single-model independence ≈ what AEvo grading wants but doesn't have
 *     for plain-text claims.
 *
 * NOT a hallucination silver bullet. The Dhuliawala paper reports ~5–25% lift
 * on factuality benchmarks, not the "94%" influencer math floating around.
 * Treat the output as a "second pass" that catches obvious contradictions.
 */

import { getClientForModel, getModelForTierAsync } from "../providers";
import { logSilentCatch } from "./silent-catch";

export interface CoVeOptions {
  draft: string;
  topic?: string;
  tenantId: number;
  maxQuestions?: number; // 1..15, default 8
  modelTier?: "fast" | "balanced" | "powerful"; // default "balanced"
}

export interface CoVeQA {
  question: string;
  answer: string;
}

export interface CoVeContradiction {
  question: string;
  draftClaim: string;
  independentAnswer: string;
  note: string;
}

export interface CoVeResult {
  revised: string;
  unchanged: boolean;
  claimsExtracted: number;
  questionsAsked: number;
  questionsAnswered: number;
  contradictions: CoVeContradiction[];
  qa: CoVeQA[];
  modelUsed: string;
  durationMs: number;
  /** If a step failed, this is the human-readable reason; result.revised falls back to the input draft. */
  warning?: string;
}

const MAX_DRAFT_CHARS = 16_000; // hard cap so a runaway draft can't burn budget
const PER_QUESTION_TIMEOUT_MS = 30_000;

function clampQuestions(n: number | undefined): number {
  if (!Number.isFinite(n as number)) return 8;
  return Math.max(1, Math.min(15, Math.floor(n as number)));
}

function sanitizeDraft(s: string): string {
  return String(s || "").slice(0, MAX_DRAFT_CHARS);
}

function parseJsonLoose<T = any>(s: string): T | null {
  if (!s) return null;
  // Strip code fences and grab first {...} or [...] block.
  const stripped = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch (_silentErr) { logSilentCatch("server/lib/cove-verifier.ts", _silentErr); }
  const m = stripped.match(/[\[{][\s\S]*[\]}]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/**
 * Step 2 — Plan verification questions.
 * Input: the draft. Output: { questions: string[], claims: string[] }
 * Each question must be answerable independently (no pronouns referring to
 * the draft, no "as mentioned above", etc.) so step 3 can run in a fresh
 * context.
 */
async function planVerifications(
  modelId: string,
  actualModelId: string,
  client: any,
  draft: string,
  topic: string | undefined,
  maxQuestions: number,
): Promise<{ questions: string[]; claims: string[] }> {
  const system = [
    "You are a fact-checking analyst.",
    "Read the DRAFT and identify the most checkable atomic factual claims —",
    "names, dates, numbers, attributions, causal statements, definitions.",
    "For each claim, write ONE standalone verification question that someone",
    "with no prior context could answer. Avoid pronouns like 'it', 'they',",
    "'this'; restate the subject each time. Skip opinions and stylistic choices.",
    `Return AT MOST ${maxQuestions} questions, prioritizing the highest-risk claims.`,
    'Output ONLY valid JSON of the form: {"items":[{"claim":"...","question":"..."}]}',
  ].join(" ");
  const user = [
    topic ? `TOPIC: ${topic}` : "",
    "DRAFT:",
    draft,
  ].filter(Boolean).join("\n\n");
  const r = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 1200,
    response_format: { type: "json_object" },
  });
  const raw = r?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonLoose<{ items?: { claim?: string; question?: string }[] }>(raw);
  const items = Array.isArray(parsed?.items) ? parsed!.items! : [];
  const questions: string[] = [];
  const claims: string[] = [];
  for (const it of items.slice(0, maxQuestions)) {
    const q = String(it?.question || "").trim();
    const c = String(it?.claim || "").trim();
    if (q && c) {
      questions.push(q);
      claims.push(c);
    }
  }
  return { questions, claims };
}

/**
 * Step 3 — Execute verification questions INDEPENDENTLY.
 * Fresh context per call. No draft visible. Parallel.
 */
async function answerIndependently(
  modelId: string,
  actualModelId: string,
  client: any,
  question: string,
  topic: string | undefined,
): Promise<string> {
  const system = [
    "You are a careful fact-checker.",
    "Answer the question in 1-3 short sentences using ONLY what you know with",
    "high confidence. If you are uncertain or do not know, say exactly:",
    '"UNCERTAIN: <one-sentence reason>".',
    "Do not speculate. Do not add caveats unless they change the answer.",
  ].join(" ");
  const user = [
    topic ? `TOPIC CONTEXT (for disambiguation only, not a source): ${topic}` : "",
    `QUESTION: ${question}`,
  ].filter(Boolean).join("\n");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PER_QUESTION_TIMEOUT_MS);
  try {
    const r = await client.chat.completions.create(
      {
        model: actualModelId,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 220,
      },
      { signal: ctl.signal },
    );
    return String(r?.choices?.[0]?.message?.content || "").trim();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Step 4 — Revise using independent answers.
 * Returns { revised, contradictions, unchanged }.
 */
async function reviseWithVerifications(
  modelId: string,
  actualModelId: string,
  client: any,
  draft: string,
  claims: string[],
  qa: CoVeQA[],
  topic: string | undefined,
): Promise<{ revised: string; contradictions: CoVeContradiction[]; unchanged: boolean }> {
  const pairs = qa.map((p, i) => {
    const claim = claims[i] || "";
    return `Q${i + 1}: ${p.question}\nDRAFT_CLAIM: ${claim}\nINDEPENDENT_ANSWER: ${p.answer}`;
  }).join("\n\n");
  const system = [
    "You are a fact-checking revisor.",
    "You are given a DRAFT, a set of factual claims extracted from it, and",
    "INDEPENDENT_ANSWERS that were generated WITHOUT seeing the draft.",
    "Find every contradiction between DRAFT_CLAIM and INDEPENDENT_ANSWER.",
    "If INDEPENDENT_ANSWER is 'UNCERTAIN', treat the claim as UNVERIFIED — soften",
    "it in the revision (e.g. add 'reportedly' / 'some sources suggest') OR remove",
    "it if it's not load-bearing. If INDEPENDENT_ANSWER agrees, keep the claim.",
    "If INDEPENDENT_ANSWER contradicts, replace the claim with the independent fact.",
    "Preserve the draft's structure, tone, and length. Do not add new content.",
    'Output ONLY valid JSON: {"revised":"<full revised text>","contradictions":[{"question":"...","draftClaim":"...","independentAnswer":"...","note":"..."}],"unchanged":<boolean>}',
    "Set unchanged=true only if NO contradictions or UNCERTAINs needed correction.",
  ].join(" ");
  const user = [
    topic ? `TOPIC: ${topic}` : "",
    "DRAFT:",
    draft,
    "",
    "VERIFICATION PAIRS:",
    pairs,
  ].filter(Boolean).join("\n\n");
  const r = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: Math.min(4000, Math.max(800, Math.ceil(draft.length / 2))),
    response_format: { type: "json_object" },
  });
  const raw = r?.choices?.[0]?.message?.content || "";
  const parsed = parseJsonLoose<{ revised?: string; contradictions?: any[]; unchanged?: boolean }>(raw);
  if (!parsed || typeof parsed.revised !== "string") {
    // Couldn't parse — refuse to corrupt the draft; throw so the outer
    // try/catch in verifyWithCoVe surfaces a warning per the fail-safe
    // contract ("on any failure, original draft + warning").
    throw new Error("revise step returned malformed JSON (no string `revised` field)");
  }
  const contradictions: CoVeContradiction[] = Array.isArray(parsed.contradictions)
    ? parsed.contradictions.map((c: any) => ({
        question: String(c?.question || ""),
        draftClaim: String(c?.draftClaim || ""),
        independentAnswer: String(c?.independentAnswer || ""),
        note: String(c?.note || ""),
      }))
    : [];
  return {
    revised: parsed.revised,
    contradictions,
    unchanged: Boolean(parsed.unchanged) && contradictions.length === 0,
  };
}

/**
 * Public entry point. Always returns a result — never throws — so callers
 * can wire it as an opt-in pass without worrying about pipeline failure.
 * On any internal failure, falls back to returning the original draft with
 * `warning` set.
 */
export async function verifyWithCoVe(opts: CoVeOptions): Promise<CoVeResult> {
  const t0 = Date.now();
  const draft = sanitizeDraft(opts.draft);
  const maxQuestions = clampQuestions(opts.maxQuestions);
  const tier = opts.modelTier || "balanced";
  let modelId = "";
  try {
    if (!draft || draft.trim().length < 80) {
      return {
        revised: draft,
        unchanged: true,
        claimsExtracted: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
        contradictions: [],
        qa: [],
        modelUsed: "",
        durationMs: Date.now() - t0,
        warning: "draft too short to verify (<80 chars)",
      };
    }
    modelId = await getModelForTierAsync(tier, opts.tenantId);
    const { client, actualModelId } = await getClientForModel(modelId, opts.tenantId);

    // Step 2: plan
    const { questions, claims } = await planVerifications(
      modelId,
      actualModelId,
      client,
      draft,
      opts.topic,
      maxQuestions,
    );
    if (questions.length === 0) {
      return {
        revised: draft,
        unchanged: true,
        claimsExtracted: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
        contradictions: [],
        qa: [],
        modelUsed: modelId,
        durationMs: Date.now() - t0,
        warning: "planner extracted 0 verifiable claims",
      };
    }

    // Step 3: execute independently, parallel
    const answers = await Promise.allSettled(
      questions.map((q) => answerIndependently(modelId, actualModelId, client, q, opts.topic)),
    );
    const qa: CoVeQA[] = [];
    for (let i = 0; i < questions.length; i++) {
      const a = answers[i];
      if (a.status === "fulfilled" && a.value) {
        qa.push({ question: questions[i], answer: a.value });
      } else {
        qa.push({ question: questions[i], answer: "UNCERTAIN: verification call failed" });
      }
    }

    // Step 4: revise
    const { revised, contradictions, unchanged } = await reviseWithVerifications(
      modelId,
      actualModelId,
      client,
      draft,
      claims,
      qa,
      opts.topic,
    );

    return {
      revised: revised || draft,
      unchanged,
      claimsExtracted: claims.length,
      questionsAsked: questions.length,
      questionsAnswered: qa.length,
      contradictions,
      qa,
      modelUsed: modelId,
      durationMs: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      revised: draft,
      unchanged: true,
      claimsExtracted: 0,
      questionsAsked: 0,
      questionsAnswered: 0,
      contradictions: [],
      qa: [],
      modelUsed: modelId,
      durationMs: Date.now() - t0,
      warning: `CoVe failed: ${e?.message || String(e)}`,
    };
  }
}
