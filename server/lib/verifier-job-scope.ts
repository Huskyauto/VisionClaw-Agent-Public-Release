import { sql } from "drizzle-orm";
import { verifierWorkerEnabled } from "./bounded-verifier-worker";

export type VerifierQueueScope = "all" | "only-verifier" | "exclude-verifier";
export function webVerifierQueueScope(value: unknown): VerifierQueueScope {
  return verifierWorkerEnabled(value) ? "exclude-verifier" : "all";
}

/** Internal queue role, not a tenant or caller-selected execution permission. */
export function verifierJobScopeSql(scope: VerifierQueueScope) {
  switch (scope) {
    case "all": return sql``;
    case "only-verifier":
      return sql`AND kind IN ('research_proposal_verification', 'source_repair_verification')`;
    case "exclude-verifier":
      return sql`AND kind NOT IN ('research_proposal_verification', 'source_repair_verification')`;
    default: throw new Error("Unknown verifier queue scope");
  }
}