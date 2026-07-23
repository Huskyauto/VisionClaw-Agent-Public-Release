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
import { createPdf } from "./pdf-create";
import { verifyWithCoVe } from "./lib/cove-verifier";
import type { FulfillmentResult } from "./research-report-fulfillment";
import { db } from "./db";
import { sql } from "drizzle-orm";

export interface AuditIntake {
  company?: string;
  website?: string;
  industry?: string;
  notes?: string;
}

const AUDIT_SECTION_PLAN = [
  { heading: "Executive Summary", brief: "3-4 paragraphs: the business's current AI readiness posture at a glance, the 2-3 highest-impact gaps, and the single most valuable next step. Write for a busy owner, not a technologist." },
  { heading: "AI Discoverability & llms.txt", brief: "Explain how AI assistants (ChatGPT, Perplexity, Gemini) discover and represent local businesses; assess what an llms.txt / structured-data posture should look like for this business; give a concrete checklist to become correctly represented in AI answers." },
  { heading: "Website & Content Readiness", brief: "Assess (based on the provided website/industry) what content, schema markup, FAQ coverage, and page structure AI crawlers reward; 5-7 specific improvements ordered by impact." },
  { heading: "AI Tooling Opportunities", brief: "4-6 concrete AI tools/workflows this business type can adopt in the next 90 days (front-desk automation, review responses, content generation, lead follow-up), each with rough cost and effort. Real vendor names where credible." },
  { heading: "Competitive AI Exposure", brief: "How competitors in this industry are already showing up in AI-generated answers and using AI operationally; what falling behind looks like in 12 months; 3 defensive priorities." },
  { heading: "Risks & Compliance Notes", brief: "3-5 practical cautions: data privacy, review-platform policies, AI-content disclosure norms, and industry-specific regulatory considerations. Specific, not generic." },
  { heading: "90-Day AI Readiness Roadmap", brief: "A prioritized checklist of 10-14 actions across weeks 1-2, month 1, and months 2-3. Each action one sentence with a rough effort estimate. End with what 'done' looks like." },
];

function sanitize(str: string, maxLen = 500): string {
  return String(str || "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
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
    if (!text) return `(No content generated for this section. The agent may need to retry.)`;
    return text;
  } catch (err: any) {
    console.warn(`[audit-fulfillment] Section "${section.heading}" failed: ${err.message}`);
    return `(This section could not be generated automatically. Error: ${err.message?.slice(0, 200) || "unknown"}. Please contact support and we will regenerate this audit or refund.)`;
  }
}

export async function fulfillReadinessAudit(params: {
  intake: AuditIntake;
  customerEmail: string;
  orderId: string;
  tenantId?: number;
}): Promise<FulfillmentResult> {
  const tenantId = params.tenantId || 1;
  const intake: AuditIntake = {
    company: params.intake.company ? sanitize(params.intake.company, 200) : undefined,
    website: params.intake.website ? sanitize(params.intake.website, 300) : undefined,
    industry: params.intake.industry ? sanitize(params.intake.industry, 200) : undefined,
    notes: params.intake.notes ? sanitize(params.intake.notes, 500) : undefined,
  };

  // Free-tier lane — same rationale as research reports: fixed-price sale,
  // don't bleed paid API spend on background generation.
  const modelId = await getModelForTierAsync("powerful", tenantId, { freeTierOnly: true });
  console.log(`[audit-fulfillment] Order ${params.orderId} — using model ${modelId} for ${AUDIT_SECTION_PLAN.length} sections`);

  const sections: { heading: string; body: string }[] = [];
  for (const s of AUDIT_SECTION_PLAN) {
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
    sections.push({ heading: s.heading, body: finalBody });
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
