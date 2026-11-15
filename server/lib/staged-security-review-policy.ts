/** Passive evidence only. This module never grants enforcement authority. */
export interface SecurityReviewObservation {
  observedAt: string;
  sourceHash: string;
  rls: { configured: boolean; available: "available" | "unavailable" | "unknown" };
  scopedTransactions: number;
  sourceChanged?: boolean;
  availabilityUnproven?: boolean;
}

export function summarizeSecurityReview(observations: SecurityReviewObservation[], now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid review clock");
  const valid = observations.filter(o => o && Number.isFinite(Date.parse(o.observedAt))
    && Date.parse(o.observedAt) <= now.getTime()
    && new Date(o.observedAt).toISOString() === o.observedAt
    && /^[a-f0-9]{64}$/.test(o.sourceHash)
    && typeof o.rls?.configured === "boolean"
    && ["available", "unavailable", "unknown"].includes(o.rls.available)
    && Number.isSafeInteger(o.scopedTransactions) && o.scopedTransactions >= 0);
  const days = new Set(valid.map(o => o.observedAt.slice(0, 10)));
  const first = Math.min(...valid.map(o => Date.parse(o.observedAt)));
  const elapsedDays = valid.length ? Math.floor((now.getTime() - first) / 86_400_000) : 0;
  const gaps = ["unwrapped_queries_not_measured", "blocked_query_rate_not_measured"];
  if (days.size < 7) gaps.push("fewer_than_seven_observed_days");
  if (valid.length && elapsedDays > days.size) gaps.push("missed_observation_days");
  if (valid.some(o => o.sourceChanged) || new Set(valid.map(o => o.sourceHash)).size > 1) gaps.push("source_changed_during_review");
  if (valid.some(o => o.availabilityUnproven || o.rls.available !== "available")) gaps.push("policy_or_role_availability_unproven");
  if (valid.length !== observations.length) gaps.push("invalid_observation_excluded");
  if (!valid.some(o => o.scopedTransactions > 0)) gaps.push("no_scoped_transaction_traffic_observed");
  return {
    stage: days.size >= 7 && elapsedDays >= 7 ? "owner_review_required" : "observing",
    observedDays: days.size, elapsedDays, gaps,
    enforcementAuthorized: false as const, securityCleared: false as const,
  };
}
