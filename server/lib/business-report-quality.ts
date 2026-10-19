import { reportActionTextSchemas } from "./business-report-reply-contract";

/** Fixed public-source advisory contract. No model calls, delivery or authority. */
export type ReportCorrection = { id: string; text: string };
export type ReportAction = {
  priority: number; action: string; sourceIds: string[]; benefit: string;
  effort: string; cost: string; risk: string; dependency: string; owner: string; measurement: string;
};
export type ReportQuality = {
  actionPlan: ReportAction[];
  corrections: { id: string; disposition: "corrected" | "removed"; resolution: string }[];
};
export type ReportQualityIssue = { path: string; code: string; minimum?: number; maximum?: number };
export class ReportQualityError extends Error {
  constructor(message: string, readonly issues: ReportQualityIssue[] = []) { super(message); }
}

export const REPORT_READER_GUIDANCE = [
  "DETAILED BUSINESS ASSESSMENT: Begin every section with a short highlighted bullet-point overview, followed by detailed analysis and practical recommendations. The overview helps readers navigate the detail; it must not replace the detail.",
  "Executive Summary: give a bullet-point overview of all major report sections, the business implications, the top priorities and the first move this week. This opening is not the whole report. There are no editorial word-count rejection limits.",
  "Use clear sentences and concrete bullets. Explain unavoidable technical terms once. Give each section enough detail to explain the finding, why it matters, the recommended improvement and a practical first test. Avoid generic introductions, padding and duplicated recommendations.",
  "Keep only the strongest business-specific income opportunities: at most three primary growth bets and two optional add-ons across the report. For each explain who buys, what to offer, how money is earned, the first small test and the success measure. Avoid repeating the same idea in multiple sections.",
  "Connect findings to a practical fix and a business benefit: more qualified enquiries, faster follow-up, repeat sales, recurring income or lower wasted effort. Never invent missing systems, lost revenue or guaranteed returns.",
  "Prefer 3–6 ranked actions with detailed action, benefit, effort, cost, risk, dependency, owner and measurement fields. Use roles, planning estimates and testable outcomes; retain important uncertainty and source references.",
  "Include business-specific customer-service and customer-relationship improvements, product or service ideas and credible revenue opportunities. Explain who benefits, what to change, how to implement it and how to measure results; separate recommendations from verified company facts.",
  "Keep the existing required headings but make each earn its space with distinct evidence or a useful decision. Brevity never permits dropping material risks, source attribution, corrections or unknowns.",
].join("\n");

export const PUBLIC_REPORT_GUIDANCE = [
  "Prioritize a concise verdict, top fixes, credible income opportunities and measurable actions. No repeated explanations or padding.",
  "PUBLIC-SOURCE ADVISORY: The recipient may never have spoken with us. Use the company's website and retained outside public resources, not assumed access to private operations.",
  "Give our best supported opinion on income opportunities, customer relationships, website visibility and AI/agent readiness. Do not require private revenue, margins, CRM access or customer interviews to offer useful conditional recommendations.",
  "Unknown internal systems are unknown, NOT absent or defective. Suggest checking a dependency before implementation, not withholding all useful advice.",
  "Separate observed source statements, our interpretation/recommendations and planning assumptions. Do not promise revenue, rankings, AI citations or regulatory compliance.",
  "Treat llms.txt as supplementary guidance, not a universal AI-readiness certification. Assess accessible content, crawler controls, structured data, clear product/service information, contact/conversion paths and human escalation within measured scope.",
  "CUSTOMER FEEDBACK: Distinguish independently hosted customer-review opinions from company posts/profile links, directories and social mentions. Use only retrieved, business-matched samples; preserve source/date/sample and location limits. Attribute complaints, never present allegations as established failures. Connect practical strengths/limitations and proposed actions to the actual feedback when available; otherwise explicitly say customer sentiment was not assessed. An inaccessible/empty sample proves neither good nor bad service. Do not invent aggregate ratings, review counts, trends, posting activity or customer satisfaction. Google review text requires a permitted data route; do not recover excluded reviews from search snippets or other sources. Do not post replies.",
  "Never include operator notes, jury instructions, reviewer debate or compilation narration in customer prose. Preserve material uncertainty in plain language.",
].join("\n");

export const REPORT_QUALITY_INSTRUCTION = [
  PUBLIC_REPORT_GUIDANCE,
  REPORT_READER_GUIDANCE,
  "Also return actionPlan (3–6 prioritized actions) and corrections INSIDE the report object of the reply envelope.",
  "Each action: {priority:1,action,sourceIds:[\"S1\"],benefit,effort,cost,risk,dependency,owner,measurement}. All text fields are substantive strings. Effort/cost are labelled planning estimates or explicit unknowns with a practical next step, never claimed company facts.",
  "Recommendations must be grounded in at least one retained source; source IDs do not prove the proposed benefit. Use owner roles, not invented people.",
  "For every correctionChecklist item return exactly one {id,disposition:\"corrected\"|\"removed\",resolution:\"specific change and affected section\"}. Do not mark unresolved defects corrected. Reframe unverifiable diagnoses as conditional advice or remove them.",
  "Keep the main report concise and commercially useful; put the prioritized action detail in actionPlan. Do not claim the roadmap contains fields absent from actionPlan.",
].join("\n");

