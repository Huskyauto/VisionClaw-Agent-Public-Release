// Resilient LLM invocation core.
//
// Generalizes the "never just error out" behavior that previously lived inline
// (and incompletely) inside server/llm-task.ts into one shared wrapper that
// every general-purpose task helper routes through. Three layers, all bounded:
//
//   1. Param-adaptation — when a provider route rejects an OPTIONAL request
//      param (a direct-key Claude route rejecting response_format AND/OR
//      temperature; an endpoint wanting max_tokens instead of
//      max_completion_tokens), strip/swap the offending param and retry the
//      SAME model rather than failing or burning a failover. This is the exact
//      failure that broke the BWB recap.
//   2. Model failover — when a model route hard-fails for a failover-eligible
//      reason (rate limit / overload / network / model-not-found / auth-on-a-
//      key / etc.), automatically move to the next capable model on a DIFFERENT
//      provider. Reuses the existing classification + selection primitives in
//      server/model-failover.ts (classifyError / shouldFailover /
//      findFallbackModel) — this file owns only the loop, not the taxonomy.
//   3. (Prompt-repair lives one level up, in llm-task.ts, where the parsed
//      output is judged — see runLlmTask.)
//
// Bounds & deadline: the CALLER owns the AbortSignal/timeout. The original
// timeout/abort ALWAYS wins — once `signal.aborted` is true we stop
// immediately and never fail over or strip-retry past the deadline. This is
// deliberately different from executeWithFailover()'s internal 90s
// withLLMTimeout (which treats a timeout as a failover trigger and is the wrong
// semantics for a caller that passed an explicit timeoutMs).

import {
  getClientForModel,
  getAvailableModels,
  getUnhealthyProviders,
  markProviderUnhealthy,
  resetProviderHealth,
  markSubscriptionFailed,
  MODEL_REGISTRY,
  LEGACY_MODEL_ALIASES,
  LAST_RESORT_MODEL,
  claimLastResortSlot,
} from "../providers";
import {
  classifyError,
  shouldFailover,
  shouldExcludeProvider,
  findFallbackModel,
} from "../model-failover";
import { logSilentCatch } from "./silent-catch";
import { MAX_PARAM_STRIPS, stripRejectedParam } from "./param-adaptation";

export interface ResilientChatInput {
  /** Requested model id (alias resolution handled here). */
  requestedModel: string;
  tenantId?: number;
  /** create() params MINUS `model` — { messages, max_completion_tokens, response_format?, temperature? }. */
  baseParams: Record<string, any>;
  /** Caller-owned deadline. The abort ALWAYS wins over failover/strip-retry. */
  signal: AbortSignal;
  /** Max DISTINCT models to try (primary + failovers). Default 3. */
  maxModels?: number;
  requiresTools?: boolean;
  /**
   * Cost-exempt "flagship" lane: tags the provider label with ":flagship" so the
   * metered-Anthropic daily breaker + spend tally exempt this call (same
   * treatment the jury gets). Reserved for bounded, owner-blessed high-value Opus
   * uses — currently the once-weekly Built With Bob recap. NOT for everyday work.
   */
  costExemptLane?: boolean;
  /** Log label, e.g. "llm-task" / "llm-text-task". */
  label?: string;
  /**
   * Models that already produced UNUSABLE output (invalid JSON / schema
   * mismatch / empty) on a prior call and must be SKIPPED if any other capable
   * model is available. This is what makes failover-on-unusable-output work:
   * the route succeeded but the result was garbage, so the caller asks the next
   * attempt to pick a DIFFERENT model. Falls back to the requested model only
   * when no alternative exists (re-asking the sole model beats hard-failing).
   */
  excludeModels?: string[];
}

export interface ResilientStep {
  model: string;
  event: "param-stripped" | "route-error" | "failover" | "success";
  detail?: string;
}

export interface ResilientChatResult {
  response: any;
  /** Registry id of the model that actually produced the response. */
  usedModel: string;
  failoverUsed: boolean;
  steps: ResilientStep[];
}

