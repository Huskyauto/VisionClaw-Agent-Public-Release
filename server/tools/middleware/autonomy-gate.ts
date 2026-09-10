/**
 * Tools-layer-split S24 — middleware extraction, phase 6 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the inline autonomy enforcement gate out of `executeTool`
 * (server/tools.ts) — ZERO behavior change. Translates the tool call → an
 * action type → `checkAutonomy`. No-op when persona/tenant context is missing
 * (internal system calls pass through); tools without an autonomy mapping or
 * without a matching rule pass through (auto_approved). On denial it records
 * the operational failure in tool_performance (fire-and-forget, so the
 * dormant-tool detector + dashboards see it) and returns the block envelope.
 * The gate itself fails OPEN (logged loud) — it must never break tool
 * execution.
 *
 * Returns the `{ error, autonomy }` block envelope to short-circuit the call,
 * or `null` to proceed. App-graph deps (`autonomy`, `skill-evolution`) are
 * pulled via call-time dynamic imports that mirror the previous lazy loads
 * EXACTLY and keep this module free of a static edge into the app graph
 * (acyclicity invariant — data/feature-contracts/tools-layer-split/spec.md).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export async function enforceAutonomyGate(
  name: string,
  params: Record<string, any>,
): Promise<{ error: string; autonomy: Record<string, unknown> } | null> {
  // Autonomy enforcement gate — translates tool call → action type → checkAutonomy.
  // No-op when persona/tenant context is missing (internal system calls pass through).
  // Tools without an autonomy mapping or without a matching rule pass through (auto_approved).
  try {
    const personaId = typeof params._personaId === "number" ? params._personaId : undefined;
    const tenantId = typeof params._tenantId === "number" ? params._tenantId : undefined;
    if (personaId && tenantId) {
      const { mapToolToActionType, checkAutonomy } = await import("../../autonomy");
      const actionType = mapToolToActionType(name);
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
    // Never let the gate itself break tool execution — log and fall through to tool.
    console.error("[autonomy-gate] error (falling through):", e?.message || e);
  }
  return null;
}
