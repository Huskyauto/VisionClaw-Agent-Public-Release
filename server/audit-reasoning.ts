// R77.5 — KisMATH Causal CoT Step Audit (arxiv 2507.11408v2)
//
// The KisMATH paper measured causal mediation by suppressing attention to a single
// reasoning step and observing how much the final answer's probability shifted —
// "reasoning steps that mediate strongly are causally important."
//
// We don't have attention-head access at API level, so we use a behavioral surrogate:
// 1. Take the model's reasoning trace as numbered steps.
// 2. For each step k, build a "masked" version where step k's content is replaced
//    with "[REDACTED — derive this step yourself before continuing]".
// 3. Re-run a cheap regenerator from that point and compute divergence vs the
//    original final answer (token Jaccard + numeric-equality check).
// 4. Steps that, when masked, produce a divergent final answer are CAUSAL.
//    Steps that produce the same answer are non-causal (decorative).
//
// Output: a per-step causal score (0..1) the persona can use to decide which
// steps to defend / drop / re-derive. Cassandra (finance), Atlas (analysis),
// and Felix (debug) are the primary consumers.

import { logSilentCatch } from "./lib/silent-catch";
import { getClientForModel } from "./providers";
import { recordCost } from "./agentic/cost-ledger";

export interface ReasoningStep {
  index: number;
  text: string;
}

export interface StepAuditResult {
  index: number;
  text: string;
  causalScore: number;          // 0 = decorative, 1 = critical
  divergenceMetric: number;     // raw 1 - jaccard
  numericMismatch: boolean;     // true if a number in the final answer changed
  regeneratedAnswer: string;    // for transparency
}

export interface AuditReasoningChainOptions {
  question: string;
  reasoningTrace: string;       // the original step-by-step trace
  originalAnswer: string;       // the conclusion the original chain reached
  tenantId: number;
  regenModelId?: string;        // default: a cheap fast model
  maxSteps?: number;            // safety cap on how many steps we ablate
}

const DEFAULT_REGEN_MODEL = "gemini-2.5-flash";
const REGEN_TIMEOUT_MS = 25_000;
const REGEN_MAX_TOKENS = 600;
const MAX_STEPS_DEFAULT = 8;
const MIN_STEPS_TO_AUDIT = 2;

// Per-tenant cooldown to prevent quota amplification (R78 review finding).
// Each audit fires up to MAX_STEPS_DEFAULT (8) parallel regenerator calls,
// so an attacker who can trigger audit_reasoning_step in a tight loop can
// burn 8x the prompt-token quota of a normal call. Throttle to one audit
// per tenant per AUDIT_COOLDOWN_MS, with the Map size capped to prevent OOM.
const _lastAuditByTenant = new Map<number, number>();
const AUDIT_COOLDOWN_MS = 30_000;          // 1 audit per tenant per 30s
const MAX_TENANTS_TRACKED = 5_000;
function _checkAndRecordAuditCooldown(tenantId: number): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const last = _lastAuditByTenant.get(tenantId);
  if (last !== undefined && now - last < AUDIT_COOLDOWN_MS) {
    return { ok: false, retryAfterMs: AUDIT_COOLDOWN_MS - (now - last) };
  }
  // Prune stale entries when the map gets full so long-tail tenants don't OOM us.
  if (_lastAuditByTenant.size >= MAX_TENANTS_TRACKED) {
    const cutoff = now - AUDIT_COOLDOWN_MS * 2;
    for (const [k, v] of Array.from(_lastAuditByTenant.entries())) {
      if (v < cutoff) _lastAuditByTenant.delete(k);
    }
    if (_lastAuditByTenant.size >= MAX_TENANTS_TRACKED) {
      // Still saturated — fail-CLOSED for the new tenant rather than discard tracking.
      return { ok: false, retryAfterMs: AUDIT_COOLDOWN_MS };
    }
  }
  _lastAuditByTenant.set(tenantId, now);
  return { ok: true };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

