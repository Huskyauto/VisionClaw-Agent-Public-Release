/**
 * Action Ledger S5 — reconcile-first timeout retry (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md § "Re-enable timeout retry
 * ONLY for tools with a committed ledger + verify probe" + plan.md § S5).
 *
 * This module makes the ONE decision the timeout layer needs after a ledgered
 * dispatch times out: retry, don't-retry, or escalate. Decision table
 * (plan § S5 + spec acceptance #1):
 *
 *   row state after grace poll │ probe result   │ decision
 *   ───────────────────────────┼────────────────┼──────────────────────────────
 *   committed                  │ (not run)      │ NO-RETRY (original committed)
 *   failed                     │ (not run)      │ RETRY (provider recorded fail)
 *   prepared/executing/unknown │ committed      │ NO-RETRY + settle committed
 *   prepared/executing/unknown │ failed (proven)│ RETRY + settle failed
 *   prepared/executing/unknown │ unknown        │ ESCALATE (park unknown → S3
 *                              │                │ reconciler + owner digest)
 *
 * Invariants (contract risk note — NON-NEGOTIABLE):
 *   - Retry only on PROVEN non-commit. Probe `unknown` NEVER retries.
 *   - No probe registered for the tool ⇒ no retry AT ALL (rethrow the timeout;
 *     behavior identical to pre-S5).
 *   - The retry reuses the SAME idempotency key (via the ALS retry directive —
 *     see action-ledger-context.ts) so providers dedupe if the original lands.
 *   - Exactly ONE retry per dispatch — the retry's own timeout never recurses.
 *
 * The grace poll exists because the Promise.race loser (the original dispatch)
 * keeps running after the timeout rejection: its settle may land moments
 * later. Reading the row first is the cheapest, most authoritative reconcile —
 * the "commit-after-timeout ⇒ NO double execution" acceptance case resolves
 * here without ever probing the provider.
 *
 * All DB/probe access is via injectable deps (default loader uses dynamic
 * imports) so the decision table is unit-testable with zero pg pool.
 */

import type { ActionAttemptState } from "./action-ledger";
import type { VerifyProbe } from "./action-ledger-probes";

export interface TimeoutRetryAttempt {
  attemptId: number;
  idempotencyKey: string;
  tenantId: number;
  toolName: string;
  startedAt: Date;
}

export type TimeoutRetryDecision =
  | { decision: "no-retry"; reason: "no-probe" | "disabled" | "committed" | "committed-by-probe" }
  | { decision: "retry"; reason: "failed" | "proven-failed-by-probe"; reuseIdempotencyKey: string; retryOfAttemptId: number }
  | { decision: "escalate"; reason: string };

export interface TimeoutRetryDeps {
  getAttemptState: (id: number, tenantId: number) => Promise<ActionAttemptState | undefined>;
  settleAttempt: (
    id: number,
    tenantId: number,
    outcome: "committed" | "failed",
    opts?: { providerReceipt?: unknown; error?: string },
  ) => Promise<boolean>;
  markUnknown: (id: number, tenantId: number, reason?: string) => Promise<boolean>;
  getVerifyProbe: (toolName: string) => VerifyProbe | undefined;
  /** Grace window for the original dispatch's settle to land (ms). */
  graceMs?: number;
  /** Poll interval within the grace window (ms). */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_GRACE_MS = 5_000;
const DEFAULT_POLL_MS = 500;

/** Kill switch: AL_TIMEOUT_RETRY=0 disables the retry lane entirely (pre-S5 behavior). */
export function timeoutRetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AL_TIMEOUT_RETRY !== "0";
}

// ---------------------------------------------------------------------------
// Catch-lane error contract (producers + predicate live TOGETHER so the
// replacement rule can never drift from the messages it matches).
//
// executeToolWithTimeout's S5 catch lane replaces the original timeout error
// with a retry-lane error ONLY when that error carries more truth than the
// bare timeout: (a) the commit is CONFIRMED (the side effect landed — no
// layer above may re-invoke), or (b) the single retry ITSELF timed out (the
// attempt is parked for the reconciler). Any other retry-lane failure is
// plumbing — the original timeout error is kept.
// ---------------------------------------------------------------------------

/** Loud "the side effect LANDED — do not re-invoke" error (replaces the timeout). */
export function buildCommitConfirmedError(toolName: string, timeoutMs: number, attemptId: number): Error {
  return new Error(
    `Tool "${toolName}" timed out after ${timeoutMs / 1000}s, but the provider-side commit is CONFIRMED ` +
    `(action ledger attempt ${attemptId}). Do NOT retry this call — the side effect already happened.`,
  );
}

/** The single S5 retry's own timeout (replaces the original — escalation is parked). */
export function buildRetryTimeoutError(toolName: string, timeoutMs: number): Error {
  return new Error(
    `Tool "${toolName}" retry timed out after ${timeoutMs / 1000}s (single S5 retry — escalating to reconciler)`,
  );
}

/**
 * TRUE ⇔ the retry-lane error must REPLACE the original timeout error
 * (commit-CONFIRMED or retry-timeout). Everything else (plumbing failures,
 * non-Error throws) keeps the original. Pure — unit-tested directly.
 */
