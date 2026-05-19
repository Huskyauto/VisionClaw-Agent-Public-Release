/**
 * Active Clarification — R74.9
 *
 * Detects ambiguous user requests where guessing would produce a wrong or
 * irrelevant answer, and proposes a clarifying question to ask first.
 *
 * Two-stage gate to keep latency low:
 *   Stage 1: cheap heuristic (regex + word count). If clearly unambiguous,
 *            skip the LLM call and proceed normally.
 *   Stage 2: gpt-5.4 judge call ("is this question ambiguous? if so, what
 *            should we ask to disambiguate?"). Only fires when Stage 1 flags.
 *
 * Time budget: 1500ms. Fails open (no clarification) on any error.
 *
 * Disable via ACTIVE_CLARIFY_DISABLED=true.
 */

import { getClientForModel } from "./providers";

const JUDGE_MODEL = "gpt-5.4";
const TIME_BUDGET_MS = 1500;
const MIN_CONFIDENCE_TO_ASK = 0.7;

export interface ClarificationDecision {
  shouldAsk: boolean;
  question?: string;
  reason: string;
  confidence: number;
  totalMs: number;
}

const VAGUE_PRONOUN_RE = /\b(it|this|that|these|those|them)\b/i;
const VAGUE_NOUN_RE = /\b(thing|stuff|something|anything|everything|whatever)\b/i;
const BROAD_SCOPE_RE = /\b(everything|all\s+of|every\s+\w+|any\s+\w+|whatever)\b/i;

/**
 * Stage 1: cheap heuristic gate. Returns true if Stage 2 (LLM judge) should run.
 */
export function looksAmbiguous(
  userMessage: string,
  opts: { hasPriorContext?: boolean } = {},
): { ambiguous: boolean; reason: string } {
  const msg = (userMessage || "").trim();
  if (!msg) return { ambiguous: false, reason: "empty" };

  const wordCount = msg.split(/\s+/).length;

  // Very short messages without prior context are ambiguous by definition
  if (wordCount < 4 && !opts.hasPriorContext) {
    return { ambiguous: true, reason: `very short (${wordCount}w) without context` };
  }

  // Vague pronouns without prior context
  if (!opts.hasPriorContext && VAGUE_PRONOUN_RE.test(msg) && wordCount < 15) {
    return { ambiguous: true, reason: "vague pronoun without prior context" };
  }

  // Vague nouns at any length suggest under-specified intent
  if (VAGUE_NOUN_RE.test(msg) && wordCount < 20) {
    return { ambiguous: true, reason: "vague noun (thing/stuff/something)" };
  }

  // Broad scope words ("everything", "all of") in short messages
  if (BROAD_SCOPE_RE.test(msg) && wordCount < 12) {
    return { ambiguous: true, reason: "broad scope in short message" };
  }

  return { ambiguous: false, reason: "looks specific enough" };
}

/**
 * Stage 2: LLM judge call. Only invoked after Stage 1 flags.
 */
async function judgeAmbiguity(
  userMessage: string,
  tenantId: number,
  conversationContext?: string,
): Promise<{
  ambiguous: boolean;
  confidence: number;
  question: string;
  reason: string;
}> {
  const { client, actualModelId } = await getClientForModel(JUDGE_MODEL, tenantId);

  const ctx = conversationContext ? `Prior conversation context (last few turns):\n${conversationContext.slice(0, 800)}\n\n` : "";

  const prompt = `You are an ambiguity judge. Given a user message (and optional prior context), decide whether responding without clarification would risk giving the wrong answer.

${ctx}User message: ${userMessage}

A message is AMBIGUOUS if any of these apply:
- It uses vague pronouns ("it", "this") with no clear antecedent in context
- It refers to "the thing" / "the stuff" without specifying which
- It has multiple plausible interpretations with very different correct answers
- Critical scope is missing (e.g. "fix the bug" with no bug specified)
- It conflates multiple distinct asks that should be separated

A message is NOT ambiguous if:
- It is a clear, well-scoped request even if open-ended
- The intent is obvious from common-sense interpretation
- Prior context resolves the references

Reply ONLY with valid JSON:
{"ambiguous": boolean, "confidence": 0.0-1.0, "question": "the single best clarifying question to ask, or empty string if not ambiguous", "reason": "one short sentence"}`;

  const resp: any = await client.chat.completions.create({
    model: actualModelId,
    max_completion_tokens: 500,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const txt = resp?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(txt);
  return {
    ambiguous: !!parsed.ambiguous,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    question: String(parsed.question || "").slice(0, 400),
    reason: String(parsed.reason || "").slice(0, 200),
  };
}

/**
 * Main entry — decide whether to ask a clarifying question instead of guessing.
 */
export async function decideClarification(
  userMessage: string,
  opts: {
    tenantId: number;
    hasPriorContext?: boolean;
    conversationContext?: string;
  },
): Promise<ClarificationDecision> {
  const t0 = Date.now();
  const baseResult: ClarificationDecision = {
    shouldAsk: false,
    reason: "",
    confidence: 0,
    totalMs: 0,
  };

  // R74.12 — accept both "true" and "1" so the documented kill switch works.
  const flag = (process.env.ACTIVE_CLARIFY_DISABLED || "").toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes" || flag === "on") {
    return { ...baseResult, reason: "disabled by env", totalMs: Date.now() - t0 };
  }

  // Stage 1: cheap heuristic
  const stage1 = looksAmbiguous(userMessage, { hasPriorContext: opts.hasPriorContext });
  if (!stage1.ambiguous) {
    return { ...baseResult, reason: stage1.reason, totalMs: Date.now() - t0 };
  }

  console.log(`[active-clarify] stage 1 flagged: ${stage1.reason}`);

  // Stage 2: LLM judge
  try {
    const judged = await Promise.race([
      judgeAmbiguity(userMessage, opts.tenantId, opts.conversationContext),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIME_BUDGET_MS)),
    ]);

    if (!judged) {
      console.warn("[active-clarify] judge timeout — failing open");
      return { ...baseResult, reason: "judge timeout", totalMs: Date.now() - t0 };
    }

    const shouldAsk =
      judged.ambiguous &&
      judged.confidence >= MIN_CONFIDENCE_TO_ASK &&
      judged.question.length > 5;

    console.log(
      `[active-clarify] judge: ambiguous=${judged.ambiguous} conf=${judged.confidence.toFixed(2)} ask=${shouldAsk} reason="${judged.reason}"`,
    );

    return {
      shouldAsk,
      question: shouldAsk ? judged.question : undefined,
      reason: judged.reason,
      confidence: judged.confidence,
      totalMs: Date.now() - t0,
    };
  } catch (e: any) {
    console.warn(`[active-clarify] error (failing open): ${e.message}`);
    return { ...baseResult, reason: `error: ${e.message}`, totalMs: Date.now() - t0 };
  }
}
