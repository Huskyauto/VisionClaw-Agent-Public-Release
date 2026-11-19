import type { ProposerCallSpec, ProposerResult } from "../moa";
import { StandardComputeCompletionError } from "./standard-compute";
import { META_WONDER_MODEL_ID, metaHelperTokenLimit } from "./meta";

/**
 * Closed backup ladder, never generic model routing or global metered access.
 * Native paid candidates still require the host's scoped owner grant + budget.
 */
export const JURY_BACKUPS: readonly ProposerCallSpec[] = [
  { modelId: "claude-opus-5", providerLane: "claude-runner" },
  { modelId: "gemini-3.1-pro-preview", providerLane: "standard-compute" },
  { modelId: "openference/minimax-m3", providerLane: "openference" },
  { modelId: "openference/deepseek-v4-pro", providerLane: "openference" },
  { modelId: "gpt-5.4", providerLane: "replit" },
  { modelId: "gpt-5.4", providerLane: "openai-api" },
  { modelId: "claude-sonnet-5-5", providerLane: "anthropic-api" },
  // Explicit owner-only lane, never generic Meta-primary substitution. Its
  // client atomically reserves the aggregate paid-AI budget before dispatch.
  { modelId: META_WONDER_MODEL_ID, providerLane: "meta-direct" },
];

export function isPaidJuryBackup(spec: ProposerCallSpec): boolean {
  return spec.providerLane === "openai-api" || spec.providerLane === "anthropic-api" ||
    spec.providerLane === "meta-direct";
}

/** Alternate identities are permitted only for an owner DEFAULT model contract. */
export function subscriptionRecoveryAllowed(owner: boolean, explicitModel: boolean, lane?: string): boolean {
  return owner && !explicitModel && lane === "profundo";
}

/** Default owner frontier seats may change identity; explicit model pins may not. */
export function defaultJuryRecoveryAllowed(owner: boolean, explicitModel: boolean, lane?: string): boolean {
  return owner && !explicitModel &&
    ["profundo", "openference", "openai-api", "anthropic-api"].includes(lane ?? "");
}

function available(eligible: (spec: ProposerCallSpec) => boolean, spec: ProposerCallSpec): boolean {
  try { return eligible(spec) === true; }
  catch { console.warn("[jury-recovery] Backup readiness unavailable; checking other routes"); return false; }
}

export async function recoverSubscriptionSeats(args: {
  specs: readonly ProposerCallSpec[];
  results: readonly ProposerResult[];
  allowPaid: boolean;
  /** Server-owned owner/default-roster decision, never a model argument. */
  recoverPinnedSeats?: boolean;
  /** Do not purchase a second call on a newly upgraded provider after uncertain completion. */
  avoidPaidLanes?: ReadonlySet<ProposerCallSpec["providerLane"]>;
  /** Overall admission window; each admitted dispatch also gets its remaining timeout. */
  budgetMs?: number;
  now?: () => number;
  eligible: (spec: ProposerCallSpec) => boolean;
  call: (spec: ProposerCallSpec, seatIndex: number) => Promise<ProposerResult>;
}): Promise<ProposerResult[]> {
  const results = [...args.results];
  const usedLanes = new Set(results.filter(r => r.ok).map(r => r.providerLane));
  const usedModels = new Set(results.filter(r => r.ok).map(r => r.modelId));
  // At most one dispatch per backup transport/model per run, across ALL seats.
  const attempted = new Set<string>();
  const now = args.now ?? Date.now;
  const deadline = now() + (args.budgetMs ?? 180_000);
  for (let i = 0; i < args.specs.length; i++) {
    const original = args.specs[i];
    if (!(original.providerLane === "profundo" ||
        args.recoverPinnedSeats && defaultJuryRecoveryAllowed(true, false, original.providerLane)) ||
        args.results[i]?.ok) continue;
    const skips: NonNullable<ProposerResult["recoverySkips"]> = [];
    for (const backup of JURY_BACKUPS) {
      const key = `${backup.providerLane}:${backup.modelId}`;
      const reason = attempted.has(key) ? "already-attempted" :
        usedLanes.has(backup.providerLane) ? "provider-lane-occupied" :
        usedModels.has(backup.modelId) ? "model-identity-occupied" :
        args.avoidPaidLanes?.has(backup.providerLane) ? "premium-provider-already-selected" :
        isPaidJuryBackup(backup) && !args.allowPaid ? "paid-backup-not-authorized" :
        !available(args.eligible, backup) ? "route-unsupported-or-not-locally-ready" :
        now() >= deadline ? "recovery-deadline" : undefined;
      if (reason) {
        skips.push({ modelId: backup.modelId, providerLane: backup.providerLane, reason });
        continue;
      }
      attempted.add(key);
      const spec = { ...original, ...backup, noRetry: true, maxTokens: original.maxTokens ?? 4096,
        timeoutMs: Math.max(1, Math.min(original.timeoutMs ?? 90_000, deadline - now())),
        clientTimeoutMs: Math.max(1, Math.min(6000, deadline - now())),
        label: original.label ?? `recovery(${original.modelId})` };
      spec.maxTokens = metaHelperTokenLimit(spec.modelId, spec.maxTokens);
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
    if (skips.length) results[i] = { ...results[i], recoverySkips: skips };
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
