import { z } from "zod";
import { healthSchema, analyzeHealth } from "./health";
import { releaseSchema, analyzeRelease } from "./release";
import { governanceSchema, analyzeGovernance } from "./governance";
import { costSchema, analyzeCost } from "./cost";
import type { PilotResult } from "./common";
export const pilotKindSchema = z.enum(["health", "release", "governance", "cost"]);
export type PilotKind = z.infer<typeof pilotKindSchema>;
export const pilotSchemas = { health: healthSchema, release: releaseSchema, governance: governanceSchema, cost: costSchema };
export function analyzePilot(kind: PilotKind, input: unknown, baseline?: unknown): PilotResult {
  switch (kind) {
    case "health": return analyzeHealth(healthSchema.parse(input), baseline ? healthSchema.parse(baseline) : undefined);
    case "release": return analyzeRelease(releaseSchema.parse(input));
    case "governance": return analyzeGovernance(governanceSchema.parse(input));
    case "cost": return analyzeCost(costSchema.parse(input));
  }
}
