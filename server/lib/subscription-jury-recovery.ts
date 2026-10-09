import type { ProposerCallSpec, ProposerResult } from "../moa";
import { StandardComputeCompletionError } from "./standard-compute";

/**
 * Closed backup ladder, never generic model routing or global metered access.
 * Native paid candidates still require the host's scoped owner grant + budget.
 */
export const JURY_BACKUPS: readonly ProposerCallSpec[] = [
  { modelId: "claude-opus-5", providerLane: "claude-runner" },
  { modelId: "gemini-3.1-pro-preview", providerLane: "standard-compute" },
  { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
  { modelId: "gpt-5.4", providerLane: "replit" },
  { modelId: "gpt-5.4", providerLane: "openai-api" },
  { modelId: "claude-sonnet-5-5", providerLane: "anthropic-api" },
];

export function isPaidJuryBackup(spec: ProposerCallSpec): boolean {
  return spec.providerLane === "openai-api" || spec.providerLane === "anthropic-api";
}

/** Alternate identities are permitted only for an owner DEFAULT model contract. */
export function subscriptionRecoveryAllowed(owner: boolean, explicitModel: boolean, lane?: string): boolean {
  return owner && !explicitModel && lane === "profundo";
}

function available(eligible: (spec: ProposerCallSpec) => boolean, spec: ProposerCallSpec): boolean {
  try { return eligible(spec) === true; }
  catch { console.warn("[jury-recovery] Backup readiness unavailable; checking other routes"); return false; }
}

export async function recoverSubscriptionSeats(args: {
  specs: readonly ProposerCallSpec[];
  results: readonly ProposerResult[];
  allowPaid: boolean;
  eligible: (spec: ProposerCallSpec) => boolean;
  call: (spec: ProposerCallSpec, seatIndex: number) => Promise<ProposerResult>;
}): Promise<ProposerResult[]> {
  const results = [...args.results];
  const usedLanes = new Set(results.filter(r => r.ok).map(r => r.providerLane));
  const usedModels = new Set(results.filter(r => r.ok).map(r => r.modelId));
  // At most one dispatch per backup transport/model per run, across ALL seats.
  const attempted = new Set<string>();
  for (let i = 0; i < args.specs.length; i++) {
    const original = args.specs[i];
    if (original.providerLane !== "profundo" || args.results[i]?.ok) continue;
    for (const backup of JURY_BACKUPS) {
      const key = `${backup.providerLane}:${backup.modelId}`;
      if (attempted.has(key) || usedLanes.has(backup.providerLane) || usedModels.has(backup.modelId) ||
          isPaidJuryBackup(backup) && !args.allowPaid || !available(args.eligible, backup)) continue;
      attempted.add(key);
      const spec = { ...original, ...backup, noRetry: true, maxTokens: original.maxTokens ?? 4096,
        label: original.label ?? `recovery(${original.modelId})` };
      let result: ProposerResult;
      try { result = await args.call(spec, i); }
      catch {
        result = { modelId: spec.modelId, provider: spec.providerLane!,
          providerLane: spec.providerLane, ok: false, latencyMs: 0, error: "Backup call unavailable" };
      }
      result = { ...result, routeReason: `subscription-recovery:${original.modelId}` };
      results.push(result);
      if (result.ok && result.answer?.trim()) {
        usedLanes.add(result.providerLane);
        usedModels.add(result.modelId);
        break;
      }
    }
  }
  return results;
}

export interface SynthesisAttempt {
  modelId: string;
  providerLane: ProposerCallSpec["providerLane"];
  ok: boolean;
  reportedModel?: string;
  tokensIn?: number;
  tokensOut?: number;
  usagePersisted?: boolean;
}

export async function runSubscriptionSynthesis<T>(args: {
  primary: ProposerCallSpec;
  allowPaid: boolean;
  eligible: (spec: ProposerCallSpec) => boolean;
  call: (spec: ProposerCallSpec) => Promise<T>;
  onAttempt?: (attempt: SynthesisAttempt) => void;
}): Promise<{ result: T; attempts: SynthesisAttempt[] }> {
  const attempts: SynthesisAttempt[] = [];
  const notify = (attempt: SynthesisAttempt) => {
    attempts.push(attempt);
    try { args.onAttempt?.(attempt); }
    catch { console.warn("[jury-recovery] Synthesis telemetry failed; preserving inference outcome"); }
  };
  let lastError: unknown = new Error("All permitted synthesis routes unavailable");
  for (const spec of [args.primary, ...JURY_BACKUPS.filter(s =>
    (!isPaidJuryBackup(s) || args.allowPaid) && available(args.eligible, s))]) {
    try {
      const result = await args.call({ ...spec, noRetry: true });
      const attempt = { modelId: spec.modelId, providerLane: spec.providerLane, ok: true };
      notify(attempt);
      return { result, attempts };
    } catch (error) {
      lastError = error;
      const attempt = { modelId: spec.modelId, providerLane: spec.providerLane, ok: false,
        ...(error instanceof StandardComputeCompletionError ? {
          reportedModel: error.reportedModel, tokensIn: error.tokensIn, tokensOut: error.tokensOut,
          usagePersisted: error.usagePersisted,
        } : {}) };
      notify(attempt);
    }
  }
  throw lastError;
}
