// ─────────────────────────────────────────────────────────────────────────────
// Action Ledger Reconciler — one bounded pass (S3)
// Contract: data/feature-contracts/action-ledger/ (spec.md + plan.md § S3)
// ─────────────────────────────────────────────────────────────────────────────
// 1. Sweeps stale in-flight rows (prepared/executing past AL_STALE_MINUTES)
//    to `unknown` — crash recovery.
// 2. Probes each `unknown` row with a provider verify probe (Stripe events
//    keyed on the attempt's idempotency key). Proof of commit → settle
//    committed WITHOUT re-execution; proven provider failure → settle failed.
// 3. Rows that stay `unknown` are queued to the owner digest ONCE and left
//    for a human verdict. NOTHING is ever retried by this script.
//
// One-line agent-runnable: no prompts, env-configured, meaningful exit codes:
//   0  success (pass completed; summary on stdout)
//   1  fatal error (DB unreachable / pass crashed)
// Env knobs: AL_STALE_MINUTES (default 30, min 5), AL_RECONCILE_BATCH
// (default 50, max 200).
// ─────────────────────────────────────────────────────────────────────────────

import { reconcileOnce, loadDefaultDeps } from "../server/lib/action-ledger-reconciler";

async function main(): Promise<number> {
  const deps = await loadDefaultDeps();
  console.log(`[al-reconcile] pass starting — staleMinutes=${deps.staleMinutes} batchLimit=${deps.batchLimit}`);
  const summary = await reconcileOnce(deps);
  console.log(`[al-reconcile] summary: ${JSON.stringify(summary)}`);
  if (summary.stillUnknown > 0) {
    console.log(`[al-reconcile] ${summary.stillUnknown} attempt(s) remain unknown — surfaced to the owner digest (never auto-retried)`);
  }
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(`[al-reconcile] FATAL: ${err?.message || err}`);
    process.exit(1);
  });
