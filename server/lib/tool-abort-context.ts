/**
 * Action Ledger S4 — per-dispatch cancellation context (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S4).
 *
 * Threads the AbortSignal that `executeToolWithTimeout` already creates (for
 * its Promise.race timeout + stuck-diagnostics tracking) down into the tool's
 * async subtree — via AsyncLocalStorage, NOT via params. Rationale (same as
 * action-ledger-context.ts):
 *   - Unforgeable: a caller-supplied `_abortSignal` param would be a spoofable
 *     channel (a hostile caller could pre-abort another caller's dispatch);
 *     ALS context is only ever set by executeToolWithTimeout itself.
 *   - Zero parity impact: dispatches not entered through the timeout wrapper
 *     simply see `undefined` — every consumer treats absence as "no signal".
 *   - Depth-independent: a fetch client 5 frames deep inside a handler sees
 *     the signal without any plumbing.
 *
 * ADVISORY ONLY (contract § S4): consumers MAY use the signal to stop wasted
 * work after the outer race has already rejected. Nothing may treat the
 * signal as an authority/authz input, and no retry decision keys off it —
 * retry semantics remain disabled until S5.
 *
 * ZERO app-graph dependencies (node:async_hooks only) — safe for static
 * import from server/tools.ts, the dispatcher, and leaf lib modules without
 * creating cycles, and safe for test files (no pg pool touched).
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<AbortSignal>();

/** Run `fn` with `signal` visible to the whole async subtree. */
export function runWithToolAbortSignal<T>(signal: AbortSignal, fn: () => T): T {
  return storage.run(signal, fn);
}

/**
 * The AbortSignal of the tool dispatch wrapping the current async execution,
 * or undefined when not inside a timeout-wrapped dispatch. Absence means
 * "no signal" — never synthesize one here.
 */
export function getCurrentToolAbortSignal(): AbortSignal | undefined {
  return storage.getStore();
}
