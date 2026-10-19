import { z } from "zod";
import { dateSchema, evidenceSchema, titleSchema, type PilotResult } from "./common";

export const RELEASE_AREAS = [
  { id: "functional", label: "Critical customer journeys", guidance: "Reference tests of the exact candidate's primary create/edit/delete and failure paths." },
  { id: "access", label: "Authentication and tenant isolation", guidance: "Reference unauthorized, wrong-role and cross-tenant checks for this candidate." },
  { id: "security", label: "Security and dependencies", guidance: "Reference a recent security review, scan findings and their disposition." },
  { id: "data", label: "Data durability and recovery", guidance: "Reference persistence, backup/restore and any migration verification." },
  { id: "operations", label: "Deployment, monitoring and rollback", guidance: "Reference startup/health checks, alerts and a tested rollback procedure." },
  { id: "ownership", label: "Accountable release owner", guidance: "Name the accountable role and reference the remaining-risk review." },
] as const;
const areaIds = RELEASE_AREAS.map(a => a.id) as ["functional", "access", "security", "data", "operations", "ownership"];
export const releaseSchema = z.object({
  product: titleSchema, version: titleSchema,
  checks: z.array(z.object({
    area: z.enum(areaIds), status: z.enum(["pass", "fail", "unknown"]),
    evidence: evidenceSchema, checkedAt: dateSchema.nullable().optional().default(null),
  }).strict()).length(RELEASE_AREAS.length).refine(rows => new Set(rows.map(row => row.area)).size === RELEASE_AREAS.length,
    "Provide every required review area once"),
}).strict();
export type ReleaseInput = z.infer<typeof releaseSchema>;
export function analyzeRelease(input: ReleaseInput, today = new Date().toISOString().slice(0, 10)): PilotResult {
  const findings = RELEASE_AREAS.map(area => {
    const row = input.checks.find(row => row.area === area.id)!;
    const age = row.checkedAt ? (Date.parse(today) - Date.parse(row.checkedAt)) / 86_400_000 : null;
    const supported = row.status === "pass" && row.evidence.trim().length > 0 && age !== null && age >= 0 && age <= 30;
    return { label: area.label, status: row.status === "fail" ? "blocked" as const : supported ? "reported" as const : "unknown" as const,
      detail: row.status === "fail" ? "Operator reports this area failed; release review is blocked." :
        supported ? `Operator reports a pass for candidate ${input.version}; dated ${row.checkedAt}.` :
          "Pass not established: supply a result, evidence reference and date within the past 30 days.",
      evidence: row.evidence, nextStep: supported ? "Owner must inspect the referenced evidence against this exact candidate." : area.guidance };
  });
  const blocked = findings.filter(f => f.status === "blocked").length;
  const missing = findings.filter(f => f.status === "unknown").length;
  return { title: `${input.product}: release review ${input.version}`,
    verdict: blocked ? "Blocked — reported failures" : missing ? "Incomplete — evidence gaps" : "Ready for human review — not release approval",
    summary: `${findings.length - blocked - missing}/${findings.length} areas have current, supplied passing evidence references; ${blocked} failed and ${missing} incomplete.`,
    findings, metrics: [], limitations: [
      "Manual evidence inventory only. References were not opened, test suites were not executed, and pass assertions were not independently verified.",
      "Evidence freshness window is a 30-day pilot policy, not an industry standard. A new candidate still requires candidate-specific review.",
      "This tool cannot approve, publish or certify a release; the accountable owner makes that decision.",
    ] };
}
