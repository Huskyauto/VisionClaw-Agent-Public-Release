/** Aggregate process-window counters only: never SQL text or tenant values. */
const windowStartedAt = new Date().toISOString();
let started = 0, completed = 0, failed = 0;
export function recordScopedTransaction(event: "started" | "completed" | "failed"): void {
  if (event === "started") started++;
  else if (event === "completed") completed++;
  else failed++;
}
export function scopedTransactionObservation() {
  return { windowStartedAt, started, completed, failed };
}
