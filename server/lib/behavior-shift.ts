// BEHAVIOR-SHIFT PROBE — SEED-inspired pre-jury inert-candidate filter.
//
// Technique adapted from "SEED: Self-Evolving On-Policy Distillation for
// Agentic Reinforcement Learning" (arXiv:2607.14777). SEED's central signal is
// the PROBABILITY SHIFT a hindsight skill induces on the policy's own sampled
// actions: a skill that doesn't move the policy's behavior carries no training
// signal. VisionClaw is an API consumer (no logits, no weight updates), so this
// module implements the verbalized analogue: replay a bounded sample of the
// eval cases with the SEED doc vs the CANDIDATE doc in context, and measure
// whether the model's actual output changes. A candidate that shifts behavior
// on ZERO probed cases is INERT — its val-score "improvement" is judge noise,
// and it is culled BEFORE the (paid, 3-frontier-model) jury call.
//
// Where it sits: scripts/skill-optimize-nightly.ts, BETWEEN gate 1
// (strict held-out improvement) and gate 2 (3-LLM jury). It can only SKIP a
// jury call, never force an apply — so it is a pure spend/noise filter, not an
// authorization surface.
//
// Safety posture (per platform doctrine: safety fails closed, QUALITY fails
// open): this is a quality/spend filter, so every failure path FAILS OPEN —
// probe errors, timeouts, unusable outputs, or too few clean probes all yield
// `inert: false` and the candidate proceeds to the jury exactly as before.
// A candidate is culled ONLY on clean, unanimous evidence:
//   >= MIN_USABLE cases probed successfully, ZERO probe errors, and ZERO
//   cases where the output shifted.
//
// Kill switch: SKILL_OPT_SHIFT=off (checked by the nightly runner, not here).
//
// Providers are imported LAZILY inside the default rollout so the pure
// similarity/verdict logic is import-safe and unit-testable with no LLM and no
// DB (tests inject `rolloutFn`).

import { logSilentCatch } from "./silent-catch";
import type { EvalCase } from "../skill-optimizer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BehaviorShiftCase {
  input: string;
  /** Word-level Jaccard similarity of the two outputs, 0..1 (1 = identical). */
  similarity: number | null;
  /** true = candidate doc changed the model's behavior on this case. */
  shifted: boolean;
  /** "ok" | "error" | "empty-output" */
  status: "ok" | "error" | "empty-output";
  note?: string;
}

export interface BehaviorShiftResult {
  /** Cases attempted (bounded by maxCases). */
  attempted: number;
  /** Cases with two clean, non-empty outputs. */
  usable: number;
  /** Usable cases where behavior shifted. */
  shifted: number;
  /** Probe-level errors (any > 0 forces inert=false — fail open). */
  errors: number;
  /**
   * TRUE only on clean unanimous evidence of no behavior change
   * (usable >= minUsable, errors === 0, shifted === 0).
   * The nightly runner skips the jury when this is true.
   */
  inert: boolean;
  perCase: BehaviorShiftCase[];
  notes: string;
}

export interface BehaviorShiftConfig {
  targetModel: string;
  tenantId?: number;
  /** Max cases to probe (default 4). */
  maxCases?: number;
  /** Similarity at/above which two outputs count as "same behavior" (default 0.88). */
  similarityThreshold?: number;
  /** Minimum clean probed cases required before an inert verdict (default 2). */
  minUsable?: number;
  /** Hard per-LLM-call timeout (default 60s). Timeout = probe error = fail open. */
  perCallTimeoutMs?: number;
}

/** Injection seam: produce the model's output for (skillDoc, case input). */
export type ShiftRolloutFn = (skillDoc: string, c: EvalCase) => Promise<string>;

// ─── Pure logic (deterministic, no I/O — unit-tested) ───────────────────────

function tokenize(s: string): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Word-level Jaccard similarity, 0..1. Deliberately coarse: sampling noise
 * between two runs of the SAME context reads as moderate divergence, which
 * biases toward "shifted" — i.e. toward keeping the candidate (fail open).
 * Only near-verbatim-identical outputs land above the threshold.
 */
