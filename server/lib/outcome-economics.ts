/** Period-wide observability only. Receipts are not semantic acceptance. */
export interface OutcomeCounts {
  total: number;
  receiptBacked: number;
  completedUnverified: number;
  failed: number;
  pending: number;
}

export function summarizeOutcomeEconomics(counts: OutcomeCounts, estimatedWindowCostUsd: number) {
  const values = Object.values(counts);
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) ||
      counts.total !== counts.receiptBacked + counts.completedUnverified + counts.failed + counts.pending) {
    throw new Error("Outcome counts are incomplete or invalid");
  }
  const cost = Number.isFinite(estimatedWindowCostUsd) && estimatedWindowCostUsd >= 0
    ? estimatedWindowCostUsd : null;
  return {
    ...counts,
    scope: "delivery_receipt_only" as const,
    semanticallyVerifiedOutcomes: null,
    estimatedWindowCostUsd: cost,
    windowCostPerReceiptBackedDeliveryUsd: counts.receiptBacked > 0 && cost !== null
      ? cost / counts.receiptBacked : null,
    notice: "Period-wide estimate across all recorded workloads, including failures; not attributed workflow cost, actual billing, content correctness, customer acceptance or inbox receipt.",
  };
}
