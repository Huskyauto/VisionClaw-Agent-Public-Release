/**
 * Action Ledger S2 — middleware wrap at the S24 seam (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S2).
 *
 * RECORD-ONLY slice: for ledger-MANDATORY tools (risk `destructive` per
 * `getEffectiveToolRisk` → `ledgerObligation` — derived, never copied), a
 * `prepared` row is persisted BEFORE dispatch crosses the tool boundary, and
 * the row is settled AFTER: result → `committed`, result.error → `failed`,
 * throw → `unknown` (outcome unprovable — the S3 reconciler settles it).
 * Timeout retries remain DISABLED; nothing here retries anything.
 *
 * Behavior contract:
 *   - Non-ledgered tools (safe/sensitive risk): `inner()` is invoked directly —
 *     dispatch path unchanged (parity test: tests/tools/action-ledger-middleware.test.ts).
 *   - No tenant context (destructive tool invoked without a positive-integer
 *     `_tenantId`): the attempt is ledgered under the ADMIN tenant with a loud
 *     log (same convention as the providers "billing ADMIN" fallback) — the
 *     spec's "prepared row BEFORE crossing the boundary" holds for EVERY
 *     destructive attempt. Tenant AUTHORITY remains the guarded-tool-executor /
 *     AHB policy's job (untouched invariant); the ledger never becomes a
 *     second authz gate — it records, it does not block on tenant absence.
 *   - Prepare-write failure for a mandatory tool: FAIL CLOSED — refuse the call
 *     with a structured error instead of performing an unrecorded destructive
 *     side effect (same stance as the TNR snapshot gate; S1 lib doc line:
 *     "a ledger-mandatory tool must NOT execute if the prepare write failed").
 *   - Settle/markUnknown failures after dispatch: logged and swallowed — the
 *     tool result (or original throw) always wins.
 *
 * The ledger + policy implementations are pulled via call-time dynamic
 * `import()` (S24 acyclicity invariant — no static edge into the app graph);
 * tests inject fakes via the optional `deps` parameter, so no pg pool is
 * touched (node-test-db-pool-hang).
 */

import { randomUUID } from "node:crypto";
// S3: zero-dep ALS module (node:async_hooks only) — a STATIC import here does
// NOT violate the S24 acyclicity invariant (no app-graph edge) and touches no
// pg pool in tests. See server/lib/action-ledger-context.ts for the rationale
// (unforgeable threading — params would be a spoofable trust signal).
import {
  runWithLedgerAttempt,
  getCurrentLedgerRetryDirective,
  registerLedgerAttemptForSignal,
} from "../../lib/action-ledger-context";

export interface ActionLedgerDeps {
  getEffectiveToolRisk: (toolName: string) => "safe" | "sensitive" | "destructive";
  ledgerObligation: (risk: "safe" | "sensitive" | "destructive") => "mandatory" | "opt-in" | "never";
  prepareAttempt: (i: {
    tenantId: number;
    operationId: string;
    toolName: string;
    args: unknown;
    risk: "safe" | "sensitive" | "destructive";
    conversationId?: number | null;
    /** S5 — set ONLY from the ALS retry directive (reconciled-timeout retry). */
    reuseIdempotencyKey?: string;
    retryOfAttemptId?: number;
  }) => Promise<{ id: number; idempotencyKey: string; argumentsHash: string }>;
  settleAttempt: (
    id: number,
    tenantId: number,
    outcome: "committed" | "failed",
    opts?: { error?: string },
  ) => Promise<boolean>;
  markUnknown: (id: number, tenantId: number, reason?: string) => Promise<boolean>;
  /** Fallback attribution tenant for destructive attempts with no tenant context. */
  adminTenantId: number;
}

async function loadDeps(): Promise<ActionLedgerDeps> {
  const [policy, ledger, auth] = await Promise.all([
    import("../../safety/destructive-tool-policy"),
    import("../../lib/action-ledger"),
    import("../../auth"),
  ]);
  return {
    getEffectiveToolRisk: policy.getEffectiveToolRisk,
    ledgerObligation: ledger.ledgerObligation,
    prepareAttempt: ledger.prepareAttempt,
    settleAttempt: ledger.settleAttempt,
    markUnknown: ledger.markUnknown,
    adminTenantId: auth.ADMIN_TENANT_ID,
  };
}

