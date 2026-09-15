// R98.16 #4 + #8 — Multi-lineage architect review with productive-only
// counting toward minResponses.
//
// Why lineage diversity matters: OpenAI / Anthropic / Google share enough
// training data + RLHF lineage that they have correlated blind spots
// (e.g. all three rate the same prompt-injection vector as benign). Adding
// a non-Western lineage (DeepSeek via OpenRouter — Alibaba/Baidu data
// distribution) catches things the big-three miss.
//
// IJFW called this their "Trident" pattern. We already had OpenAI +
// Anthropic + Gemini reachable; DeepSeek arrived via OpenRouter as
// `deepseek/deepseek-v3.2`, so the fourth lineage is a no-cost add.
//
// `minResponsesFanOut` (#8): when fanning out to N reviewers with a
// minResponses gate, only PRODUCTIVE results (success === true) count
// toward early exit. Failed/timed-out auditors don't satisfy the gate.
// Without this, two failed model calls would falsely satisfy minResponses=2
// and the reviewer pool would short-circuit on noise.

import { runLlmTask } from "../llm-task";
import { translateLlmError, type TranslatedError } from "./translate-llm-error";

export type Lineage = "openai" | "anthropic" | "google" | "deepseek";

/**
 * Default lineage → model id. DeepSeek goes through OpenRouter as
 * `deepseek/deepseek-v3.2` (already in our stack — see ideation-engine.ts,
 * tree-of-thought.ts). The other three are already-in-registry models.
 */
export const LINEAGE_DEFAULTS: Record<Lineage, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-2.5-flash",
  deepseek: "deepseek/deepseek-v3.2",
};

export interface ReviewerResult {
  lineage: Lineage;
  model: string;
  success: boolean;
  json?: any;
  durationMs: number;
  error?: string;
  /** Set when success=false — operator-friendly error explanation. */
  translated?: TranslatedError;
}

export interface MultiLineageInput {
  prompt: string;
  schema?: Record<string, any>;
  lineages?: Lineage[];           // default: all four
  minResponses?: number;          // productive-only count; default: ceil(N/2)
  perReviewerTimeoutMs?: number;  // default: 45000
  totalTimeoutMs?: number;        // default: 90000 — overall cap
  tenantId?: number;
  thinking?: "off" | "low" | "medium" | "high";
  temperature?: number;
  maxTokens?: number;
}

export interface MultiLineageOutput {
  productive: ReviewerResult[];   // success === true, in arrival order
  failed: ReviewerResult[];       // success === false
  satisfiedMinResponses: boolean; // productive.length >= minResponses
  earlyExit: boolean;             // returned before all reviewers finished
  totalDurationMs: number;
}

/**
 * Fan out a prompt to multiple LLM lineages in parallel, returning as soon
 * as `minResponses` PRODUCTIVE results arrive (or all reviewers settle).
 * Failures are collected separately and never count toward minResponses.
 */
export async function runMultiLineageReview(input: MultiLineageInput): Promise<MultiLineageOutput> {
  const t0 = Date.now();
  const lineages = input.lineages?.length ? input.lineages : (Object.keys(LINEAGE_DEFAULTS) as Lineage[]);
  const minResponses = input.minResponses ?? Math.ceil(lineages.length / 2);
  const perTimeout = input.perReviewerTimeoutMs ?? 45000;
  const totalTimeout = input.totalTimeoutMs ?? 90000;

  const productive: ReviewerResult[] = [];
  const failed: ReviewerResult[] = [];
  let earlyExit = false;
  let resolveEarly: (() => void) | null = null;
  const earlyExitPromise = new Promise<void>((r) => { resolveEarly = r; });

  const tasks = lineages.map(async (lineage): Promise<ReviewerResult> => {
    const model = LINEAGE_DEFAULTS[lineage];
    const r0 = Date.now();
    try {
      const res = await runLlmTask({
        tenantId: input.tenantId,
        prompt: input.prompt,
        schema: input.schema,
        model,
        timeoutMs: perTimeout,
        thinking: input.thinking,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      if (res.success) {
        const ok: ReviewerResult = { lineage, model, success: true, json: res.json, durationMs: Date.now() - r0 };
        productive.push(ok);
        // Productive-only minResponses gate (#8).
        if (productive.length >= minResponses && resolveEarly) { earlyExit = true; resolveEarly(); resolveEarly = null; }
        return ok;
      }
      const t = translateLlmError(res.error || "model returned success=false");
      const bad: ReviewerResult = { lineage, model, success: false, error: res.error, translated: t, durationMs: Date.now() - r0 };
      failed.push(bad);
      return bad;
    } catch (e: any) {
      const t = translateLlmError(e);
      const bad: ReviewerResult = { lineage, model, success: false, error: e?.message || String(e), translated: t, durationMs: Date.now() - r0 };
      failed.push(bad);
      return bad;
    }
  });

  const allSettled = Promise.allSettled(tasks);
  const totalDeadline = new Promise<void>((r) => setTimeout(r, totalTimeout));
  await Promise.race([allSettled, earlyExitPromise, totalDeadline]);

  return {
    productive,
    failed,
    satisfiedMinResponses: productive.length >= minResponses,
    earlyExit,
    totalDurationMs: Date.now() - t0,
  };
}
