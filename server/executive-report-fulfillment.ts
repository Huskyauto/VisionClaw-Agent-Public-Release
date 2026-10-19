/**
 * Executive Opportunity Report fulfillment — the "Felix executive report" as a
 * plug-and-play form deliverable.
 *
 * Models the reports Felix hand-built for Lake County Tool Works North /
 * Aldon / Eagle Management RE: a business-first opportunity audit (website
 * strengths + gaps, profitability levers, creative revenue ideas, 30/60/90
 * plan) rather than the AI-readiness-focused audit in audit-fulfillment.ts.
 *
 * Same architecture as audit-fulfillment.ts on purpose: free-tier model lane,
 * bounded-parallel section generation, CoVe verification, fail-closed quality
 * gate with one retry pass + repair-incident capture, premium styled PDF with
 * plain-renderer fallback. The website itself is fetched (SSRF-jailed, via the
 * audit engine) so findings are grounded in the REAL site, not guesses.
 */
import path from "path";
import fs from "fs";
import { getClientForModel, getModelForTierAsync } from "./providers";
import { draftWithEnsemble } from "./lib/deliverable-ensemble";
import { generateReportSection } from "./lib/report-section-generation";
import { findFailedSectionIndices, isFailedSectionBody, describeFailedSections, buildErrorPlaceholder, buildNoContentPlaceholder } from "./lib/deliverable-section-gate";
import { captureIncident } from "./agentic/repair-incident";
import { createPdf, generateStyledPdf, type PdfSection } from "./pdf-create";
import { bodyToStyledSection } from "./lib/audit-styled-sections";
import { PUBLIC_REPORT_GUIDANCE } from "./lib/business-report-quality";
import { verifyWithCoVe } from "./lib/cove-verifier";
import { runAudit } from "./audit-engine";
import type { FulfillmentResult } from "./research-report-fulfillment";
import { collectBusinessReportEvidence, renderReportEvidence } from "./lib/business-report-evidence";
import { assertBusinessReportHandoffsAllowed, enqueueBusinessReportReview, type BusinessReportReviewInput } from "./lib/business-report-review";
import { businessReportArtifactName } from "./lib/business-report-artifact";

export interface ExecReportIntake {
  /**
   * Which report variant to generate:
   * - "full" (default): the complete Executive Opportunity Report.
   * - "opportunities": the Money-Making Opportunities report — pure revenue
   *   ideas, quick wins, and growth levers, skipping the website-critique
   *   sections.
   */
  focus?: "full" | "opportunities";
  company?: string;
  website?: string;
  /** Principal / decision-maker the report is addressed to (e.g. "Mike Lannan"). */
  principalName?: string;
  principalEmail?: string;
  /** What the company does, in the operator's words. */
  description?: string;
  industry?: string;
  /** CRM / core operating platform they already run (e.g. ResMan, HubSpot). */
  crm?: string;
  phone?: string;
  notes?: string;
}

