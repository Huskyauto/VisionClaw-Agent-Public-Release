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
import { findFailedSectionIndices, isFailedSectionBody, describeFailedSections, buildErrorPlaceholder, buildNoContentPlaceholder } from "./lib/deliverable-section-gate";
import { captureIncident } from "./agentic/repair-incident";
import { createPdf, generateStyledPdf, type PdfSection } from "./pdf-create";
import { bodyToStyledSection } from "./lib/audit-styled-sections";
import { verifyWithCoVe } from "./lib/cove-verifier";
import { runAudit } from "./audit-engine";
import type { FulfillmentResult } from "./research-report-fulfillment";

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
    { heading: "Executive Summary", brief: "Open with one 'blunt take' sentence about this business's single biggest untapped revenue opportunity (it becomes the highlight box). Then 2-3 paragraphs: what the business credibly is, where money is being left on the table today, and the 2-3 highest-upside moves. Money, leads, margin — no website critique, no tech jargon." },
    { heading: "Where the Money Is Today", brief: "5-8 '-' bullets: the current offerings and revenue streams as observed from the website and description, each with a clause on its commercial role (volume driver, margin driver, door-opener). End with one bullet naming which existing stream has the most headroom and why." },
    { heading: "Quick-Win Revenue Moves", brief: "6-8 '-' bullets of moves that can produce revenue within 30 days with the assets the business already has: reactivation campaigns, bundling, pricing tweaks, follow-up sequences, referral asks, upsell scripts. Each bullet: the move, then the revenue logic in one clause. Concrete and immediately actionable — nothing that requires new hires or big builds." },
    { heading: "Creative & Profitable Growth Ideas", brief: "The signature section: 6-9 creative, specific revenue ideas for THIS business type — each as a short bold-style title line ending with a colon, then 1-2 sentences of mechanics and revenue logic. Think partnerships, packaging, cross-sell paths, waitlists/pre-commitment capture, referral engines, seasonal campaigns, premium tiers, service add-ons — whatever genuinely fits. No generic 'do social media' filler." },
    { heading: "Ancillary Revenue Opportunities", brief: "5-8 '-' bullets of add-on revenue streams appropriate to this business model. Open with one sentence noting that not every idea fits every operation but modest add-ons compound. Skip anything implausible for this industry." },
    {
      heading: "Partnerships, Pricing & Channel Levers",
      brief: crm
        ? `Bigger structural levers: strategic partnerships worth pursuing, pricing/packaging restructures (tiers, minimums, retainers), and new channels. This business runs ${crm} — where relevant, name how ${crm} supports a lever (automations, segmentation, reporting). 6-8 '-' bullets, each with the revenue logic. Never recommend replacing ${crm}.`
        : "Bigger structural levers: strategic partnerships worth pursuing, pricing/packaging restructures (tiers, minimums, retainers), and new channels appropriate to this business size. 6-8 '-' bullets, each with the revenue logic.",
    },
    { heading: "Closing Recommendation", brief: "2 short paragraphs: the ONE money-making move to start this week and why it comes first, then the plain-English priority order for the rest. End with a section titled 'Known Unknowns:' followed by 4-6 '-' bullets of internal data that was NOT available and would sharpen the revenue analysis (close rates, margins, repeat rates, lead volume — whatever fits). Honest, confident, no hedging filler." },
  ];
}

