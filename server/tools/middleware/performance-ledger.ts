/**
 * Tools-layer-split S24 — middleware extraction, phase 2 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the inline tool_performance ledger (the `finally` body
 * wrapping the tool dispatch in `executeTool`, server/tools.ts) — ZERO behavior
 * change. Fire-and-forget: records the single-funnel tool_performance row
 * (success/failure + duration + fail reason) for tenant-scoped, non-skipped
 * calls.
 *
 * R72 context (preserved): single-funnel tracking lives in executeTool — the
 * actual inner-most funnel — because direct executeTool callers were bypassing
 * tracking entirely. executeGuardedTool sets _skipTracking=true to avoid
 * double-counting. This helper is called from inside executeTool's `finally`,
 * exactly where the inline block used to run, so the timing (fired after the
 * inner call settles, regardless of throw) is identical.
 *
 * The `skill-evolution` module is pulled via a call-time dynamic import that
 * mirrors the previous lazy load EXACTLY and keeps this module free of a static
 * edge into the app graph (acyclicity invariant —
 * data/feature-contracts/tools-layer-split/spec.md).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export function recordToolPerformance(args: {
  name: string;
  params: Record<string, any>;
  startMs: number;
  result: any;
  execError: any;
}): void {
  const { name, params, startMs, result, execError } = args;
  const trackTenant = (params as any)._tenantId;
  if (trackTenant && !(params as any)._skipTracking && process.env.TOOL_TRACKING_DISABLED !== "1") {
    const durationMs = Date.now() - startMs;
    const failed = !!execError || (result && typeof result === "object" && (result as any).error);
    const failReason = execError ? String(execError?.message || execError).slice(0, 200)
      : failed ? String((result as any).error).slice(0, 200) : undefined;
    import("../../skill-evolution").then(({ trackToolExecution }) => {
      trackToolExecution(trackTenant, name, !failed, durationMs, failReason).catch(() => {});
    }).catch(() => {});
  }
}
