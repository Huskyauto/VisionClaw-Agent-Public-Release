/**
 * AI Readiness Audit fulfillment — Sell & Fulfill slice.
 *
 * Generates the self-serve ($497) AI Readiness Audit PDF after a Stripe
 * payment, modeled exactly on research-report-fulfillment.ts: free-tier
 * model lane (no paid API bleed on a fixed-price sale), section-by-section
 * generation, CoVe verification on substantive sections, createPdf output
 * into uploads/. The webhook routes the result through the SAME
 * service-review-queue as research reports — nothing auto-ships until the
 * SKU is graduated via isAutoShipEligible.
 *
 * DFY ($1,997) and enterprise tiers stay owner-manual (email alert only).
 */
import path from "path";
import fs from "fs";
import { getClientForModel, getModelForTierAsync } from "./providers";
import { findFailedSectionIndices, isFailedSectionBody, describeFailedSections, buildErrorPlaceholder, buildNoContentPlaceholder } from "./lib/deliverable-section-gate";
import { captureIncident } from "./agentic/repair-incident";
import { createPdf } from "./pdf-create";
import { verifyWithCoVe } from "./lib/cove-verifier";
import type { FulfillmentResult } from "./research-report-fulfillment";
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface AuditIntake {
  company?: string;
  website?: string;
  industry?: string;
  /** CRM the business already uses (e.g. HubSpot, Salesforce, GoHighLevel). Empty/undefined = none/unknown. */
  crm?: string;
  notes?: string;
}

const AUDIT_SECTION_PLAN = [
  { heading: "Executive Summary", brief: "3-4 paragraphs: the business's current AI readiness posture at a glance, the 2-3 highest-impact gaps, and the single most valuable next step. Write for a busy owner, not a technologist." },
  { heading: "AI Discoverability & llms.txt", brief: "Explain how AI assistants (ChatGPT, Perplexity, Gemini) discover and represent local businesses; assess what an llms.txt / structured-data posture should look like for this business; give a concrete checklist to become correctly represented in AI answers." },
  { heading: "Website & Content Readiness", brief: "Assess (based on the provided website/industry) what content, schema markup, FAQ coverage, and page structure AI crawlers reward; 5-7 specific improvements ordered by impact." },
  { heading: "AI Tooling Opportunities", brief: "4-6 concrete AI tools/workflows this business type can adopt in the next 90 days (front-desk automation, review responses, content generation, lead follow-up), each with rough cost and effort. Real vendor names where credible." },
  { heading: "Competitive AI Exposure", brief: "How competitors in this industry are already showing up in AI-generated answers and using AI operationally; what falling behind looks like in 12 months; 3 defensive priorities." },
  { heading: "Agent Interaction Readiness", brief: "Assess how well an AI *agent* (not just a chatbot answering questions) could complete real tasks on this business's website — finding hours/prices, filling the contact form, booking or purchasing. Cover: server-rendered content vs JavaScript-only pages, semantic HTML and heading structure, labeled form fields, real links/buttons vs click-handler divs, and data marked up in real tables. Flag anything that would make an agent fail a booking/checkout/inquiry journey as CRITICAL. End with a 5-item fix list ordered by impact." },
  { heading: "Off-Site AI Presence & Entity Graph", brief: "AI answers are grounded in third-party sources, not just the business's own site. Assess the likely footprint on: Google Business Profile/Knowledge Panel, Wikipedia/Wikidata, industry directories, review platforms, Reddit and forums, and YouTube. Explain schema.org sameAs links and consistent NAP (name/address/phone) as entity-resolution signals. Give a prioritized checklist to strengthen the off-site sources AI engines actually cite for this industry." },
  { heading: "Content Quotability (GEO)", brief: "Assess how 'liftable' the business's content is for generative engines: inverted-pyramid answers, standalone sections that make sense out of context, statistics with dates and sources, FAQ blocks matching real customer questions, and comparison content. Explain why quotable content wins AI citations, then give 4-6 concrete content pieces this business should create or restructure, each with a one-line rationale." },
  { heading: "Risks & Compliance Notes", brief: "3-5 practical cautions: data privacy, review-platform policies, AI-content disclosure norms, and industry-specific regulatory considerations. Specific, not generic." },
  { heading: "90-Day AI Readiness Roadmap", brief: "A prioritized checklist of 10-14 actions across weeks 1-2, month 1, and months 2-3. Each action one sentence with a rough effort estimate. End with what 'done' looks like." },
];

