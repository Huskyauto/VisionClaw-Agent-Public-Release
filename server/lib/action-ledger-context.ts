/**
 * Action Ledger S3 — per-dispatch ledger context (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S3).
 *
 * Threads the prepared attempt's idempotency key from the S2 middleware down
 * to any provider callsite (Stripe et al.) that executes UNDER a ledgered
 * tool dispatch — via AsyncLocalStorage, NOT via params. Rationale:
 *   - Unforgeable: a caller-supplied `_ledgerIdempotencyKey` param would be a
 *     spoofable trust signal (same class as `_approvedByGate`); ALS context is
 *     only ever set by the middleware after a successful prepare write.
 *   - Zero parity impact: non-ledgered tools never enter the context, so the
 *     S2 byte-identical pass-through contract is untouched.
 *   - Depth-independent: a Stripe call 5 frames deep inside a handler (or a
 *     shared client wrapper) still sees the key without any plumbing.
 *
 * ZERO app-graph dependencies (node:async_hooks only) — safe for a STATIC
 * import from the S24 middleware without breaking its acyclicity invariant,
 * and safe for test files (no pg pool touched).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface LedgerAttemptContext {
  /** action_attempts.id of the prepared row wrapping this dispatch. */
  attemptId: number;
  /** Deterministic `vc-al1-…` key — pass to providers that honor idempotency. */
  idempotencyKey: string;
  /** Tenant the attempt is ledgered under (may be the ADMIN fallback). */
  tenantId: number;
  /** Tool name, for provider-side receipts/telemetry. */
  toolName: string;
}

const storage = new AsyncLocalStorage<LedgerAttemptContext>();

/** Run `fn` with the given ledger attempt visible to the whole async subtree. */
export function runWithLedgerAttempt<T>(ctx: LedgerAttemptContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The ledger attempt wrapping the current async execution, or undefined when
 * not inside a ledgered dispatch. Callers must treat absence as "no key" —
 * never invent a fallback key here (a made-up key defeats provider dedupe).
 */
export function getCurrentLedgerAttempt(): LedgerAttemptContext | undefined {
  return storage.getStore();
}

// ── S5: timeout-retry plumbing (contract plan.md § S5) ──────────────────────
// Two zero-dep channels, both deliberately housed in THIS module so the S24
// middleware's single permitted out-of-package static import stays exactly
// one (the registry-invariants test proves this module remains node:-only).

/**
 * S5 — per-dispatch attempt registry keyed by the dispatch's AbortSignal.
 *
 * The S2 middleware runs INSIDE the Promise.race of `executeToolWithTimeout`,
 * so a timeout rejection propagates to the timeout layer while the middleware
 * (and its prepared-attempt context) is still down-stack. The timeout layer
 * needs the prepared attempt (id + idempotency key) to reconcile-then-maybe-
 * retry — this WeakMap publishes it UP, keyed on the one object both layers
 * share and that only executeToolWithTimeout can create: the dispatch's own
 * AbortSignal. Unforgeable for the same reason the ALS contexts are: a caller
 * cannot inject a signal into the timeout layer (no `_abortSignal` param
 * channel exists), so it cannot plant a forged attempt either. WeakMap ⇒
 * entries die with the signal; `take` also deletes eagerly.
 */
export interface RegisteredLedgerAttempt extends LedgerAttemptContext {
  /** started_at of the prepared row (probe lookback window). */
  startedAt: Date;
}

const attemptsBySignal = new WeakMap<AbortSignal, RegisteredLedgerAttempt>();

/** Middleware-only: publish the prepared attempt for this dispatch's signal. */
export function registerLedgerAttemptForSignal(signal: AbortSignal, attempt: RegisteredLedgerAttempt): void {
  attemptsBySignal.set(signal, attempt);
}

/** Timeout-layer-only: claim (and remove) the attempt registered for `signal`. */
export function takeLedgerAttemptForSignal(signal: AbortSignal): RegisteredLedgerAttempt | undefined {
  const a = attemptsBySignal.get(signal);
  if (a) attemptsBySignal.delete(signal);
  return a;
}

/**
 * S5 — retry directive: set ONLY by the timeout layer's reconcile-first retry
 * path, read by the S2 middleware's prepare step so the retry row reuses the
 * SAME idempotency key (state-machine doc: "a retry is a NEW row that reuses
 * the SAME idempotency key — so providers dedupe"). ALS, not params — a
 * caller-supplied `_reuseIdempotencyKey` would be a spoofable trust signal
 * (forging another attempt's key would alias provider dedupe across calls).
 */
export interface LedgerRetryDirective {
  /** Tool the directive applies to — middleware ignores a mismatched name. */
  toolName: string;
  /** The ORIGINAL attempt's deterministic `vc-al1-…` key to reuse verbatim. */
  reuseIdempotencyKey: string;
  /** action_attempts.id of the original attempt this retry supersedes. */
  retryOfAttemptId: number;
}

const retryDirectiveStorage = new AsyncLocalStorage<LedgerRetryDirective>();

/** Run `fn` (the single retry dispatch) with the directive visible to prepare. */
export function runWithLedgerRetryDirective<T>(d: LedgerRetryDirective, fn: () => T): T {
  return retryDirectiveStorage.run(d, fn);
}

/** The retry directive for the current dispatch, or undefined (normal path). */
export function getCurrentLedgerRetryDirective(): LedgerRetryDirective | undefined {
  return retryDirectiveStorage.getStore();
}
