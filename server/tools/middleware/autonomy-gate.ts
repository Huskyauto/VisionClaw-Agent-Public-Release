/**
 * Tools-layer-split S24 — middleware extraction, phase 6 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * Translates the tool call → an action type → `checkAutonomy`.
 * Missing identity blocks mapped actions unless a separately supplied,
 * tenant-bound server service capability is active. Tools without a mapping or
 * without a matching rule pass through (auto_approved). On denial it records
 * the operational failure in tool_performance (fire-and-forget, so the
 * dormant-tool detector + dashboards see it) and returns the block envelope.
 * Enforcement failures fail CLOSED. Task parameters cannot create capabilities.
 *
 * Returns the `{ error, autonomy }` block envelope to short-circuit the call,
 * or `null` to proceed. App-graph deps (`autonomy`, `skill-evolution`) are
 * pulled via call-time dynamic imports that mirror the previous lazy loads
 * EXACTLY and keep this module free of a static edge into the app graph
 * (acyclicity invariant — data/feature-contracts/tools-layer-split/spec.md).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { currentToolAuthority } from "../invocation-authority";

export async function enforceAutonomyGate(
  name: string,
  params: Record<string, any>,
  dependencies: Pick<typeof import("../../autonomy"), "mapToolToActionType" | "checkAutonomy"> | undefined = undefined,
): Promise<{ error: string; autonomy: Record<string, unknown> } | null> {
  // Autonomy enforcement gate — translates tool call → action type → checkAutonomy.
  // Mapped actions need identity or explicit, tenant-bound service authority.
  // Tools without an autonomy mapping or without a matching rule pass through (auto_approved).
  try {
    const personaId = typeof params._personaId === "number" ? params._personaId : undefined;
    const tenantId = typeof params._tenantId === "number" ? params._tenantId : undefined;
    const { mapToolToActionType, checkAutonomy } = dependencies ?? await import("../../autonomy");
    const actionType = mapToolToActionType(name);
    if (actionType && (!Number.isSafeInteger(personaId) || !personaId ||
        !Number.isSafeInteger(tenantId) || !tenantId)) {
      const service = currentToolAuthority();
      if (service?.actor === "system" && service.internalPurpose &&
          service.tenantId === tenantId) return null;
      return {
        error: "Autonomy requires authenticated persona and tenant identity, or explicit internal service authority.",
        autonomy: { tool: name, actionType, decision: "missing_identity" },
      };
    }
    if (personaId && tenantId) {
      if (actionType) {
        const decision = await checkAutonomy({
          actionType,
          personaId,
          tenantId,
          confidenceScore: typeof params._confidenceScore === "number" ? params._confidenceScore : undefined,
          context: { tool: name, params_keys: Object.keys(params).filter(k => !k.startsWith("_")) },
          value: typeof params._value === "number" ? params._value : undefined,
        });
        if (!decision.allowed) {
          // R72 (architect-fix): autonomy denial is an operational failure
          // from telemetry's perspective — record it in tool_performance so
          // the dormant-tool detector and Bob's dashboards can see it.
          if (tenantId && !(params as any)._skipTracking && process.env.TOOL_TRACKING_DISABLED !== "1") {
            import("../../skill-evolution").then(({ trackToolExecution }) => {
              trackToolExecution(tenantId, name, false, 0, `autonomy_denied:${decision.reason || decision.decision}`.slice(0, 200)).catch(() => {});
            }).catch(() => {});
          }
          return {
            error: `Blocked by autonomy rule: ${decision.reason}`,
            autonomy: {
              allowed: false,
              decision: decision.decision,
              ruleId: decision.ruleId,
              actionType,
              reason: decision.reason,
            },
          };
        }
      }
    }
  } catch (e: any) {
    console.error("[autonomy-gate] enforcement unavailable; execution blocked");
    return {
      error: "Autonomy policy enforcement unavailable; tool execution blocked.",
      autonomy: { tool: name, decision: "policy_unavailable" },
    };
  }
  return null;
}