function sanitize(str: string, maxLen = 500): string {
  return String(str || "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
}

/** Same strict product-name sanitizer as audit-fulfillment (prompt-injection inert). */
function sanitizeCrmName(str: string): string {
  return String(str || "")
    .replace(/[^A-Za-z0-9 .&+\-/()']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function opportunitiesSectionPlan(intake: ExecReportIntake): { heading: string; brief: string }[] {
  const crm = intake.crm;
  return [
    { heading: "Executive Summary", brief: "Give a highlighted bullet-point overview of the major sections, the supported commercial bottom line, the top priorities and the first move this week. Introduce the detailed opportunity assessment; do not replace it with a short paragraph. No invented lost revenue." },
    { heading: "Where the Money Is Today", brief: "Two or three observed offerings and their likely commercial role. Separate known offerings from unknown revenue/margin performance; identify one area worth testing rather than claiming it already outperforms." },
    { heading: "Quick-Win Revenue Moves", brief: "At most two practical improvements to existing sales within 30 days. State the move, how it could earn more, who acts and what pilot result would justify expanding. No new hires or large builds assumed." },
    { heading: "Creative & Profitable Growth Ideas", brief: "At most three genuinely distinct, business-specific income opportunities. Each: target buyer, offer, payment mechanism, first small test and success measure. Prefer a few credible opportunities over a long speculative list. Do not repeat quick wins." },
    { heading: "Ancillary Revenue Opportunities", brief: "At most two optional add-ons, only if credible for this operation. Name buyer, offer, how payment works and a cheap demand test. Do not invent additional ideas to fill space; state when none are supported." },
    {
      heading: "Partnerships, Pricing & Channel Levers",
      brief: crm
        ? `At most two ways partnerships, pricing or channels could support the selected growth bets. The intake reports ${crm}; verify relevant capabilities before suggesting configuration. Prefer its existing workflows; do not recommend replacing it. No repeated opportunity descriptions.`
        : "At most two partnership, pricing or channel levers supporting the selected opportunities. State a practical first test; do not assume internal systems are absent or repeat opportunity descriptions.",
    },
    { heading: "Closing Recommendation", brief: "One sentence naming the first move and why it comes first; then at most three decision-changing unknowns with a practical way to check them. Do not repeat the summary or action plan." },
  ];
}

function sectionPlan(intake: ExecReportIntake): { heading: string; brief: string }[] {
  if (intake.focus === "opportunities") return opportunitiesSectionPlan(intake);
  const crm = intake.crm;
  return [
    { heading: "Executive Summary", brief: "Give a highlighted bullet-point overview of every major report section, the supported bottom line, top priorities and first move this week. Introduce the detailed report and business opportunities without claiming unmeasured lost sales or failed operations." },
    { heading: "What the Company Does", brief: "Two or three source-supported offerings or differentiators and why they matter commercially. No brochure rewrite, full company history or assumed revenue mix." },
    { heading: "Current Website Strengths", brief: "Two or three observed strengths worth retaining and their likely sales benefit. Attribute claims to their sources; no generic praise." },
    { heading: "Highest-Priority Website Findings", brief: "At most three supported issues in priority order. Each: observation, likely business impact and practical fix. Label untested concerns as checks; never invent failures or quantify lost sales without evidence." },
    { heading: "Website & Sales Improvements", brief: "Two or three concrete fixes linked to the findings, with the first step and success measure. Prioritize useful enquiries, follow-up and conversion over cosmetic changes; avoid repeating the full findings." },
    {
      heading: crm ? `${crm}-Aligned Operating Opportunities` : "Operating System & Lead-Handling Opportunities",
      brief: crm
        ? `The intake reports ${crm}. Suggest at most two follow-up or reporting improvements using it, conditional on verifying the relevant features and current setup. State a pilot measure. Do not recommend replacement or pretend configuration was inspected.`
        : "The CRM and current workflows are unknown, not absent. Recommend checking who handles enquiries, response time and follow-up. Give at most two conditional improvements using existing tools first, with a clear pilot measure. No unsupported lost-revenue claim.",
    },
    { heading: "Creative & Profitable Growth Ideas", brief: "At most three distinct, business-specific income opportunities. Each: target buyer, offer, how payment works, cheap first test and success measure. Explain the income mechanism, not generic marketing advice or invented returns." },
    { heading: "Ancillary Revenue Opportunities", brief: "At most two optional, realistic add-ons not already described. Include buyer, offer, payment mechanism and a small demand test; do not force ideas unsupported by the business model." },
    { heading: "Closing Recommendation", brief: "One sentence naming the first action and why; then at most three decision-changing unknowns and how to check them. Do not restate the full summary or roadmap." },
  ];
}

/**
 * Ground the report in the REAL website: run the deterministic audit engine
 * (SSRF-jailed fetch) and distill what it saw into an evidence block for the
 * prompts. Fail-soft — a fetch failure degrades to intake-only guidance and
 * is disclosed to the model so it hedges appropriately.
 */
async function buildSiteEvidence(website: string | undefined): Promise<string> {
  if (!website) return "WEBSITE EVIDENCE: no website provided — base findings on the intake description and industry best practice, clearly framed as such.";
  try {
    const audit = await runAudit(website);
    const lines: string[] = [
      `WEBSITE EVIDENCE (fetched live from ${audit.finalUrl}; overall technical score ${audit.overallScore}/100, grade ${audit.grade}):`,
    ];
    for (const c of audit.checks) {
      lines.push(`- [${c.status.toUpperCase()}] ${c.label}: ${sanitize(c.detail, 220)}`);
    }
    if (audit.recommendations.length) {
      lines.push(`Top technical fixes already identified: ${audit.recommendations.slice(0, 5).map((r) => sanitize(r, 160)).join("; ")}`);
    }
    lines.push("Treat the [FAIL]/[WARN] items as verified findings. Anything beyond them about page content is inference — frame it as 'likely' unless the evidence above supports it.");
    return lines.join("\n").slice(0, 4000);
  } catch (e: any) {
    console.warn(`[exec-report] direct website audit failed (${e?.message}) — trying the multi-avenue fetch ladder`);
    // Fallback avenue: the web_fetch extraction ladder (local extractor →
    // Jina reader → Firecrawl → basic HTML). Different transports/providers
    // than the direct audit fetch, so a rate limit or bot block on the direct
    // route doesn't leave the report ungrounded. Fail-soft to intake-only.
    try {
      const { webFetch } = await import("./tools/domains/web/handlers");
      const fetched: any = await webFetch(website);
      const content = typeof fetched?.content === "string" ? fetched.content.trim() : "";
      if (fetched?.success && content.length >= 300) {
        return [
          `WEBSITE EVIDENCE (content-only view of ${website} via a fallback fetch route; technical header/file checks were unavailable):`,
          sanitize(content, 3500),
          "This is the page's visible content. Statements about site content grounded in it are verified; technical claims (headers, llms.txt, sitemap, performance) were NOT measured — frame those as 'worth confirming'.",
        ].join("\n").slice(0, 4000);
      }
    } catch (fallbackErr: any) {
      console.warn(`[exec-report] fallback fetch ladder also failed (non-fatal): ${fallbackErr?.message}`);
    }
    return `WEBSITE EVIDENCE: the site could not be fetched for live review (${sanitize(String(e?.message || "fetch failed"), 120)}). Base findings on the intake description and industry best practice, and clearly frame site-specific statements as unverified.`;
  }
}

function buildSystemPrompt(): string {
  return [
    "You are a senior revenue and positioning consultant writing a paid executive opportunity report for a business owner.",
    "Output ONLY the body text for the requested section — no heading, no preface, no meta commentary.",
    "Write like a sharp operator talking to a peer: direct, specific, business-outcome language. Money, leads, margin, conversion — not technology for its own sake.",
    "Ground every claim in the provided evidence and intake. Where you must generalize, frame it as 'likely' or industry best practice — never fabricate specifics about the business.",
    "Use plain prose with short paragraphs and '-' bullet lists where the section brief asks for them. Short 'Title:' lines may introduce grouped ideas. No markdown headings, no bold markers.",
    "Begin with highlighted overview bullets, then give detailed analysis and practical implementation guidance. Explain what to improve, why it helps the business and its customers, how to test product or revenue ideas, and what dependencies, costs, risks and measures matter. Do not impose an arbitrary short-section word limit or replace detail with bullets. Preserve useful evidence and material uncertainty, not filler.",
  ].join("\n");
}

function intakeBlock(intake: ExecReportIntake): string {
  return [
    `BUSINESS: ${intake.company || "(name not provided)"}`,
    intake.website ? `WEBSITE: ${intake.website}` : "",
    intake.principalName ? `PREPARED FOR (PRINCIPAL): ${intake.principalName}` : "",
    intake.industry ? `INDUSTRY: ${intake.industry}` : "",
    intake.description ? `SUPPLIED BUSINESS DESCRIPTION (not independently verified): ${intake.description}` : "",
    intake.crm ? `REPORTED CRM / CORE PLATFORM (unverified context): ${intake.crm}` : "CRM / CORE PLATFORM: unknown; do not infer absence",
    intake.notes ? `OPERATOR NOTES: ${intake.notes}` : "",
  ].filter(Boolean).join("\n");
}

function buildSectionPrompt(intake: ExecReportIntake, evidence: string, section: { heading: string; brief: string }): string {
  return [
    intakeBlock(intake),
    "",
    evidence,
    "",
    `SECTION TO WRITE: "${section.heading}"`,
    `WHAT THIS SECTION MUST COVER: ${section.brief}`,
    PUBLIC_REPORT_GUIDANCE,
    "",
    "Write the section now.",
  ].join("\n");
}

async function generateSection(modelId: string, tenantId: number, intake: ExecReportIntake, evidence: string, section: { heading: string; brief: string }, freeResearch = false): Promise<string> {
  try {
    // Premium ensemble lane: 3 cheap-frontier drafts in parallel + a 4th
    // model's final redraft. Fail-open — null means use the single-model path.
    const ensemble = freeResearch ? null : await draftWithEnsemble({
      tenantId,
      system: buildSystemPrompt(),
      user: buildSectionPrompt(intake, evidence, section),
      temperature: 0.5,
      maxTokens: 1200,
      label: `exec:${section.heading}`,
      sourceEvidence: evidence.trim() ? [{
        id: "executive-context", title: "Upstream executive-report source context",
        text: evidence, tenantId, provenance: "retrieved_context",
      }] : [],
    });
    if (ensemble?.text) return ensemble.text;
    if (freeResearch) return await generateReportSection({ modelId, tenantId, messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildSectionPrompt(intake, evidence, section) },
    ] });
    const { client, actualModelId } = await getClientForModel(modelId, tenantId, { forbidMeteredFallback: freeResearch });
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildSectionPrompt(intake, evidence, section) },
      ],
      temperature: 0.5,
      max_tokens: 1200,
    } as any);
    const text = (result as any)?.choices?.[0]?.message?.content?.toString().trim() || "";
    if (!text) return buildNoContentPlaceholder();
    return text;
  } catch (err: any) {
    console.warn(`[exec-report] Section "${section.heading}" failed: ${err.message}`);
    return buildErrorPlaceholder(err?.message, "report");
  }
}

