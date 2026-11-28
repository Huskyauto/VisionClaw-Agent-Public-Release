/** Read-only view of existing reservations, not another billing ledger.
 * A reservation is an admitted maximum, including potentially uncertain work;
 * it is never evidence that this amount was charged or that delivery was free. */
export function companyPackageCostSummary(payload: { packageSpend?: unknown }) {
  const base = {
    actualTotalUsd: null,
    excludedCosts: ["research", "narration", "rendering", "storage and delivery", "labor"],
  };
  const claims = payload.packageSpend;
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    return { ...base, status: "unavailable" as const, reservedModelUsd: null, reservationCount: null };
  const amounts = Object.values(claims);
  let total = 0;
  if (amounts.length > 2000)
    return { ...base, status: "invalid" as const, reservedModelUsd: null, reservationCount: null };
  for (const amount of amounts) {
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
        !Number.isSafeInteger(total + amount))
      return { ...base, status: "invalid" as const, reservedModelUsd: null, reservationCount: null };
    total += amount;
  }
  return { ...base, status: "unreconciled" as const,
    reservedModelUsd: total / 1_000_000, reservationCount: amounts.length };
}