// Parse a free-form reasoning trace into steps. Accepts numbered ("1.", "1)",
// "Step 1:", "(1)") or bulleted ("-", "*", "•") lines.
export function parseReasoningSteps(trace: string): ReasoningStep[] {
  const lines = trace.split(/\r?\n/);
  const steps: ReasoningStep[] = [];
  let currentText: string[] = [];
  let currentIndex = 0;
  const stepStartRe = /^\s*(?:\(?(\d+)[.)]\s+|step\s*(\d+)[:.]\s+|[-*•]\s+)/i;

  for (const line of lines) {
    const m = line.match(stepStartRe);
    if (m) {
      if (currentText.length > 0) {
        steps.push({ index: currentIndex, text: currentText.join("\n").trim() });
      }
      currentIndex = steps.length + 1;
      currentText = [line.replace(stepStartRe, "").trim()];
    } else if (line.trim()) {
      currentText.push(line);
    }
  }
  if (currentText.length > 0) {
    steps.push({ index: currentIndex || steps.length + 1, text: currentText.join("\n").trim() });
  }
  return steps.filter(s => s.text.length > 0).map((s, i) => ({ index: i + 1, text: s.text }));
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9.\s-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

const NUMBER_RE = /-?\d+(?:[.,]\d+)*(?:[eE]-?\d+)?/g;
function extractNumbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(NUMBER_RE)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function numericMismatch(originalAnswer: string, regenerated: string): boolean {
  const a = extractNumbers(originalAnswer);
  const b = extractNumbers(regenerated);
  if (a.length === 0 && b.length === 0) return false;
  // The "headline" number we care about is the largest-magnitude one (typical for
  // arithmetic conclusions). If neither side has a number, no mismatch.
  if (a.length === 0 || b.length === 0) return true;
  const headlineA = a.reduce((p, c) => (Math.abs(c) > Math.abs(p) ? c : p), a[0]);
  const headlineB = b.reduce((p, c) => (Math.abs(c) > Math.abs(p) ? c : p), b[0]);
  if (headlineA === 0 && headlineB === 0) return false;
  const denom = Math.max(Math.abs(headlineA), Math.abs(headlineB), 1e-9);
  return Math.abs(headlineA - headlineB) / denom > 0.001;
}

async function regenerateFromMaskedChain(
  question: string,
  steps: ReasoningStep[],
  maskedIndex: number,
  modelId: string,
  tenantId: number,
): Promise<string> {
  const masked = steps.map(s =>
    s.index === maskedIndex
      ? `${s.index}. [REDACTED — derive this step yourself before continuing]`
      : `${s.index}. ${s.text}`,
  ).join("\n");

  const prompt =
    `A previous reasoner produced the following chain of reasoning for the question below, ` +
    `but step ${maskedIndex} was redacted. Re-derive step ${maskedIndex} from the surrounding ` +
    `context and continue the chain to its final answer. Output ONLY the final answer on the ` +
    `last line, prefixed with "FINAL: ".\n\n` +
    `QUESTION:\n${question}\n\nCHAIN (with step ${maskedIndex} redacted):\n${masked}\n\n` +
    `Rederived chain and final answer:`;

  const { client, actualModelId } = await getClientForModel(modelId, tenantId);
  const resp = await withTimeout(
    client.chat.completions.create({
      model: actualModelId,
      max_completion_tokens: REGEN_MAX_TOKENS,
      messages: [
        { role: "system", content: "You are a careful step-by-step reasoner." },
        { role: "user", content: prompt },
      ],
    }) as Promise<any>,
    REGEN_TIMEOUT_MS,
    `audit-regen step ${maskedIndex}`,
  );

  const text = (resp?.choices?.[0]?.message?.content || "").trim();
  const tokensIn = resp?.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4);
  const tokensOut = resp?.usage?.completion_tokens ?? Math.ceil(text.length / 4);
  try {
    await recordCost({
      tenantId,
      toolName: "audit_reasoning_step",
      model: modelId,
      tokensIn,
      tokensOut,
      operation: `audit-regen-step-${maskedIndex}`,
    });
  } catch (_silentErr) { logSilentCatch("server/audit-reasoning.ts", _silentErr); }

  // Pull out FINAL: line if present, otherwise return the whole tail
  const finalMatch = text.match(/FINAL:\s*([^\n]+)/i);
  return (finalMatch?.[1] || text.split(/\r?\n/).slice(-3).join(" ")).trim();
}