/**
 * Generic fail-soft JSON-rows table generator (same contract philosophy as
 * the audit scorecard: malformed/undersized output ⇒ table omitted, never a
 * broken table shipped).
 */
function parseJsonRows(text: string, keys: string[], minRows: number, maxRows: number, lastColEnum?: string[], firstColSequence?: string[]): string[][] | null {
  const jsonText = String(text || "").replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  const start = jsonText.indexOf("[");
  const end = jsonText.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let rows: any;
  try { rows = JSON.parse(jsonText.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const clean = rows
    .filter((r: any) => r && typeof r === "object" && keys.every((k) => typeof r[k] === "string" && r[k].trim()))
    .slice(0, maxRows)
    .map((r: any) => keys.map((k, i) => {
      const v = String(r[k]).slice(0, i === 0 ? 60 : 200);
      if (lastColEnum && i === keys.length - 1) return lastColEnum.includes(String(r[k])) ? String(r[k]) : lastColEnum[Math.floor(lastColEnum.length / 2)];
      return v;
    }));
  if (clean.length < minRows) return null;
  // Fixed-sequence tables (e.g. the 30/60/90 plan) must contain EXACTLY the
  // promised first-column values in order — anything else ⇒ omit the table
  // rather than ship a malformed "authoritative" plan.
  if (firstColSequence) {
    if (clean.length !== firstColSequence.length) return null;
    for (let i = 0; i < firstColSequence.length; i++) {
      if (clean[i][0] !== firstColSequence[i]) return null;
    }
  }
  return clean;
}

async function generateTable(params: {
  modelId: string; tenantId: number; intake: ExecReportIntake; digest: string;
  title: string; instruction: string; keys: string[]; headers: string[];
  minRows: number; maxRows: number; lastColEnum?: string[]; firstColSequence?: string[];
}): Promise<PdfSection | null> {
  try {
    const { client, actualModelId } = await getClientForModel(params.modelId, params.tenantId);
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: `You distill an executive opportunity report into a boardroom table. Output ONLY a JSON array (no prose, no code fence) of ${params.minRows}-${params.maxRows} objects with keys: ${params.keys.join(", ")}. ${params.instruction}` },
        { role: "user", content: `BUSINESS: ${params.intake.company || "(not provided)"}${params.intake.industry ? `\nINDUSTRY: ${params.intake.industry}` : ""}\n\nREPORT SECTIONS:\n${params.digest}\n\nProduce the JSON array now.` },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    } as any);
    const text = (result as any)?.choices?.[0]?.message?.content?.toString().trim() || "";
    const rows = parseJsonRows(text, params.keys, params.minRows, params.maxRows, params.lastColEnum, params.firstColSequence);
    if (!rows) return null;
    return { title: params.title, table: { headers: params.headers, rows } };
  } catch (e: any) {
    console.warn(`[exec-report] table "${params.title}" generation failed (non-fatal): ${e?.message || e}`);
    return null;
  }
}

