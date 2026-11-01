/** Audit primary metadata; the execution ladder explicitly selects each route. */
export function tenantAuditProviderOptions(
  lane: string | undefined,
  _explicitlyMetered: boolean,
): {
  providerLane?: "profundo" | "standard-compute" | "openference" | "replit";
  forbidMeteredFallback: boolean;
} {
  if (lane === undefined) return { forbidMeteredFallback: true };
  if (lane !== "profundo" && lane !== "standard-compute" && lane !== "openference" && lane !== "replit") {
    throw new Error("AUDIT_PROVIDER_LANE must be profundo, standard-compute, openference or replit");
  }
  // A disabled/unavailable pin must throw, even when another process has
  // explicitly enabled metered routing. Never silently downgrade this contract.
  return { providerLane: lane, forbidMeteredFallback: true };
}