function sanitize(str: string, maxLen = 500): string {
  return String(str || "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
}

/**
 * Stricter sanitizer for the CRM name: it is interpolated into imperative
 * prompt sentences, so it must stay a product NAME, never a payload.
 * Character allowlist (letters/digits/space and common product punctuation),
 * collapsed whitespace, 60-char cap. Anything that survives is inert as an
 * instruction ("ignore prior instructions" becomes just noise words that the
 * length cap and the fixed surrounding sentence keep harmless — and there is
 * no way to smuggle newlines, colons-as-headers, or quotes/backticks).
 */
function sanitizeCrmName(str: string): string {
  return String(str || "")
    .replace(/[^A-Za-z0-9 .&+\-/()']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Best-effort intake recovery: the anonymous /audit checkout carries no intake
 * fields, but the /audit lead-capture form usually has a row for the same
 * email (icp_hint = industry, notes = free text). Missing intake does NOT
 * block fulfillment — the audit degrades to industry-generic guidance and the
 * review queue holds it for Bob to eyeball before shipping.
 */
export async function recoverAuditIntake(tenantId: number, customerEmail: string): Promise<AuditIntake> {
  try {
    const result: any = await db.execute(sql`
      SELECT icp_hint, notes, tier_interest FROM audit_leads
      WHERE tenant_id = ${tenantId} AND email = ${customerEmail}
      ORDER BY id DESC LIMIT 1
    `);
    const row = (result.rows || result)?.[0];
    if (!row) return {};
    return {
      industry: row.icp_hint ? sanitize(String(row.icp_hint), 200) : undefined,
      notes: row.notes ? sanitize(String(row.notes), 500) : undefined,
    };
  } catch (e: any) {
    console.warn(`[audit-fulfillment] lead-intake recovery failed (non-fatal): ${e?.message}`);
    return {};
  }
}

function buildSystemPrompt(): string {
  return [
    "You are a senior AI-readiness consultant writing a paid audit for a small-business owner.",
    "Output ONLY the body text for the requested section — no heading, no preface, no meta commentary.",
    "Be specific, concrete, and actionable. Cite real tools/vendors by name when you reference them.",
    "If information about the specific business is missing, give best-practice guidance for the industry and clearly frame it as such — never fabricate facts about the business.",
    "Use plain prose with short paragraphs. Use '-' bullet lists where appropriate. No markdown headings.",
    "Aim for ~350-500 words per section unless brevity serves the reader better.",
  ].join("\n");
}

function buildSectionPrompt(intake: AuditIntake, section: { heading: string; brief: string }): string {
  return [
    `BUSINESS: ${intake.company || "(name not provided)"}`,
    intake.website ? `WEBSITE: ${intake.website}` : "",
    intake.industry ? `INDUSTRY / ICP: ${intake.industry}` : "",
    intake.crm ? `EXISTING CRM: ${intake.crm}` : "EXISTING CRM: none reported",
    intake.crm
      ? `CRM CONTEXT: This business already runs ${intake.crm}. Where this section touches tooling, automation, lead follow-up, reporting, or data, tailor every recommendation to what ${intake.crm} natively supports (its AI features, automations, reporting, and integration marketplace). Recommend building ON their CRM — name the specific ${intake.crm} features/apps to use — and do NOT suggest replacing it or adopting a competing CRM unless a genuine gap makes an add-on necessary.`
      : "",
    intake.notes ? `CUSTOMER NOTES: ${intake.notes}` : "",
    "",
    `SECTION TO WRITE: "${section.heading}"`,
    `WHAT THIS SECTION MUST COVER: ${section.brief}`,
    "",
    "Write the section now.",
  ].filter(Boolean).join("\n");
}

async function generateSection(modelId: string, tenantId: number, intake: AuditIntake, section: { heading: string; brief: string }): Promise<string> {
  try {
    const { client, actualModelId } = await getClientForModel(modelId, tenantId);
    const result = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildSectionPrompt(intake, section) },
      ],
      temperature: 0.4,
      max_tokens: 1200,
    } as any);
    const text = (result as any)?.choices?.[0]?.message?.content?.toString().trim() || "";
    if (!text) return buildNoContentPlaceholder();
    return text;
  } catch (err: any) {
    console.warn(`[audit-fulfillment] Section "${section.heading}" failed: ${err.message}`);
    return buildErrorPlaceholder(err?.message, "audit");
  }
}

