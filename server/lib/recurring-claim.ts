/** The caller's claim must be a durable compare-and-set, before any egress. */
export async function runClaimedRecurringOccurrence<T>(
  claim: () => Promise<boolean>,
  execute: () => Promise<T>,
): Promise<{ claimed: false } | { claimed: true; result: T }> {
  if (!await claim()) return { claimed: false };
  return { claimed: true, result: await execute() };
}