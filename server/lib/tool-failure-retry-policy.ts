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