export async function fulfillReadinessAudit(params: {
  intake: AuditIntake;
  customerEmail: string;
  orderId: string;
  tenantId?: number;
}): Promise<FulfillmentResult> {
  // Fail-closed tenant resolution (72h-review MEDIUM): no silent `|| 1`
  // fallback — a caller that omits tenantId gets an error, not owner-tenant
  // writes/cost attribution by accident.
  if (!Number.isInteger(params.tenantId) || (params.tenantId as number) <= 0) {
    throw new Error("fulfillReadinessAudit: a valid positive tenantId is required (no default)");
  }
  const tenantId: number = params.tenantId as number;
  const intake: AuditIntake = {
    company: params.intake.company ? sanitize(params.intake.company, 200) : undefined,
    website: params.intake.website ? sanitize(params.intake.website, 300) : undefined,
    industry: params.intake.industry ? sanitize(params.intake.industry, 200) : undefined,
    crm: params.intake.crm ? (sanitizeCrmName(params.intake.crm) || undefined) : undefined,
    notes: params.intake.notes ? sanitize(params.intake.notes, 500) : undefined,
  };

  // Free-tier lane — same rationale as research reports: fixed-price sale,
  // don't bleed paid API spend on background generation.
  const modelId = await getModelForTierAsync("powerful", tenantId, { freeTierOnly: true });
  console.log(`[audit-fulfillment] Order ${params.orderId} — using model ${modelId} for ${AUDIT_SECTION_PLAN.length} sections`);

  // Sections are independent — generate with bounded parallelism (3 at a
  // time) instead of strictly sequentially. Cuts wall-clock fulfillment time
  // ~3x on the free-tier lane while staying well under provider rate limits.
  // Results are written by index so section ORDER in the PDF is unchanged.
  const SECTION_CONCURRENCY = 3;
  const sections: { heading: string; body: string }[] = new Array(AUDIT_SECTION_PLAN.length);
  let nextIdx = 0;
  async function sectionWorker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= AUDIT_SECTION_PLAN.length) return;
      const s = AUDIT_SECTION_PLAN[i];
      const body = await generateSection(modelId, tenantId, intake, s);
      let finalBody = body;
      if (body && body.length >= 200 && !body.startsWith("(")) {
        try {
          const cove = await verifyWithCoVe({
            draft: body,
            topic: `AI readiness audit${intake.industry ? ` for ${intake.industry}` : ""} — section: ${s.heading}`,
            tenantId,
            maxQuestions: 6,
            modelTier: "balanced",
          });
          if (!cove.unchanged && cove.revised) finalBody = cove.revised;
        } catch (e: any) {
          console.warn(`[audit-fulfillment] CoVe error on "${s.heading}" (ignored): ${e?.message || String(e)}`);
        }
      }
      sections[i] = { heading: s.heading, body: finalBody };
    }
  }
  await Promise.all(Array.from({ length: Math.min(SECTION_CONCURRENCY, AUDIT_SECTION_PLAN.length) }, () => sectionWorker()));

  // ── Self-healing quality gate (fail-closed) ───────────────────────────────
  // A section that failed generation carries a "(This section could not be
  // generated ...)" placeholder. NEVER ship those to a customer. One targeted
  // retry pass first (transient-infra remedy owned by this loop), then if any
  // section is still broken: capture a repair incident (self-repair loop
  // classifies + escalates the owner) and fail the fulfillment.
  let failed = findFailedSectionIndices(sections.map((s) => s?.body));
  if (failed.length > 0) {
    console.warn(`[audit-fulfillment] Order ${params.orderId} — retrying ${failed.length} failed section(s): ${failed.map((i) => AUDIT_SECTION_PLAN[i].heading).join(", ")}`);
    for (const i of failed) {
      const body = await generateSection(modelId, tenantId, intake, AUDIT_SECTION_PLAN[i]);
      if (!isFailedSectionBody(body)) sections[i] = { heading: AUDIT_SECTION_PLAN[i].heading, body };
    }
    failed = findFailedSectionIndices(sections.map((s) => s?.body));
  }
  if (failed.length > 0) {
    const summary = describeFailedSections(AUDIT_SECTION_PLAN.map((s) => s.heading), failed, AUDIT_SECTION_PLAN.length);
    const firstBody = (sections[failed[0]]?.body || "").slice(0, 300);
    console.error(`[audit-fulfillment] Order ${params.orderId} — QUALITY GATE FAILED after retry: ${summary}. Refusing to ship.`);
    // Fire-and-forget incident capture: a capture failure must never mask the
    // fulfillment failure itself.
    Promise.resolve(
      captureIncident({
        tenantId,
        source: "felix_deliverable",
        title: `audit ${params.orderId}: ${summary}`.slice(0, 200),
        signature: "audit_sections_failed_after_retry",
        error: `${summary}. First placeholder: ${firstBody}`,
        stage: "audit-fulfillment",
        candidateFiles: ["server/audit-fulfillment.ts", "server/lib/param-adaptation.ts", "server/providers.ts"],
        felixFailureKind: "verify_failed",
        metadata: { orderId: params.orderId, modelId, failedHeadings: failed.map((i) => AUDIT_SECTION_PLAN[i].heading) },
      }),
    ).catch((e: any) => console.warn(`[audit-fulfillment] incident capture failed (non-fatal): ${e?.message || e}`));
    return {
      success: false,
      error: `Audit generation failed quality gate: ${summary}. The PDF was NOT sent to the customer. The self-repair system has been notified; regenerate after the underlying issue is fixed.`,
      modelUsed: modelId,
    };
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const introBody = [
    intake.company ? `Prepared for: ${intake.company}` : `Prepared for: ${params.customerEmail}`,
    intake.website ? `Website: ${intake.website}` : "",
    intake.industry ? `Industry: ${intake.industry}` : "",
    `Order: ${params.orderId}`,
    `Generated: ${generatedAt}`,
    "",
    "This AI Readiness Audit was researched and written by the VisionClaw Agent platform. It assesses how prepared your business is for the AI-assisted discovery era and gives you a prioritized roadmap. Treat vendor and pricing references as starting points — verify current terms before purchasing.",
  ].filter(Boolean).join("\n");

  const finalSections = [
    { heading: "About This Audit", body: introBody },
    ...sections,
    { heading: "Disclaimer", body: "This audit was generated by an AI analysis pipeline using publicly available information and the intake you provided. While every reasonable effort has been made to ensure accuracy, it may contain errors or outdated facts. Verify all material claims before relying on them for legal, financial, or other consequential decisions. [Your Company] and the VisionClaw Agent platform make no warranty of accuracy and are not liable for decisions made on the basis of this audit." },
  ];

  const safeName = (intake.company || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "business";
  const fileName = `ai-readiness-audit-${safeName}-${Date.now()}.pdf`;
  const outputPath = path.join("uploads", fileName);

  const pdfResult = await createPdf({
    title: `AI Readiness Audit${intake.company ? `: ${intake.company.slice(0, 60)}` : ""}`,
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
  const finalRelPath = relPath.startsWith("..") ? outputPath : relPath;

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `PDF was reported as written but not found on disk: ${absPath}`, modelUsed: modelId };
  }

  console.log(`[audit-fulfillment] Order ${params.orderId} — PDF ready at ${finalRelPath} (${pdfResult.pages || "?"} pages)`);
  return { success: true, filePath: finalRelPath, fileName, pages: pdfResult.pages, modelUsed: modelId, sections: finalSections };
}
