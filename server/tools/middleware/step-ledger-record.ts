/**
 * Tools-layer-split S24 — middleware extraction, phase 3 of the middleware
 * order (tracing → performance ledger → step ledger → instant-play → product
 * verification → autonomy → rate-limit LAST).
 *
 * MECHANICAL move of the inline R68 step-ledger auto-record block out of
 * `executeTool` (server/tools.ts) — ZERO behavior change. The caller can pass
 * `_runId` explicitly, or it is picked up from the ambient AsyncLocalStorage
 * context set by withRun(); tenant/persona fall back to the run context when
 * not supplied. Records the tool call against the run's step ledger. Failure to
 * record is logged and swallowed (never breaks the tool result).
 *
 * The `step-ledger` module is pulled via a call-time dynamic import that mirrors
 * the previous lazy load EXACTLY and keeps this module free of a static edge
 * into the app graph (acyclicity invariant —
 * data/feature-contracts/tools-layer-split/spec.md). Filename is
 * `step-ledger-record.ts` (not `step-ledger.ts`) to avoid confusion with the
 * underlying `server/step-ledger.ts` implementation it delegates to.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

export async function recordStepLedger(args: {
  name: string;
  params: Record<string, any>;
  finalResult: any;
  startMs: number;
}): Promise<void> {
  const { name, params, finalResult, startMs } = args;
  // R68 step-ledger auto-record. Caller can pass _runId explicitly, or it can be
  // picked up from the ambient AsyncLocalStorage context set by withRun().
  let _ledgerRunId: string | undefined = typeof params._runId === "string" ? params._runId : undefined;
  let _ledgerTenantId: number | undefined = typeof params._tenantId === "number" ? params._tenantId : undefined;
  let _ledgerPersonaId: number | undefined = typeof params._personaId === "number" ? params._personaId : undefined;
  try {
    const sl = await import("../../step-ledger");
    if (!_ledgerRunId) {
      const ctx = sl.currentRun();
      if (ctx) {
        _ledgerRunId = ctx.runId;
        if (_ledgerTenantId === undefined) _ledgerTenantId = ctx.tenantId;
        if (_ledgerPersonaId === undefined) _ledgerPersonaId = ctx.personaId;
      }
    }
    if (_ledgerRunId) {
      await sl.autoRecordToolCall({
        runId: _ledgerRunId,
        tenantId: _ledgerTenantId,
        personaId: _ledgerPersonaId,
        toolName: name,
        params,
        result: finalResult,
        durationMs: Date.now() - startMs,
      });
    }
  } catch (e: any) {
    console.error("[step-ledger] autoRecord failed:", e?.message || e);
  }
}