/**
 * S4 — platform-owned opt-in set: `sensitive`-risk tools that ARE ledgered
 * despite not being mandatory. Membership is a code-level decision (reviewed
 * like a policy change), never derived from caller input. Criteria: the tool
 * has a provider-side verify probe (see server/lib/action-ledger-probes.ts)
 * so an `unknown` row is actually reconcilable.
 */
export const LEDGER_OPT_IN_TOOL_NAMES: ReadonlySet<string> = new Set(["send_email"]);

/** Pure: map a tool result to a ledger outcome. An object with a truthy `error` field is a failure. */
export function outcomeFromResult(result: unknown): "committed" | "failed" {
  if (result && typeof result === "object" && (result as any).error) return "failed";
  return "committed";
}

/** Pure: extract a bounded error string from a failed tool result for the ledger row. */
export function errorFromResult(result: unknown): string | undefined {
  if (result && typeof result === "object" && (result as any).error) {
    const e = (result as any).error;
    const s = typeof e === "string" ? e : JSON.stringify(e);
    return s ? s.slice(0, 2000) : undefined;
  }
  return undefined;
}

/** Pure: extract a bounded reason string from a thrown value. */
export function reasonFromThrow(err: unknown): string {
  const msg = (err as any)?.message || String(err);
  return `throw: ${String(msg).slice(0, 2000)}`;
}

/**
 * Wrap a tool dispatch with the action ledger. Called from `executeTool`
 * (server/tools.ts) inside the tracing span, wrapping `_executeToolInner`.
 */