// Detects a STRUCTURED safety refusal in a provider response. Returns the
// refusal text (or a marker) when the model declined for safety, else null.
// Callers MUST stop — never prompt-repair — when this is non-null: re-prompting
// past a refusal would defeat a safety guard, which is a hard invariant of this
// platform. We only trust structured signals (the OpenAI `message.refusal`
// field, a `content_filter` finish reason) — NOT freeform text heuristics,
// which would false-positive on legitimate content.
export function detectRefusal(response: any): string | null {
  const choice = response?.choices?.[0];
  if (!choice) return null;
  const msg = choice.message || {};
  if (typeof msg.refusal === "string" && msg.refusal.trim()) return msg.refusal.trim();
  const finishReason = choice.finish_reason ?? choice.finishReason;
  if (finishReason === "content_filter") return "Response stopped by provider content filter";
  return null;
}

// Attaches the actionable one-liner from translateLlmError (same UX layer
// model-failover.ts uses) without disturbing the raw message used for
// forensics. Best-effort.
async function attachFriendly<T>(err: T): Promise<T> {
  try {
    const { translateLlmError, formatTranslated } = await import("./translate-llm-error");
    const t = translateLlmError(err);
    (err as any).friendly = formatTranslated(t);
    (err as any).translated = t;
  } catch (_silentErr) {
    logSilentCatch("server/lib/resilient-llm.ts", _silentErr);
  }
  return err;
}

// Bounded strip-and-retry against a SINGLE model. Only ever drops/swaps
// OPTIONAL params; a non-param error (or an exhausted strip budget) is thrown
// so the failover loop can move to a different model. The caller's abort wins:
// once the signal is aborted we never strip-retry.
async function callWithParamAdaptation(
  client: any,
  baseParams: Record<string, any>,
  actualModelId: string,
  modelIdForLog: string,
  signal: AbortSignal,
  steps: ResilientStep[],
  label: string,
): Promise<any> {
  const createParams: any = { ...baseParams, model: actualModelId };
  const isReasoningModel = /^(o[1-9]|o4)/.test(actualModelId) || actualModelId.includes("reasoning");
  if (isReasoningModel) delete createParams.temperature;

  for (let attempt = 0; ; attempt++) {
    try {
      return await client.chat.completions.create(createParams, { signal });
    } catch (apiErr: any) {
      if (signal.aborted) throw apiErr; // deadline wins — no strip-retry
      if (attempt >= MAX_PARAM_STRIPS) throw apiErr;
      // Shared with the universal client-factory wrapper (see
      // ./param-adaptation). In practice the wrapped client usually strips the
      // param one level down before we ever see the error, but this layer is
      // kept for defense-in-depth (and for any caller that hands us a raw
      // client) and records the strip in the structured `steps` trace.
      const adapted = stripRejectedParam(createParams, apiErr);
      if (!adapted) throw apiErr;
      console.log(JSON.stringify({ evt: "llm_param_adapt", scope: label, model: actualModelId, adapted, attempt: attempt + 1 }));
      steps.push({ model: modelIdForLog, event: "param-stripped", detail: adapted });
    }
  }
}

function pickNextModel(
  primaryId: string,
  available: { id: string; provider: string; tier: string }[],
  excludedProviders: Set<string>,
  triedModels: Set<string>,
): string | null {
  const pool = available.filter(
    (m) => !excludedProviders.has(m.provider) && !triedModels.has(m.id),
  ) as any;
  const fb = findFallbackModel(primaryId, pool);
  return fb?.id ?? null;
}

/**
 * Output-level failover start planner (pure; unit-tested). Given the requested
 * model plus the set of models that already produced UNUSABLE output, decide
 * which model to START on and which ids to seed the failover loop's tried-set
 * with so it never re-picks a known-unusable model.
 *
 * - If the requested model is NOT excluded → start on it (normal path).
 * - If it IS excluded → start on the best available capable model that is NOT
 *   excluded (genuine cross-model failover on unusable output).
 * - If exclusion would leave NO candidate → fall back to the requested model
 *   (re-asking the only available model beats hard-failing).
 */