export function shouldReplaceTimeoutError(retryErr: unknown): retryErr is Error {
  return retryErr instanceof Error && /CONFIRMED|retry timed out/.test(retryErr.message);
}

async function loadDefaultDeps(): Promise<TimeoutRetryDeps> {
  const [ledger, probes] = await Promise.all([
    import("./action-ledger"),
    import("./action-ledger-probes"),
  ]);
  return {
    getAttemptState: ledger.getAttemptState,
    settleAttempt: ledger.settleAttempt,
    markUnknown: ledger.markUnknown,
    getVerifyProbe: probes.getVerifyProbe,
  };
}

/**
 * Reconcile FIRST, then decide. Never throws — a plumbing failure escalates
 * (fail toward the reconciler/owner digest, never toward retry).
 */
export async function decideTimeoutRetry(
  attempt: TimeoutRetryAttempt,
  deps?: TimeoutRetryDeps,
): Promise<TimeoutRetryDecision> {
  let d: TimeoutRetryDeps;
  try {
    d = deps ?? (await loadDefaultDeps());
  } catch (e: any) {
    return { decision: "escalate", reason: `retry deps unavailable: ${e?.message || e}` };
  }

  // Gate 0: no probe ⇒ no retry lane at all (contract: ledger + probe ONLY).
  let probe: VerifyProbe | undefined;
  try {
    probe = d.getVerifyProbe(attempt.toolName);
  } catch (e: any) {
    return { decision: "escalate", reason: `probe lookup failed: ${e?.message || e}` };
  }
  if (!probe) return { decision: "no-retry", reason: "no-probe" };

  const graceMs = Math.max(0, d.graceMs ?? DEFAULT_GRACE_MS);
  const pollMs = Math.max(50, d.pollMs ?? DEFAULT_POLL_MS);
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  // Reconcile step 1 — the ledger row. The race-loser original is still
  // running; give its settle a bounded grace window before touching the
  // provider. committed/failed here are AUTHORITATIVE (written by the
  // middleware from the actual tool result).
  let state: ActionAttemptState | undefined;
  const deadline = Date.now() + graceMs;
  try {
    for (;;) {
      state = await d.getAttemptState(attempt.attemptId, attempt.tenantId);
      if (state === "committed") return { decision: "no-retry", reason: "committed" };
      if (state === "failed") {
        return {
          decision: "retry",
          reason: "failed",
          reuseIdempotencyKey: attempt.idempotencyKey,
          retryOfAttemptId: attempt.attemptId,
        };
      }
      if (state === undefined || state === "unknown" || state === "compensated") break;
      if (Date.now() >= deadline) break;
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  } catch (e: any) {
    return { decision: "escalate", reason: `ledger read failed during grace poll: ${e?.message || e}` };
  }
  if (state === undefined) return { decision: "escalate", reason: "attempt row not found" };
  if (state === "compensated") return { decision: "no-retry", reason: "committed" };

  // Reconcile step 2 — provider probe. Only a POSITIVE proof moves us off
  // "unknown": committed ⇒ settle + no-retry; proven failure ⇒ settle + retry;
  // anything else escalates (probes fail toward unknown, never toward retry).
  let probeResult: Awaited<ReturnType<VerifyProbe>>;
  try {
    probeResult = await probe({
      toolName: attempt.toolName,
      idempotencyKey: attempt.idempotencyKey,
      startedAt: attempt.startedAt,
      tenantId: attempt.tenantId,
    });
  } catch (e: any) {
    probeResult = { outcome: "unknown", note: `probe threw: ${e?.message || e}` };
  }

  if (probeResult.outcome === "committed") {
    try {
      await d.settleAttempt(attempt.attemptId, attempt.tenantId, "committed", { providerReceipt: probeResult.receipt });
    } catch (e: any) {
      console.error(`[action-ledger-retry] settle(committed) failed for attempt ${attempt.attemptId}: ${e?.message || e}`);
    }
    return { decision: "no-retry", reason: "committed-by-probe" };
  }
  if (probeResult.outcome === "failed" && probeResult.proven === true) {
    try {
      await d.settleAttempt(attempt.attemptId, attempt.tenantId, "failed", {
        providerReceipt: probeResult.receipt,
        error: "timeout: provider affirmatively recorded failure (S5 probe)",
      });
    } catch (e: any) {
      console.error(`[action-ledger-retry] settle(failed) failed for attempt ${attempt.attemptId}: ${e?.message || e}`);
    }
    return {
      decision: "retry",
      reason: "proven-failed-by-probe",
      reuseIdempotencyKey: attempt.idempotencyKey,
      retryOfAttemptId: attempt.attemptId,
    };
  }

  // Unprovable ⇒ park as unknown (guarded transition — no-ops if the original
  // settles concurrently) and hand off to the S3 reconciler + owner digest.
  try {
    await d.markUnknown(
      attempt.attemptId,
      attempt.tenantId,
      `timeout: outcome unprovable at retry gate (${(probeResult as any).note || "no probe evidence"})`,
    );
  } catch (e: any) {
    console.error(`[action-ledger-retry] markUnknown failed for attempt ${attempt.attemptId}: ${e?.message || e}`);
  }
  return { decision: "escalate", reason: (probeResult as any).note || "probe returned unknown" };
}