const PROCESS_LANGUAGE = /\b(?:VERDICT\s*:\s*(?:FIX|REJECT|ESCALATE)\b|FIX_PROPOSAL\s*:|CITATIONS\s*:\s*(?:[\[{]|S[1-9]\d*\b)|jury (?:review|verdict|requested|said|found)\b|Muse[- ]compil|operator notes\b|retained (?:source )?snapshot\b|successful votes\b)/i;

export function validateReportQuality(
  report: unknown, sourceIds: string[], checklist: ReportCorrection[], requireDetailedFormat = false,
): asserts report is ReportQuality {
  const value = report as any;
  const known = new Set(sourceIds);
  if (!Array.isArray(value?.actionPlan) || value.actionPlan.length < 3 || value.actionPlan.length > 6) {
    throw new ReportQualityError("Report actionPlan must contain 3–6 prioritized actions",
      [{ path: "report.actionPlan", code: "action_count", minimum: 3, maximum: 6 }]);
  }
  const failures: { message: string; issue: ReportQualityIssue }[] = [];
  const reject = (message: string, path: string, code: string, bounds: { minimum?: number; maximum?: number } = {}) =>
    failures.push({ message, issue: { path, code, ...bounds } });
  const fields = ["action", "benefit", "effort", "cost", "risk", "dependency", "owner", "measurement"] as const;
  for (const [index, action] of value.actionPlan.entries()) {
    const base = `report.actionPlan.${index}`;
    if (!action || action.priority !== index + 1) {
      reject("Report action priorities must be consecutive", `${base}.priority`, "priority_order");
    }
    if (!action) continue;
    for (const field of fields) {
      if (!reportActionTextSchemas[field].safeParse(action[field]).success ||
          !reportActionTextSchemas[field].safeParse(action[field].trim()).success) {
        reject(`Report action missing substantive ${field}`, `${base}.${field}`, "substantive_text_required",
          { minimum: field === "owner" ? 1 : 10, maximum: 1200 });
        continue;
      }
      if (PROCESS_LANGUAGE.test(action[field])) reject("Internal review language in report action", `${base}.${field}`, "internal_process_language");
      if (/https?:\/\//i.test(action[field])) reject("Use retained source references, not action URLs", `${base}.${field}`, "action_url_not_allowed");
      for (const match of action[field].matchAll(/\[((?:S\d+[,\s]*)+)\]/g)) {
        if ((match[1].match(/S\d+/g) || []).some((id: string) => !Array.isArray(action.sourceIds) || !action.sourceIds.includes(id))) {
          reject("Unbound action citation", `${base}.${field}`, "unbound_citation");
        }
      }
    }
    if (!Array.isArray(action.sourceIds) || !action.sourceIds.length || action.sourceIds.length > 8 ||
        action.sourceIds.some((id: unknown) => typeof id !== "string" || !known.has(id))) {
      reject("Report action needs retained source references", `${base}.sourceIds`, "retained_sources_required");
    }
  }
  if (!Array.isArray(value.corrections) || value.corrections.length !== checklist.length) {
    reject("Every report correction needs a disposition", "report.corrections", "correction_coverage");
  }
  const pending = new Set(checklist.map(item => item.id));
  for (const [index, item] of (Array.isArray(value.corrections) ? value.corrections : []).entries()) {
    if (!item || !pending.delete(item.id) || !["corrected", "removed"].includes(item.disposition) ||
        typeof item.resolution !== "string" || item.resolution.trim().length < 20 || item.resolution.length > 1500) {
      reject("Invalid, duplicate or unresolved report correction", `report.corrections.${index}`, "invalid_correction");
    }
  }
  for (const [index, section] of (value.sections ?? []).entries()) {
    if (requireDetailedFormat) {
      const blocks = section.blocks ?? [];
      if (blocks[0]?.type !== "recommendation" || !/^\s*[-•]\s+\S/m.test(blocks[0]?.text ?? "")) {
        reject("Section needs a highlighted bullet-point overview", `report.sections.${index}`, "section_overview_required");
      }
      const detail = blocks.slice(1).filter((block: any) =>
        block.type === "recommendation" && typeof block.text === "string" && block.text.trim().length >= 150);
      if (detail.length < 2) {
        reject("Section needs separate substantive analysis and implementation detail after its overview",
          `report.sections.${index}`, "section_detail_required");
      }
      if (/^executive summary$/i.test(section.heading?.trim() ?? "") &&
          (value.sections ?? []).some((other: any) => other !== section &&
            !String(blocks[0]?.text ?? "").includes(other.heading))) {
        reject("Executive overview must cover every major section", `report.sections.${index}`, "summary_section_coverage");
      }
    }
    for (const [blockIndex, block] of (section.blocks ?? []).entries()) {
      if (PROCESS_LANGUAGE.test(block.text)) reject("Internal review language in customer report",
        `report.sections.${index}.blocks.${blockIndex}.text`, "internal_process_language");
    }
  }
  if (failures.length) throw new ReportQualityError(failures.map(f => f.message).join("; "), failures.map(f => f.issue));
}

export function reportActionPlanSection(report: ReportQuality) {
  return { heading: "Prioritized Action Plan", body: "Benefits are conditional; validate them with a small pilot.\n\n" + report.actionPlan.map(item => [
    `${item.priority}. ${item.action} [${item.sourceIds.join(", ")}]`,
    `Benefit: ${item.benefit}`,
    `Suggested owner: ${item.owner} | Effort: ${item.effort} | Cost: ${item.cost}`,
    `Risk: ${item.risk} | Dependency: ${item.dependency}`,
    `Pilot measurement: ${item.measurement}`,
  ].join("\n")).join("\n\n") };
}