export function planOutputFailoverStart(
  primary: string,
  excludeModels: string[],
  available: { id: string; provider: string; tier: string }[],
  excludedProviders: Set<string>,
): { startModel: string; triedSeed: string[] } {
  const excluded = new Set<string>(
    excludeModels.map((m) => LEGACY_MODEL_ALIASES[m] || m),
  );
  let startModel = primary;
  if (excluded.has(startModel)) {
    const alt = pickNextModel(primary, available, excludedProviders, new Set(excluded));
    if (alt) startModel = alt;
  }
  // Seed the failover loop's tried-set with every excluded id EXCEPT the one we
  // are actually about to try (the no-alternative fallback case).
  const triedSeed = [...excluded].filter((id) => id !== startModel);
  return { startModel, triedSeed };
}

/**
 * Run a chat.completions.create with param-adaptation + bounded model failover,
 * all gated by the caller's AbortSignal. Returns the raw provider response plus
 * a trace of what it took to get there. Throws (with an attached .friendly
 * line) only when genuinely exhausted or when the caller's deadline fires.
 */
export async function resilientChatCompletion(input: ResilientChatInput): Promise<ResilientChatResult> {
  const label = input.label || "resilient-llm";
  const steps: ResilientStep[] = [];
  const maxModels = input.maxModels ?? 3;
  const primary = LEGACY_MODEL_ALIASES[input.requestedModel] || input.requestedModel;
  const available = await getAvailableModels();

  const excludedProviders = new Set<string>(getUnhealthyProviders());
  // Output-level failover: skip any model the caller flagged as having produced
  // unusable output, when an alternative exists.
  const { startModel, triedSeed } = planOutputFailoverStart(
    primary, input.excludeModels || [], available as any, excludedProviders,
  );
  const triedModels = new Set<string>(triedSeed);
  let currentModelId = startModel;
  let lastError: any = null;

  for (let modelAttempt = 0; modelAttempt < maxModels; modelAttempt++) {
    if (input.signal.aborted) {
      throw await attachFriendly(lastError || new Error(`[${label}] aborted before completion`));
    }

    let client: any;
    let actualModelId: string;
    try {
      ({ client, actualModelId } = await getClientForModel(currentModelId, input.tenantId, {
        requiresTools: input.requiresTools,
        costExemptLane: input.costExemptLane,
      }));
    } catch (initErr: any) {
      lastError = initErr;
      const { reason, status } = classifyError(initErr);
      steps.push({ model: currentModelId, event: "route-error", detail: reason });
      const provider = MODEL_REGISTRY.find((m) => m.id === currentModelId)?.provider;
      if (provider) excludedProviders.add(provider);
      // Non-failover-eligible init errors (caller-side/permanent) throw
      // directly — they must NOT fall through to the last-resort rung below.
      if (!shouldFailover(reason)) throw await attachFriendly(initErr);
      const next = pickNextModel(primary, available as any, excludedProviders, triedModels);
      if (!next) break;
      // Every failover transition is logged structurally — including the
      // client-INIT failure path (no client was ever obtained), not just the
      // post-call exec path below.
      steps.push({ model: currentModelId, event: "failover", detail: reason });
      console.log(JSON.stringify({ evt: "llm_failover", scope: label, phase: "init", from: currentModelId, to: next, reason, status }));
      currentModelId = next;
      continue;
    }

    triedModels.add(currentModelId);
    try {
      const response = await callWithParamAdaptation(
        client,
        input.baseParams,
        actualModelId,
        currentModelId,
        input.signal,
        steps,
        label,
      );
      const provider = MODEL_REGISTRY.find((m) => m.id === currentModelId)?.provider;
      if (provider) resetProviderHealth(provider);
      steps.push({ model: currentModelId, event: "success" });
      const failoverUsed = currentModelId !== primary;
      if (failoverUsed) {
        console.log(`[${label}] recovered via failover: ${primary} → ${currentModelId} (${steps.length} steps)`);
      }
      return { response, usedModel: currentModelId, failoverUsed, steps };
    } catch (execErr: any) {
      // The caller's deadline ALWAYS wins — never fail over past an abort.
      if (input.signal.aborted) throw execErr;

      lastError = execErr;
      const { reason, status } = classifyError(execErr);
      const provider = MODEL_REGISTRY.find((m) => m.id === currentModelId)?.provider;
      // "format"/"unknown" classes are usually caller-side request-shape issues,
      // not provider degradation — do NOT poison provider health or exclude the
      // whole provider for them (we still try a sibling model below). Only
      // genuine provider/model-side failures mutate shared health state, to
      // avoid falsely degrading a healthy provider on a malformed request.
      const excludeWholeProvider = shouldExcludeProvider(reason); // auth/auth_permanent/billing
      const transientProviderIssue =
        reason === "rate_limit" || reason === "overloaded" ||
        reason === "timeout" || reason === "network" || reason === "model_not_found";
      if (provider && (excludeWholeProvider || transientProviderIssue)) {
        markProviderUnhealthy(provider, String(execErr?.message || ""));
        // Exclude the failed provider from the next pick so failover actually
        // changes something.
        excludedProviders.add(provider);
        if (
          (reason === "auth" || reason === "auth_permanent" || reason === "billing" || reason === "rate_limit") &&
          input.tenantId
        ) {
          try {
            markSubscriptionFailed(provider, input.tenantId, status);
          } catch (_silentErr) {
            logSilentCatch("server/lib/resilient-llm.ts", _silentErr);
          }
        }
      }
      steps.push({ model: currentModelId, event: "failover", detail: reason });

      if (!shouldFailover(reason)) {
        throw await attachFriendly(execErr);
      }
      const next = pickNextModel(primary, available as any, excludedProviders, triedModels);
      console.log(JSON.stringify({ evt: "llm_failover", scope: label, from: currentModelId, to: next, reason, status }));
      if (!next) break;
      currentModelId = next;
    }
  }

  // ── LAST-RESORT super-expert rung (Bob 2026-07-01) ─────────────────────────
  // Every generic candidate is exhausted. One explicit, metered attempt on the
  // super-expert model (claude-fable-5) — deliberately kept OUT of the generic
  // ladders/tier routing so it can never become a default. Bounded by a small
  // process-local daily cap (claimLastResortSlot claims BEFORE spend) and the
  // caller's abort signal; disabled via LAST_RESORT_MODEL_ENABLED=false.
  if (
    !input.signal.aborted &&
    !triedModels.has(LAST_RESORT_MODEL) &&
    !(input.excludeModels || []).includes(LAST_RESORT_MODEL) &&
    claimLastResortSlot(label)
  ) {
    try {
      const { client, actualModelId } = await getClientForModel(LAST_RESORT_MODEL, input.tenantId, {
        requiresTools: input.requiresTools,
        meteredOverride: true, // deliberate: the whole point is a paid backup when free/sub lanes all failed
      });
      steps.push({ model: LAST_RESORT_MODEL, event: "failover", detail: "last-resort escalation" });
      console.log(JSON.stringify({ evt: "llm_failover", scope: label, phase: "last-resort", from: currentModelId, to: LAST_RESORT_MODEL }));
      const response = await callWithParamAdaptation(
        client,
        input.baseParams,
        actualModelId,
        LAST_RESORT_MODEL,
        input.signal,
        steps,
        label,
      );
      steps.push({ model: LAST_RESORT_MODEL, event: "success" });
      console.log(`[${label}] recovered via LAST-RESORT escalation: ${primary} → ${LAST_RESORT_MODEL} (METERED)`);
      return { response, usedModel: LAST_RESORT_MODEL, failoverUsed: true, steps };
    } catch (lastResortErr: any) {
      // The super-expert failed too — surface the ORIGINAL exhaustion error
      // (more representative of the systemic failure) with the escalation noted.
      steps.push({ model: LAST_RESORT_MODEL, event: "route-error", detail: classifyError(lastResortErr).reason });
      console.warn(`[${label}] last-resort ${LAST_RESORT_MODEL} also failed: ${String(lastResortErr?.message || lastResortErr).slice(0, 200)}`);
      lastError = lastError || lastResortErr;
    }
  }

  throw await attachFriendly(lastError || new Error(`[${label}] all candidate models exhausted`));
}