function sectionPlan(intake: ExecReportIntake): { heading: string; brief: string }[] {
  if (intake.focus === "opportunities") return opportunitiesSectionPlan(intake);
  const crm = intake.crm;
  return [
    { heading: "Executive Summary", brief: "Open with one 'blunt take' sentence a busy owner will remember (it becomes the highlight box). Then 2-3 paragraphs: what the business credibly is, whether the website works as a sales system or just a brochure, the 2-3 highest-impact issues, and where the strongest upside is. Business outcomes, not tech jargon." },
    { heading: "What the Company Does", brief: "6-9 '-' bullets restating the company's offerings and positioning as observed from the website and provided description. Each bullet: offering name then a clause on why it matters commercially. End with one bullet naming the trust signals or differentiators that elevate them above commodity competitors (certifications, portfolio scale, tenure — whatever applies)." },
    { heading: "Current Website Strengths", brief: "5-7 '-' bullets: what the website already does well for credibility and conversion. Be honest and specific to what was actually observed — this is the 'positives' section." },
    { heading: "Highest-Priority Website Findings", brief: "The 'negatives': the most serious website problems in priority order, framed as executive issues with business impact (lead leakage, wasted traffic, price-comparison framing, missing conversion paths — whatever the evidence supports). For each: what was observed, why it costs money, what to do. If a finding is severe, say so plainly. Never invent problems the evidence doesn't support — frame unverified items as 'likely' or 'worth confirming'." },
    { heading: "Website & Sales Improvements", brief: "6-8 '-' bullets of concrete improvements in priority order: messaging repositioning, proof/trust content, conversion paths and CTAs, industry/segment pages, lead capture, sales language. Conversion infrastructure before cosmetic polish." },
    {
      heading: crm ? `${crm}-Aligned Operating Opportunities` : "Operating System & Lead-Handling Opportunities",
      brief: crm
        ? `This business already runs ${crm}. 6-8 '-' bullets on operating harder off that existing stack — name specific ${crm} features, automations, reporting, and integrations. Open with the framing that the opportunity is NOT to replace ${crm}. Never recommend a competing platform.`
        : "No CRM/system of record was reported. Explain what that costs them (leads, follow-up, repeat business), recommend 2-3 candidate systems by name appropriate to this business size, and 4-5 workflows to run on it from day one.",
    },
    { heading: "Creative & Profitable Growth Ideas", brief: "The signature section: 6-9 creative, specific revenue ideas for THIS business type — each as a short bold-style title line ending with a colon, then 1-2 sentences of mechanics and revenue logic. Think partnerships, packaging, cross-sell paths, waitlists/pre-commitment capture, referral engines, seasonal campaigns, premium tiers, service add-ons — whatever genuinely fits. No generic 'do social media' filler." },
    { heading: "Ancillary Revenue Opportunities", brief: "5-8 '-' bullets of add-on revenue streams appropriate to this business model. Open with one sentence noting that not every idea fits every operation but modest add-ons compound. Skip anything implausible for this industry." },
    { heading: "Closing Recommendation", brief: "2 short paragraphs: the single repositioning or fix that matters most, then the plain-English 'do this first, then this' executive priority order. End with a section titled 'Known Unknowns:' followed by 4-6 '-' bullets of internal data that was NOT available and would sharpen the analysis (occupancy, close rates, margins, lead volume — whatever fits). Honest, confident, no hedging filler." },
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
    "Aim for ~250-450 words per section unless brevity serves the reader better.",
  ].join("\n");
}

function intakeBlock(intake: ExecReportIntake): string {
  return [
    `BUSINESS: ${intake.company || "(name not provided)"}`,
    intake.website ? `WEBSITE: ${intake.website}` : "",
    intake.principalName ? `PREPARED FOR (PRINCIPAL): ${intake.principalName}` : "",
    intake.industry ? `INDUSTRY: ${intake.industry}` : "",
    intake.description ? `WHAT THE COMPANY DOES (owner's words): ${intake.description}` : "",
    intake.crm ? `EXISTING CRM / CORE PLATFORM: ${intake.crm}` : "EXISTING CRM / CORE PLATFORM: none reported",
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
    "",
    "Write the section now.",
  ].join("\n");
}

