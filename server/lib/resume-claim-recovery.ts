export const RESUME_LEASE_MS = 10 * 60_000;

/** Expiry is uncertainty, NOT proof the owning worker stopped executing. */
export function classifyResumeClaim(input: {
  status: string;
  hasContinuation: boolean;
  leaseUntil?: unknown;
  claimedAt?: unknown;
}, now = Date.now()): "skip" | "live" | "wait" | "review" {
  if (input.status !== "running") return "skip";
  if (input.hasContinuation) return "live";
  const claim = typeof input.claimedAt === "string" ? Date.parse(input.claimedAt) : NaN;
  const lease = typeof input.leaseUntil === "string" ? Date.parse(input.leaseUntil) : NaN;
  // Legacy claims have no lease. Give a recently claiming worker a bounded grace.
  const until = Number.isFinite(lease) ? lease : claim + RESUME_LEASE_MS;
  return Number.isFinite(until) && until > now ? "wait" : "review";
}