export async function fulfillExecutiveReport(params: {
  intake: ExecReportIntake;
  customerEmail: string;
  orderId: string;
  tenantId?: number;
  deliveryContext?: import("./research-report-fulfillment").DelayedReportDeliveryContext;
  operatorJobId?: string;
  paidJuryBatch?: string;
  reportOnly?: boolean;
  /** Server-owned immutable research, never populated from a request body. */
  sharedEvidence?: import("./lib/business-report-evidence").ReportEvidence;
}): Promise<FulfillmentResult> {
  // Fail-closed tenant resolution — same contract as fulfillReadinessAudit.
  if (!Number.isInteger(params.tenantId) || (params.tenantId as number) <= 0) {
    throw new Error("fulfillExecutiveReport: a valid positive tenantId is required (no default)");
  }
  const tenantId: number = params.tenantId as number;
  await assertBusinessReportHandoffsAllowed(tenantId);
  const intake: ExecReportIntake = {
    company: params.intake.company ? sanitize(params.intake.company, 200) : undefined,
    website: params.intake.website ? sanitize(params.intake.website, 300) : undefined,
    principalName: params.intake.principalName ? sanitize(params.intake.principalName, 120) : undefined,
    principalEmail: params.intake.principalEmail ? sanitize(params.intake.principalEmail, 320) : undefined,
    description: params.intake.description ? sanitize(params.intake.description, 800) : undefined,
    industry: params.intake.industry ? sanitize(params.intake.industry, 200) : undefined,
    crm: params.intake.crm ? (sanitizeCrmName(params.intake.crm) || undefined) : undefined,
    phone: params.intake.phone ? sanitize(params.intake.phone, 40) : undefined,
    notes: params.intake.notes ? sanitize(params.intake.notes, 500) : undefined,
    focus: params.intake.focus === "opportunities" ? "opportunities" : "full",
  };
  const isOpportunities = intake.focus === "opportunities";
  const reportLabel = isOpportunities ? "Money-Making Opportunities Report" : "Executive Opportunity Report";

  const modelId = await getModelForTierAsync("powerful", tenantId, { freeTierOnly: true });
  const plan = sectionPlan(intake);
  console.log(`[exec-report] Order ${params.orderId} — using model ${modelId} for ${plan.length} sections`);

  // Live-site grounding first (one fetch, shared by every section prompt).
  if (params.paidJuryBatch) {
    const { assertReportJuryApproval } = await import("./lib/business-report-paid-budget");
    assertReportJuryApproval({ tenantId, kind: "executive", intake: intake as Record<string, unknown>,
      paidJuryBatch: params.paidJuryBatch, operatorJobId: params.operatorJobId });
  }
  let sourceSnapshot = params.sharedEvidence ?? await collectBusinessReportEvidence(intake as Record<string, unknown>,
    { allowPaidExtraction: !params.paidJuryBatch });
  if (params.paidJuryBatch) {
    const { classifyReportResearch } = await import("./lib/report-research-preparation");
    sourceSnapshot = await classifyReportResearch(sourceSnapshot);
  }
  const evidence = renderReportEvidence(sourceSnapshot);

  const SECTION_CONCURRENCY = 3;
  const sections: { heading: string; body: string }[] = new Array(plan.length);
  let nextIdx = 0;
  async function sectionWorker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= plan.length) return;
      const s = plan[i];
      const body = await generateSection(modelId, tenantId, intake, evidence, s, !!params.paidJuryBatch || !!params.sharedEvidence);
      let finalBody = body;
      if (!params.paidJuryBatch && !params.sharedEvidence && body && body.length >= 200 && !body.startsWith("(")) {
        try {
          const cove = await verifyWithCoVe({
            draft: body,
            topic: `executive opportunity report${intake.industry ? ` for ${intake.industry}` : ""} — section: ${s.heading}`,
            tenantId,
            maxQuestions: 6,
            modelTier: "balanced",
          });
          if (!cove.unchanged && cove.revised) finalBody = cove.revised;
        } catch (e: any) {
          console.warn(`[exec-report] CoVe error on "${s.heading}" (ignored): ${e?.message || String(e)}`);
        }
      }
      sections[i] = { heading: s.heading, body: finalBody };
    }
  }
  await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, plan.length) }, () => sectionWorker()));

  // Fail-closed quality gate: one retry pass, then refuse + incident capture.
  let failed = findFailedSectionIndices(sections.map((s) => s?.body));
  if (failed.length > 0) {
    console.warn(`[exec-report] Order ${params.orderId} — retrying ${failed.length} failed section(s): ${failed.map((i) => plan[i].heading).join(", ")}`);
    for (const i of failed) {
      const body = await generateSection(modelId, tenantId, intake, evidence, plan[i], !!params.paidJuryBatch || !!params.sharedEvidence);
      if (!isFailedSectionBody(body)) sections[i] = { heading: plan[i].heading, body };
    }
    failed = findFailedSectionIndices(sections.map((s) => s?.body));
  }
  if (failed.length > 0) {
    const summary = describeFailedSections(plan.map((s) => s.heading), failed, plan.length);
    const firstBody = (sections[failed[0]]?.body || "").slice(0, 300);
    console.error(`[exec-report] Order ${params.orderId} — QUALITY GATE FAILED after retry: ${summary}. Refusing to ship.`);
    Promise.resolve(
      captureIncident({
        tenantId,
        source: "felix_deliverable",
        title: `exec-report ${params.orderId}: ${summary}`.slice(0, 200),
        signature: "exec_report_sections_failed_after_retry",
        error: `${summary}. First placeholder: ${firstBody}`,
        stage: "exec-report-fulfillment",
        candidateFiles: ["server/executive-report-fulfillment.ts", "server/lib/param-adaptation.ts", "server/providers.ts"],
        felixFailureKind: "verify_failed",
        metadata: { orderId: params.orderId, modelId, failedHeadings: failed.map((i) => plan[i].heading) },
      }),
    ).catch((e: any) => console.warn(`[exec-report] incident capture failed (non-fatal): ${e?.message || e}`));
    return {
      success: false,
      error: `Report generation failed quality gate: ${summary}. The PDF was NOT sent to the customer. The self-repair system has been notified; regenerate after the underlying issue is fixed.`,
      modelUsed: modelId,
    };
  }

  return enqueueBusinessReportReview({ tenantId, kind: "executive", intake, modelId, evidence: sourceSnapshot,
    sections, orderId: params.orderId, customerEmail: params.customerEmail, deliveryContext: params.deliveryContext,
    operatorJobId: params.operatorJobId, paidJuryBatch: params.paidJuryBatch, reportOnly: params.reportOnly });
}