export function outputSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Aggregate per-case probes into the fail-open inert verdict. */
export function aggregateShiftVerdict(
  perCase: BehaviorShiftCase[],
  minUsable: number,
): Pick<BehaviorShiftResult, "attempted" | "usable" | "shifted" | "errors" | "inert" | "notes"> {
  const attempted = perCase.length;
  const usable = perCase.filter((c) => c.status === "ok").length;
  const errors = perCase.filter((c) => c.status === "error").length;
  const shifted = perCase.filter((c) => c.status === "ok" && c.shifted).length;
  const inert = errors === 0 && usable >= minUsable && shifted === 0;
  const notes = inert
    ? `INERT: candidate changed behavior on 0/${usable} probed case(s) — jury call skipped (SEED behavior-shift filter, arXiv:2607.14777)`
    : `shift ${shifted}/${usable} usable (attempted ${attempted}, errors ${errors}) → proceeds to jury`;
  return { attempted, usable, shifted, errors, inert, notes };
}

// ─── Default LLM rollout (lazy providers, hard timeout, fail open) ──────────

function defaultRollout(cfg: BehaviorShiftConfig): ShiftRolloutFn {
  const timeoutMs = cfg.perCallTimeoutMs ?? 60_000;
  return async (skillDoc, c) => {
    const { getClientForModel } = await import("../providers");
    const { client, actualModelId } = await getClientForModel(cfg.targetModel, cfg.tenantId);
    const call = client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: skillDoc },
        { role: "user", content: c.input },
      ],
    });
    // Hard fail-open timeout; swallow the late settle so a slow probe can't
    // become an unhandled rejection after the race is lost.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`behavior-shift probe timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      const comp = await Promise.race([
        call.then((r) => r).catch((e) => {
          throw e instanceof Error ? e : new Error(String(e));
        }),
        timeout,
      ]);
      return (comp as any).choices?.[0]?.message?.content?.trim() ?? "";
    } finally {
      if (timer) clearTimeout(timer);
      // Swallow a post-race rejection from the abandoned call.
      Promise.resolve(call).catch(() => {});
    }
  };
}

// ─── Probe runner ────────────────────────────────────────────────────────────

/**
 * Replay up to `maxCases` eval cases under the seed doc and the candidate doc
 * and decide whether the candidate is behaviorally INERT. Never throws: a
 * top-level failure returns `inert: false` (fail open).
 */
export async function runBehaviorShiftProbe(args: {
  docBefore: string;
  docAfter: string;
  cases: EvalCase[];
  cfg: BehaviorShiftConfig;
  rolloutFn?: ShiftRolloutFn;
}): Promise<BehaviorShiftResult> {
  const { docBefore, docAfter, cases, cfg } = args;
  const maxCases = Math.max(1, cfg.maxCases ?? 4);
  const threshold = cfg.similarityThreshold ?? 0.88;
  const minUsable = Math.max(1, cfg.minUsable ?? 2);
  const rollout = args.rolloutFn ?? defaultRollout(cfg);
  const perCase: BehaviorShiftCase[] = [];

  try {
    // Identical docs = definitionally inert probe input; but an identical
    // candidate should never reach here (optimizer rejects no-op edits), so
    // treat it as inert only via the normal path below — no shortcut needed.
    for (const c of cases.slice(0, maxCases)) {
      try {
        const [outBefore, outAfter] = [await rollout(docBefore, c), await rollout(docAfter, c)];
        if (!outBefore.trim() || !outAfter.trim()) {
          perCase.push({ input: c.input, similarity: null, shifted: false, status: "empty-output" });
          continue;
        }
        const similarity = outputSimilarity(outBefore, outAfter);
        perCase.push({ input: c.input, similarity, shifted: similarity < threshold, status: "ok" });
      } catch (e) {
        logSilentCatch("server/lib/behavior-shift.ts:per-case-probe", e);
        perCase.push({
          input: c.input,
          similarity: null,
          shifted: false,
          status: "error",
          note: (e as Error)?.message?.slice(0, 200),
        });
      }
    }
    return { ...aggregateShiftVerdict(perCase, minUsable), perCase };
  } catch (e) {
    logSilentCatch("server/lib/behavior-shift.ts:probe-runner", e);
    return {
      attempted: perCase.length,
      usable: 0,
      shifted: 0,
      errors: perCase.length || 1,
      inert: false,
      perCase,
      notes: `probe failed (${(e as Error)?.message ?? e}) → fail open, proceeds to jury`,
    };
  }
}