async function generateSection(modelId: string, tenantId: number, intake: ExecReportIntake, evidence: string, section: { heading: string; brief: string }): Promise<string> {
  try {
    // Premium ensemble lane: 3 cheap-frontier drafts in parallel + a 4th
    // model's final redraft. Fail-open — null means use the single-model path.
    const ensemble = await draftWithEnsemble({
      tenantId,
      system: buildSystemPrompt(),
      user: buildSectionPrompt(intake, evidence, section),
      temperature: 0.5,
      maxTokens: 1200,
      label: `exec:${section.heading}`,
    });
    if (ensemble?.text) return ensemble.text;
    const { client, actualModelId } = await getClientForModel(modelId, tenantId);
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
}): Promise<FulfillmentResult> {
  // Fail-closed tenant resolution — same contract as fulfillReadinessAudit.
  if (!Number.isInteger(params.tenantId) || (params.tenantId as number) <= 0) {
    throw new Error("fulfillExecutiveReport: a valid positive tenantId is required (no default)");
  }
  const tenantId: number = params.tenantId as number;
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
  const evidence = await buildSiteEvidence(intake.website);

  const SECTION_CONCURRENCY = 3;
  const sections: { heading: string; body: string }[] = new Array(plan.length);
  let nextIdx = 0;
  async function sectionWorker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= plan.length) return;
      const s = plan[i];
      const body = await generateSection(modelId, tenantId, intake, evidence, s);
      let finalBody = body;
      if (body && body.length >= 200 && !body.startsWith("(")) {
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
      const body = await generateSection(modelId, tenantId, intake, evidence, plan[i]);
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

  const generatedAt = new Date().toISOString().slice(0, 10);
  const digest = sections.map((s) => `## ${s.heading}\n${s.body.slice(0, 900)}`).join("\n\n").slice(0, 9000);

  // Boardroom tables (all fail-soft — omitted on any parse/LLM failure).
  // The opportunities variant skips the gaps/margin-leakage table — it's a
  // pure revenue-ideas report, not a critique.
  const [gapsTable, growthTable, planTable] = await Promise.all([
    isOpportunities ? Promise.resolve(null) : generateTable({
      modelId, tenantId, intake, digest,
      title: "Profitability Gaps & Margin Leakage",
      instruction: "gap = the weakness (under 6 words); why = why it costs money (under 18 words); fix = the recommended fix (under 18 words); impact is exactly one of: High, Medium, Low.",
      keys: ["gap", "why", "fix", "impact"],
      headers: ["Gap", "Why It Hurts", "Recommended Fix", "Impact"],
      minRows: 5, maxRows: 7, lastColEnum: ["High", "Medium", "Low"],
    }),
    generateTable({
      modelId, tenantId, intake, digest,
      title: "Revenue Growth Opportunities",
      instruction: "opportunity = short name (under 5 words); description = what to do (under 18 words); logic = the revenue logic (under 16 words); priority is exactly one of: High, Medium, Low.",
      keys: ["opportunity", "description", "logic", "priority"],
      headers: ["Opportunity", "Description", "Revenue Logic", "Priority"],
      minRows: 5, maxRows: 7, lastColEnum: ["High", "Medium", "Low"],
    }),
    generateTable({
      modelId, tenantId, intake, digest,
      title: "30 / 60 / 90 Day Action Plan",
      instruction: 'window is exactly one of: "First 30 Days", "Days 31-60", "Days 61-90" (one row each, in that order); actions = the priority actions for that window (under 30 words); outcome = the business outcome (under 12 words).',
      keys: ["window", "actions", "outcome"],
      headers: ["Window", "Priority Actions", "Outcome"],
      minRows: 3, maxRows: 3,
      firstColSequence: ["First 30 Days", "Days 31-60", "Days 61-90"],
    }),
  ]);

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

  const safeName = (intake.company || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "business";
  const fileName = `${isOpportunities ? "money-making-opportunities-report" : "executive-opportunity-report"}-${safeName}-${Date.now()}.pdf`;
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
      sections: styledSections,
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
    const pdfResult = await createPdf({
      title: `${reportLabel}${intake.company ? `: ${intake.company.slice(0, 60)}` : ""}`,
      sections: finalSections,
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
  console.log(`[exec-report] Order ${params.orderId} — PDF ready at ${finalRelPath}${pages ? ` (${pages} pages)` : ""}`);
  return { success: true, filePath: finalRelPath, fileName: deliveredFileName, pages, modelUsed: modelId, sections: finalSections };
}
