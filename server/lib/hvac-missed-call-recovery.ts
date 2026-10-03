import { z } from "zod";
export { calculateHvacOpportunity } from "@shared/lib/hvac-missed-call-recovery";
export type { HvacEstimateAssumptions, HvacOpportunityEstimate } from "@shared/lib/hvac-missed-call-recovery";

export const HVAC_INTAKE_KEYS = [
  "contactRole", "employeeBand", "currentPhoneHandling", "afterHoursFlow",
  "webLeadPath", "averageJobValueSource", "currentTools", "desiredSla", "notes",
] as const;
export const HVAC_READINESS_KEYS = ["sourceDataConfirmed", "leadPathDocumented", "scopeReviewed", "ownerApproval"] as const;
const boundedRecord = (keys: readonly string[], value: z.ZodTypeAny) =>
  z.record(z.string().max(80), value).refine(v => Object.keys(v).length <= keys.length && Object.keys(v).every(k => keys.includes(k)), "Unsupported or excessive keys");
export const hvacWorkspaceRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  prospectName: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160),
  trade: z.enum(["hvac", "plumbing"]),
  intake: boundedRecord(HVAC_INTAKE_KEYS, z.string().max(2000)),
  assumptions: z.object({
    monthlyInboundCalls: z.number().finite().min(0).max(100000),
    missedCallRatePercent: z.number().finite().min(0).max(100),
    bookingRatePercent: z.number().finite().min(0).max(100),
    averageJobValueUsd: z.number().finite().min(0).max(1000000),
  }),
  status: z.enum(["discovery", "proposal", "ready", "won", "lost"]),
  readiness: boundedRecord(HVAC_READINESS_KEYS, z.boolean()),
}).strict();
export const hvacWorkspacePatchSchema = hvacWorkspaceRequestSchema.omit({ idempotencyKey: true }).partial().strict();