export async function withActionLedger(
  name: string,
  params: Record<string, any>,
  inner: () => Promise<any>,
  deps?: ActionLedgerDeps,
): Promise<any> {
  let d: ActionLedgerDeps;
  let obligation: "mandatory" | "opt-in" | "never";
  let risk: "safe" | "sensitive" | "destructive";
  try {
    d = deps ?? (await loadDeps());
    risk = d.getEffectiveToolRisk(name);
    obligation = d.ledgerObligation(risk);
  } catch (e: any) {
    // Classification plumbing broke — fail OPEN with a loud log (matches the
    // AHB intent-gate stance for gate plumbing; the destructive-tool POLICY
    // gate upstream is the fail-closed authority, not this recorder).
    console.error(`[action-ledger] classification failed for ${name} (recording skipped): ${e?.message || e}`);
    return inner();
  }
  // Mandatory (destructive) tools are always ledgered. S4 adds the opt-in
  // channel for `sensitive` tools: a PLATFORM-owned static set (never a
  // caller-supplied flag — that would be a spoofable trust signal). First
  // entry: send_email, whose sent-mail verify probe (plan § S4) needs a
  // ledgered attempt row + ALS idempotency key to stamp the outbound header.
  if (obligation === "never") return inner();
  if (obligation === "opt-in" && !LEDGER_OPT_IN_TOOL_NAMES.has(name)) return inner();

  const stampedTenant = typeof params._tenantId === "number" && Number.isInteger(params._tenantId) && params._tenantId > 0
    ? params._tenantId
    : undefined;
  // No tenant context ⇒ internal/system caller (tenant-authorized paths are
  // stamped by the guarded executor). Attribute to the ADMIN tenant with a
  // loud log — same convention as the providers "billing ADMIN" fallback —
  // so EVERY destructive attempt gets a prepared row before the boundary.
  const tenantId = stampedTenant ?? d.adminTenantId;
  if (!stampedTenant) {
    console.warn(`[action-ledger] destructive tool ${name} invoked without tenant context — ledgering under ADMIN tenant ${tenantId}`);
  }

  // S5 — reconciled-timeout retry: the directive is set ONLY by the timeout
  // layer's retry lane (ALS — unforgeable; a params channel would be spoofable)
  // and applies ONLY to the matching tool name. The retry row reuses the
  // ORIGINAL attempt's idempotency key so providers dedupe if the timed-out
  // original lands after all.
  const retryDirective = getCurrentLedgerRetryDirective();
  const isReconciledRetry = !!retryDirective && retryDirective.toolName === name;

  let attemptId: number;
  let idempotencyKey: string;
  try {
    const prepared = await d.prepareAttempt({
      tenantId,
      operationId: randomUUID(),
      toolName: name,
      args: params,
      risk,
      // `_conversationId` at this seam is caller-suppliable (NOT a stamped
      // trust signal — see autonomous-executor policy notes), so it is NOT
      // written to the ledger: untrusted audit linkage is worse than none.
      // A trusted ctx-threaded source is a later slice (with run_id/plan_id).
      conversationId: null,
      ...(isReconciledRetry
        ? {
            reuseIdempotencyKey: retryDirective!.reuseIdempotencyKey,
            retryOfAttemptId: retryDirective!.retryOfAttemptId,
          }
        : {}),
    });
    attemptId = prepared.id;
    idempotencyKey = prepared.idempotencyKey;
  } catch (prepErr: any) {
    // FAIL CLOSED: no unrecorded destructive side effects (contract spec:
    // "a `prepared` row is persisted BEFORE crossing the external boundary").
    console.error(`[action-ledger] prepare failed for ${name}: ${prepErr?.message || prepErr} — refusing call (fail-closed)`);
    return { error: `[action-ledger] could not record the attempt before execution: ${prepErr?.message || String(prepErr)} — refusing ${name} (fail-closed; retry after the ledger write succeeds)` };
  }

  // S5 — publish the prepared attempt UP to the timeout layer, keyed on this
  // dispatch's AbortSignal (created only by executeToolWithTimeout — see
  // registerLedgerAttemptForSignal doc for why this is unforgeable). Dynamic
  // import: tool-abort-context is zero-dep, but the registry-invariants
  // carve-out permits exactly ONE out-of-package STATIC import, and that slot
  // is action-ledger-context's. Best-effort — a failure here only means the
  // timeout layer can't reconcile-retry (pre-S5 behavior), never a blocked call.
  try {
    const { getCurrentToolAbortSignal } = await import("../../lib/tool-abort-context");
    const signal = getCurrentToolAbortSignal();
    if (signal) {
      registerLedgerAttemptForSignal(signal, {
        attemptId,
        idempotencyKey,
        tenantId,
        toolName: name,
        startedAt: new Date(),
      });
    }
  } catch (regErr: any) {
    console.error(`[action-ledger] attempt-signal registration failed for ${name}: ${regErr?.message || regErr}`);
  }

  let result: any;
  try {
    // S3: expose the prepared attempt (attemptId + idempotency key) to the
    // whole async subtree of the dispatch via ALS — provider callsites
    // (e.g. stripeClient's withLedgerIdempotency) attach the key natively so
    // a reconciled retry dedupes at the provider. Context is set ONLY after a
    // successful prepare write; non-ledgered tools never enter it.
    result = await runWithLedgerAttempt(
      { attemptId, idempotencyKey, tenantId, toolName: name },
      () => inner(),
    );
  } catch (err) {
    // Outcome unprovable (the side effect may have committed) → park as
    // `unknown` for the S3 reconciler. Never mask the original throw.
    try {
      await d.markUnknown(attemptId, tenantId, reasonFromThrow(err));
    } catch (muErr: any) {
      console.error(`[action-ledger] markUnknown failed for ${name} attempt ${attemptId}: ${muErr?.message || muErr}`);
    }
    throw err;
  }
  try {
    await d.settleAttempt(attemptId, tenantId, outcomeFromResult(result), { error: errorFromResult(result) });
  } catch (settleErr: any) {
    console.error(`[action-ledger] settle failed for ${name} attempt ${attemptId}: ${settleErr?.message || settleErr}`);
  }
  return result;
}
