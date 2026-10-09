import { z } from "zod";

export const TASK_ZONES = [
  "automation_green_light",
  "human_ai_partnership",
  "human_led_red_light",
  "technical_opportunity",
  "low_priority",
] as const;
export type TaskZone = (typeof TASK_ZONES)[number];

export const HUMAN_AGENCY_DEFINITIONS = {
  H1: "Automation green light: people want relief, capability is reliable, and human control needs are low.",
  H2: "Human-AI partnership: AI can accelerate the work while people retain context, review, and decision authority.",
  H3: "Human-led red light: meaningful human control is required; AI support must remain bounded.",
  H4: "Technical opportunity: the need and value are present, but current capability is not yet safe enough.",
  H5: "Low priority: value, demand, or practical benefit is too low for near-term implementation.",
} as const;

export const EVIDENCE_FACT_TYPES = ["customer_stated", "operator_observed", "external", "inference"] as const;
export type EvidenceFactType = (typeof EVIDENCE_FACT_TYPES)[number];
export const EVIDENCE_CONFIDENCE = ["high", "medium", "low"] as const;
export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCE)[number];

const boundedScore = z.number().int().min(0).max(5);
export const taskAssessmentInputSchema = z.object({
  workerDesire: boundedScore,
  technicalCapability: boundedScore,
  humanControlNeed: boundedScore,
  businessValue: boundedScore,
  evidenceConfidence: boundedScore,
}).strict();
export type TaskAssessmentInput = z.infer<typeof taskAssessmentInputSchema>;

export const reportSectionBlueprint = [
  "Executive decision summary", "Scope, sources, and limitations", "Task-by-task agency map",
  "Green lights and safeguards", "Human-AI partnership workflows", "Human-led red lights",
  "Technical opportunities and low priorities", "30 / 60 / 90-day roadmap",
  "Measures, owners, and stop conditions", "Appendix: evidence and confidence",
] as const;

function confidenceLabel(score: number): EvidenceConfidence {
  return score >= 4 ? "high" : score >= 2 ? "medium" : "low";
}

export function classifyTask(input: TaskAssessmentInput) {
  const value = taskAssessmentInputSchema.parse(input);
  let zone: TaskZone;
  if (value.humanControlNeed >= 4) zone = "human_led_red_light";
  else if (value.workerDesire >= 4 && value.technicalCapability >= 4 && value.humanControlNeed <= 1 && value.businessValue >= 3) {
    zone = "automation_green_light";
  } else if (value.workerDesire >= 3 && value.technicalCapability <= 2 && value.businessValue >= 3) {
    zone = "technical_opportunity";
  } else if (value.workerDesire >= 3 && value.technicalCapability >= 3 && value.businessValue >= 3) {
    zone = "human_ai_partnership";
  } else zone = "low_priority";
  return { zone, confidence: confidenceLabel(value.evidenceConfidence) };
}

const prohibitedRecommendation = /\b(?:lay\s*off|layoff|laid\s+off|fire|fired|terminate|termination|hire|hiring|promote|promotion|demote|demotion|discipline|compensation|pay\s+(?:cut|raise)|salary|wage|rank|worker\s+ranking|workforce\s+reductions?|workforce\s+downsizing|role\s+eliminations?|headcount\s+reductions?|downsizing)\b/i;
const prohibitedWorkforceAction = /\b(?:replace|dismiss|eliminate|downsize|reduce)\b(?:\s+\w+){0,4}\s+\b(?:employees?|workers?|staff|roles?|jobs?|positions?|workforce|headcount)\b/i;
const prohibitedAffiliation = /\b(?:Stanford|MIT|WORKBank|O\*NET|Daron\s+Acemoglu|David\s+Autor|Erik\s+Brynjolfsson|Daniel\s+Rock|Andrew\s+McAfee)\b[\s\S]{0,80}\b(?:affiliat(?:e|ed|ion)|partner(?:ed|ship)?|endors(?:e|ed|es|ement)|certif(?:y|ied|ication)|official|representative)\b|\b(?:affiliat(?:e|d|ion)|partner(?:ed|ship)?|endors(?:e|ed|es|ement)|certif(?:y|ied|ication)|official|representative)\b[\s\S]{0,80}\b(?:Stanford|MIT|WORKBank|O\*NET|Daron\s+Acemoglu|David\s+Autor|Erik\s+Brynjolfsson|Daniel\s+Rock|Andrew\s+McAfee)\b/i;

export function validateAuditOutput(output: string): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const exactNeutralLimitations = new Set([
    "this report does not recommend layoffs",
    "this report does not recommend laying off, hiring, ranking, or disciplining workers",
    "no layoff recommendations are made",
    "this is not affiliated with stanford",
  ]);
  const neutralPrefixes = [
    /^this report does not recommend\s+/i,
    /^no layoff recommendations are made[.;]?\s*/i,
    /^this is not affiliated with (?:Stanford|MIT|WORKBank)[.;]?\s*/i,
  ];
  const clauses = String(output).split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  for (const raw of clauses) {
    const normalized = raw.replace(/[.!?;]+$/, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (exactNeutralLimitations.has(normalized)) continue;
    const clause = neutralPrefixes.reduce((s, pattern) => s.replace(pattern, ""), raw);
    if (prohibitedRecommendation.test(clause) || prohibitedWorkforceAction.test(clause)) {
      violations.push("employment or worker decision recommendation");
      break;
    }
  }
  if (clauses.some(clause => {
    const negated = /^(?:this is not|not)\s+(?:affiliated|an official partner|endorsed|certified)/i.test(clause);
    return !negated && prohibitedAffiliation.test(clause);
  })) violations.push("institutional affiliation or endorsement claim");
  return { valid: violations.length === 0, violations };
}