export async function finalizePreparedExecutiveReport(params: BusinessReportReviewInput): Promise<FulfillmentResult> {
  const { tenantId, intake, modelId, sections } = params;
  const isOpportunities = intake.focus === "opportunities";
  const reportLabel = isOpportunities ? "Money-Making Opportunities Report" : "Executive Opportunity Report";
  const generatedAt = params.evidence.capturedAt.slice(0, 10);
  const gapsTable: PdfSection | null = null;
  const growthTable: PdfSection | null = null;
  const planTable: PdfSection | null = null;

  const introBody = [
    `Prepared for ${intake.principalName || intake.company || params.customerEmail}`,
    intake.company ? `Company: ${intake.company}` : "",
    intake.website ? `Website: ${intake.website}` : "",
    intake.industry ? `Industry: ${intake.industry}` : "",
    `Order: ${params.orderId}`,
    `Generated: ${generatedAt}`,
    "",
    isOpportunities
      ? "This Money-Making Opportunities Report was researched and written by the VisionClaw Agent platform. It reviews the company's public web presence and positioning, then lays out concrete revenue quick wins, creative growth ideas, and pricing & partnership levers. Treat vendor and pricing references as starting points — verify current terms before purchasing."
      : "This Executive Opportunity Report was researched and written by the VisionClaw Agent platform. It reviews the company's public web presence and positioning, then lays out concrete profitability, conversion, and growth moves. Treat vendor and pricing references as starting points — verify current terms before purchasing.",
  ].filter(Boolean).join("\n");
  const disclaimerBody = "This report was generated by an AI analysis pipeline using publicly available information and the intake provided. While every reasonable effort has been made to ensure accuracy, it may contain errors or outdated facts. Verify all material claims before relying on them for legal, financial, or other consequential decisions. [Your Company] and the VisionClaw Agent platform make no warranty of accuracy and are not liable for decisions made on the basis of this report.";

  const finalSections = [
    { heading: "About This Report", body: introBody },
    ...sections,
    { heading: "Disclaimer", body: disclaimerBody },
  ];

  const fileName = businessReportArtifactName(params, sections);
  const outputPath = path.join("uploads", fileName);

  let finalRelPath: string | undefined;
  let pages: number | undefined;
  try {
    const styledSections: PdfSection[] = [
      { title: "About This Report", paragraphs: introBody.split("\n").filter(Boolean) },
      ...sections.map((s) => bodyToStyledSection(s.heading, s.body)),
      { title: "Disclaimer", content: disclaimerBody },
    ];
    // Weave the tables into their natural narrative slots (indices are into
    // styledSections: 0 = About, 1 = Exec Summary, then the prose plan order).
    // Insert from the back so earlier indices stay valid.
    if (planTable) styledSections.splice(styledSections.length - 2, 0, planTable); // before Closing Recommendation
    if (isOpportunities) {
      if (growthTable) styledSections.splice(2, 0, growthTable); // right after Executive Summary
    } else {
      if (growthTable) styledSections.splice(5, 0, growthTable);  // after Highest-Priority Findings (index 4), before Website & Sales Improvements
      if (gapsTable) styledSections.splice(2, 0, gapsTable);      // right after Executive Summary
    }
    const coverStats = [
      intake.industry
        ? { label: "Business Focus", value: intake.industry.slice(0, 26) }
        : { label: "Scope", value: isOpportunities ? "Revenue Growth" : "Website + Revenue" },
      intake.crm
        ? { label: "Core Platform", value: intake.crm.slice(0, 24) }
        : { label: "Action Roadmap", value: "30/60/90 Days" },
      { label: "Profit Focus", value: "Leads · Conversion · Margin" },
    ];
    const { readableBusinessReportSections } = await import("./lib/business-report-readable");
    const styled = await generateStyledPdf({
      title: isOpportunities
        ? `${intake.company ? `${intake.company} — ` : ""}Money-Making Opportunities`
        : `${intake.company || "Executive"} Opportunity Report`,
      subtitle: isOpportunities
        ? "Revenue Quick Wins, Creative Growth Ideas, and Pricing & Partnership Levers"
        : "Website Positioning, Profitability Levers, and Growth Recommendations",
      companyLines: [
        `Prepared for ${intake.principalName || intake.company || params.customerEmail}`,
        intake.company && intake.principalName ? intake.company : "",
        intake.description ? intake.description.slice(0, 110) : "",
        `Generated ${generatedAt}`,
        intake.phone ? `Ph. ${intake.phone}` : "",
      ].filter(Boolean),
      coverStats,
      sections: readableBusinessReportSections(finalSections, isOpportunities ? "opportunities" : "executive"),
      readableBody: true,
      footerLines: [`${reportLabel} — prepared by the VisionClaw Agent platform`],
      fileName: fileName.replace(/\.pdf$/, ""),
      uploadToDrive: false, // the delivery pipeline owns Drive upload + customer links
      tenantId,
    });
    if (styled.success && styled.localPath) {
      const rel = styled.localPath.replace(/^\//, "");
      if (fs.existsSync(path.join(process.cwd(), rel))) {
        finalRelPath = rel;
        console.log(`[exec-report] Order ${params.orderId} — premium styled PDF ready at ${rel} (${styled.size} bytes)`);
      }
    } else {
      console.warn(`[exec-report] styled PDF failed (${styled.error}) — falling back to plain renderer`);
    }
  } catch (e: any) {
    console.warn(`[exec-report] styled PDF threw (${e?.message || e}) — falling back to plain renderer`);
  }

  if (!finalRelPath) {
    const { plainReadableBusinessReportSections } = await import("./lib/business-report-readable");
    const pdfResult = await createPdf({
      title: `${reportLabel}${intake.company ? `: ${intake.company.slice(0, 60)}` : ""}`,
      sections: plainReadableBusinessReportSections(finalSections, isOpportunities ? "opportunities" : "executive"),
      fontSize: 11,
      pageSize: "letter",
      outputPath,
      customerName: params.customerEmail,
      tenantId,
    } as any);
    if (!pdfResult.success || !pdfResult.path) {
      return { success: false, error: pdfResult.error || "PDF generation failed", modelUsed: modelId };
    }
    const absPath = pdfResult.path;
    const relPath = path.relative(process.cwd(), absPath);
    finalRelPath = relPath.startsWith("..") ? outputPath : relPath;
    pages = pdfResult.pages;
    if (!fs.existsSync(absPath)) {
      return { success: false, error: `PDF was reported as written but not found on disk: ${absPath}`, modelUsed: modelId };
    }
  }

  const deliveredFileName = path.basename(finalRelPath);
  const { completeBusinessReportAudio } = await import("./lib/business-report-audio-delivery");
  const audio = await completeBusinessReportAudio(params,
    `${reportLabel} for ${intake.company || "your company"}`, finalSections, finalRelPath);
  pages = audio.pages;
  finalSections.unshift({ heading: "Listen to this report", body: "One American-English MP3 covers this complete report. Use the listening link in the PDF; source quotations and citation codes are written-only." });
  console.log(`[exec-report] Order ${params.orderId} — PDF ready at ${finalRelPath}${pages ? ` (${pages} pages)` : ""}`);
  return { success: true, filePath: finalRelPath, fileName: deliveredFileName, pages, modelUsed: modelId,
    audio: { viewUrl: audio.viewUrl, tracks: audio.tracks }, sections: finalSections };
}