export async function auditReasoningChain(
  opts: AuditReasoningChainOptions,
): Promise<{
  totalSteps: number;
  auditedSteps: number;
  results: StepAuditResult[];
  causalSteps: number[];          // indices flagged as load-bearing
  decorativeSteps: number[];      // indices safely droppable
  loadBearingRatio: number;       // causalSteps / auditedSteps
  summary: string;
}> {
  const question = (opts.question || "").trim();
  const trace = (opts.reasoningTrace || "").trim();
  const originalAnswer = (opts.originalAnswer || "").trim();
  if (!question) throw new Error("audit_reasoning_step: question is required");
  if (!trace) throw new Error("audit_reasoning_step: reasoning_trace is required");
  if (!originalAnswer) throw new Error("audit_reasoning_step: original_answer is required");

  // R78 review hardening: per-tenant cooldown to prevent quota amplification.
  // Each audit fires up to 8 parallel gemini-2.5-flash regenerator calls;
  // without this gate a malicious agent could loop and burn 8x the prompt-token
  // quota of a normal call. Fail-CLOSED with a clear message — caller can retry.
  const _cool = _checkAndRecordAuditCooldown(opts.tenantId);
  if (!_cool.ok) {
    throw new Error(
      `audit_reasoning_step: per-tenant cooldown — try again in ${Math.ceil((_cool.retryAfterMs || AUDIT_COOLDOWN_MS) / 1000)}s ` +
      `(limit: 1 audit per tenant per ${AUDIT_COOLDOWN_MS / 1000}s; each audit spawns up to ${MAX_STEPS_DEFAULT} parallel LLM regenerations).`
    );
  }

  const allSteps = parseReasoningSteps(trace);
  if (allSteps.length < MIN_STEPS_TO_AUDIT) {
    return {
      totalSteps: allSteps.length,
      auditedSteps: 0,
      results: [],
      causalSteps: [],
      decorativeSteps: [],
      loadBearingRatio: 0,
      summary: `Reasoning trace has only ${allSteps.length} parseable step(s) — need at least ${MIN_STEPS_TO_AUDIT} to audit causal structure.`,
    };
  }

  const cap = Math.min(opts.maxSteps || MAX_STEPS_DEFAULT, allSteps.length);
  const stepsToAudit = allSteps.slice(0, cap);
  const regenModel = opts.regenModelId || DEFAULT_REGEN_MODEL;
  const originalTokens = tokenize(originalAnswer);

  const settled = await Promise.allSettled(
    stepsToAudit.map(s => regenerateFromMaskedChain(question, allSteps, s.index, regenModel, opts.tenantId)),
  );

  const results: StepAuditResult[] = stepsToAudit.map((s, i) => {
    const settledItem = settled[i];
    if (settledItem.status === "rejected") {
      return {
        index: s.index,
        text: s.text,
        causalScore: 0.5,                    // unknown — neither prove causal nor decorative
        divergenceMetric: 0.5,
        numericMismatch: false,
        regeneratedAnswer: `[regen failed: ${String(settledItem.reason).slice(0, 160)}]`,
      };
    }
    const regen = settledItem.value;
    const regenTokens = tokenize(regen);
    const j = jaccard(originalTokens, regenTokens);
    const div = 1 - j;
    const numMis = numericMismatch(originalAnswer, regen);
    // Causal score blends token divergence with the binary numeric-mismatch signal.
    // Numeric mismatch is heavily weighted because finance/math chains live or die on the number.
    const causalScore = Math.min(1, 0.6 * div + (numMis ? 0.7 : 0));
    return {
      index: s.index,
      text: s.text,
      causalScore: Math.round(causalScore * 100) / 100,
      divergenceMetric: Math.round(div * 100) / 100,
      numericMismatch: numMis,
      regeneratedAnswer: regen.slice(0, 400),
    };
  });

  const CAUSAL_THRESHOLD = 0.4;
  const causalSteps = results.filter(r => r.causalScore >= CAUSAL_THRESHOLD).map(r => r.index);
  const decorativeSteps = results.filter(r => r.causalScore < 0.15).map(r => r.index);
  const ratio = results.length > 0 ? causalSteps.length / results.length : 0;

  let summary: string;
  if (results.length === 0) {
    summary = "No steps were audited.";
  } else if (causalSteps.length === 0) {
    summary = `KisMATH causal audit: ALL ${results.length} step(s) appear decorative — masking any one step did not change the conclusion. The chain is likely pattern-matched, not causally derived. Consider re-asking with stronger discourse connectives ("because", "therefore", "let X = …, then …") or use a non-RLVR model for the proof.`;
  } else if (ratio >= 0.66) {
    summary = `KisMATH causal audit: ${causalSteps.length}/${results.length} step(s) are load-bearing (indices ${causalSteps.join(", ")}). Chain is healthy — most steps causally mediate the answer.`;
  } else {
    summary = `KisMATH causal audit: only ${causalSteps.length}/${results.length} step(s) load-bearing (indices ${causalSteps.join(", ")}). Decorative: ${decorativeSteps.join(", ") || "none"}. Consider tightening the chain by removing decorative steps and reinforcing the load-bearing ones with explicit "therefore/because" connectives.`;
  }

  return {
    totalSteps: allSteps.length,
    auditedSteps: results.length,
    results,
    causalSteps,
    decorativeSteps,
    loadBearingRatio: Math.round(ratio * 100) / 100,
    summary,
  };
}
