import { z } from "zod";
import { dateSchema, evidenceSchema, titleSchema, type PilotResult } from "./common";

export const GOVERNANCE_CONTROLS = [
  { id: "inventory", label: "AI systems and risk inventory", guidance: "Identify systems, intended uses, affected people and the risks in scope." },
  { id: "access", label: "Access, data and tenant boundaries", guidance: "Reference access reviews, tenant-boundary tests and sensitive-data handling rules." },
  { id: "oversight", label: "Human oversight and approvals", guidance: "Reference consequential-action approval rules and an accountable owner." },
  { id: "traceability", label: "Activity and decision traceability", guidance: "Reference retained audit records, source provenance and retention/access rules." },
  { id: "evaluation", label: "Evaluation and change control", guidance: "Reference evaluations, acceptance criteria and approval of model/system changes." },
  { id: "incident", label: "Incident response and stop controls", guidance: "Reference escalation, disable/rollback procedures and a tested response exercise." },
] as const;
const ids = GOVERNANCE_CONTROLS.map(c => c.id) as ["inventory", "access", "oversight", "traceability", "evaluation", "incident"];
export const governanceSchema = z.object({
  organization: titleSchema, scope: z.string().trim().min(1).max(1000),
  controls: z.array(z.object({
    control: z.enum(ids), status: z.enum(["implemented", "planned", "unknown"]),
    owner: z.string().trim().max(160).default(""), evidence: evidenceSchema,
    reviewedAt: dateSchema.nullable().optional().default(null),
  }).strict()).length(GOVERNANCE_CONTROLS.length).refine(rows => new Set(rows.map(row => row.control)).size === GOVERNANCE_CONTROLS.length,
    "Provide every required control once"),
}).strict();
export type GovernanceInput = z.infer<typeof governanceSchema>;
export function analyzeGovernance(input: GovernanceInput, today = new Date().toISOString().slice(0, 10)): PilotResult {
  const findings = GOVERNANCE_CONTROLS.map(control => {
    const row = input.controls.find(row => row.control === control.id)!;
    const age = row.reviewedAt ? (Date.parse(today) - Date.parse(row.reviewedAt)) / 86_400_000 : null;
    const supported = row.status === "implemented" && !!row.owner.trim() && !!row.evidence.trim() &&
      age !== null && age >= 0 && age <= 90;
    const gaps = [
      ...(row.status !== "implemented" ? ["implementation not reported"] : []),
      ...(!row.owner.trim() ? ["accountable owner missing"] : []),
      ...(!row.evidence.trim() ? ["evidence reference missing"] : []),
      ...(age === null || age < 0 || age > 90 ? ["review date missing, future or older than 90 days"] : []),
    ];
    return { label: control.label, status: supported ? "reported" as const : "gap" as const,
      detail: supported ? `Reported implemented; owner: ${row.owner}; last reviewed ${row.reviewedAt}.` : gaps.join("; ") + ".",
      evidence: row.evidence, nextStep: supported ? "An independent reviewer must inspect the referenced controls and evidence." : control.guidance };
  });
  const reported = findings.filter(f => f.status === "reported").length;
  return { title: `${input.organization}: governance evidence pack`,
    verdict: `${reported}/${findings.length} controls documented — not certification`,
    summary: `Declared scope: ${input.scope}. ${findings.length - reported} controls have documentation or freshness gaps.`,
    findings, metrics: [], limitations: [
      "General-purpose evidence organizer, not a mapping to an official Accord, law, standard or insurer requirement.",
      "All implementation claims and references are operator supplied; source documents and control effectiveness were not independently verified.",
      "The 90-day review window is a pilot freshness policy, not a legal requirement.",
      "No certification, compliance determination or legal advice. Obtain the applicable requirements and qualified review separately.",
    ] };
}
