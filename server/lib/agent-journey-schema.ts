import { z } from "zod";
import type { AuditCheck } from "../audit-engine";
import type { AgentJourneyResult } from "../../shared/agent-journey";

const publicUrl = z.string().max(2048).url().refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, "Expected a credential-free public HTTP(S) page identity");
export const agentJourneySchema = z.object({
  version: z.literal(1),
  method: z.literal("read_only_website_evidence"),
  pages: z.array(publicUrl).max(3),
  limitations: z.array(z.string().max(1000)).max(10),
  checks: z.array(z.object({
    id: z.enum(["services", "area_hours", "pricing", "contact_route", "requirements"]),
    label: z.string().max(200),
    status: z.enum(["observed", "not_found", "uncertain"]),
    finding: z.string().max(1000),
    evidence: z.array(z.object({ url: publicUrl, excerpt: z.string().max(360) })).max(4),
    nextStep: z.string().max(1000),
  })).length(5).refine(checks => new Set(checks.map(check => check.id)).size === 5, "Five distinct checks are required"),
});

/** Keep the historical checks array and per-check shape intact in audit_reports. */
export function auditChecksForStorage(
  checks: AuditCheck[], journey?: AgentJourneyResult,
): Array<AuditCheck & { agentJourney?: AgentJourneyResult }> {
  if (!journey) return checks;
  return [...checks, {
    id: "agent_customer_journey", label: "Agent customer journey (unscored evidence pilot)",
    category: "Agent customer journey", score: 0, maxScore: 0,
    status: journey.checks.every(check => check.status === "observed") ? "pass" : "warn",
    detail: "Five read-only website evidence checks. Not a live assistant, booking or transaction test; the technical score is unchanged.",
    agentJourney: journey,
  }];
}
