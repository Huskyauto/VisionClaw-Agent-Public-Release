export interface ToolFailureRetryPolicy {
  suppressAdaptiveRetry: boolean;
  selfHealHint: string;
  userFacingInstruction: string;
}

const TERMINAL_SECOND_OPINION_FAILURES = new Set([
  "model_timeout",
  "provider_overload",
  "provider_error",
  "fusion_daily_usd",
  "cost_drift_latched",
  "wiring",
]);

const DEFAULT_POLICY: ToolFailureRetryPolicy = {
  suppressAdaptiveRetry: false,
  selfHealHint: "",
  userFacingInstruction: "",
};

// Per-object provenance from the engine's exception boundary. Tool-returned
// JSON booleans alone must never impersonate a confirmed external receipt.
const engineOutcomes = new WeakMap<object, "unknown" | "committed">();
export function recordToolFailureOutcome(result: object, error: unknown): void {
  if (!(error instanceof Error)) return;
  if ((error as Error & { outcomeCommitted?: boolean }).outcomeCommitted === true)
    engineOutcomes.set(result, "committed");
  else if ((error as Error & { outcomeUnknown?: boolean }).outcomeUnknown === true)
    engineOutcomes.set(result, "unknown");
}
/** Transfer only already-bound provenance across the engine's value scrubber. */
export function copyToolFailureOutcome(from: object, to: object): void {
  const outcome = engineOutcomes.get(from);
  if (outcome) engineOutcomes.set(to, outcome);
}

/**
 * Tool-specific exceptions to generic "retry every failure" coaching.
 *
 * A timed-out paid Fusion panel has ambiguous completion: provider work may
 * already have occurred, so another call can duplicate spend and add a second
 * full timeout. second_opinion is optional corroboration; completed native
 * jury evidence remains authoritative when it is unavailable.
 */
export function getToolFailureRetryPolicy(
  toolName: string,
  result: Record<string, unknown>,
): ToolFailureRetryPolicy {
  if (engineOutcomes.get(result) === "committed") {
    return {
      suppressAdaptiveRetry: true,
      selfHealHint: "DO NOT retry this operation. The action ledger confirmed the external side effect already committed. Use its existing receipt; do not send or spend again.",
      userFacingInstruction: "State that the external side effect was confirmed despite the timeout. Do not describe it as failed or repeat it.",
    };
  }
  // An explicit unknown outcome is not an ordinary transient failure.
  // Reconcile the original operation before permitting another side effect.
  if (engineOutcomes.get(result) === "unknown") {
    return {
      suppressAdaptiveRetry: true,
      selfHealHint: "DO NOT retry this operation automatically. Its outcome is unconfirmed; reconcile the original operation using existing receipt/status evidence before any new attempt. Do not claim success or failure without that evidence.",
      userFacingInstruction: "State that the operation's outcome is unconfirmed. Do not repeat it automatically or describe it as definitely completed or definitely failed.",
    };
  }
  if (
    toolName !== "second_opinion" ||
    !TERMINAL_SECOND_OPINION_FAILURES.has(String(result.failureKind || ""))
  ) {
    return DEFAULT_POLICY;
  }

  return {
    suppressAdaptiveRetry: true,
    selfHealHint:
      "DO NOT retry second_opinion in this turn. This optional paid external cross-check is unavailable, and a timeout may already have incurred provider work. Continue from the completed in-house jury and other available evidence; disclose the external-check limitation without weakening the native verdict.",
    userFacingInstruction:
      "State once that the optional external second-opinion timed out or was unavailable. Do not retry it automatically, and do not describe the completed in-house jury as failed.",
  };
}