import path from "path";
import fs from "fs";
import { getClientForModel, getModelForTierAsync } from "./providers";
import { createPdf } from "./pdf-create";
import { verifyWithCoVe } from "./lib/cove-verifier";

export interface ResearchReportIntake {
  topic: string;
  audience?: string;
  focus?: string;
  depth?: "standard" | "deep";
  /** R123 — opt-in Chain-of-Verification factuality pass on each section before PDF assembly. Adds ~maxQuestions+2 short LLM calls per section. Off by default; auto-on for depth='deep'. */
  verify?: boolean;
}

export interface FulfillmentResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
  pages?: number;
  modelUsed?: string;
  /** Sections actually written to the PDF — exposed so the review-queue QA can inspect them. */
  sections?: { heading: string; body: string }[];
}

const SECTION_PLAN_STANDARD = [
  { heading: "Executive Summary", brief: "3-4 paragraph synthesis: the situation, why it matters now, the single most important takeaway." },
  { heading: "Market Landscape", brief: "Current state of the topic: who the major players are, what the dominant approaches are, recent shifts in the past 6-12 months. Concrete names, numbers where credible." },
  { heading: "Key Findings", brief: "5-7 specific, evidence-supported findings. Each finding: a one-sentence claim followed by 2-3 sentences of substantiation." },
  { heading: "Opportunities", brief: "3-5 actionable opportunities the audience can pursue, each with a brief 'why now' and an estimate of effort/cost." },
  { heading: "Risks & Caveats", brief: "3-5 risks, blind spots, or counter-arguments the audience should weigh. Be specific — generic 'regulation may change' is not enough." },
  { heading: "Recommended 90-Day Action Plan", brief: "A concrete checklist of 8-12 actions the audience should take in the next 90 days, ordered by priority. Each action: one sentence, optionally with a rough effort estimate." },
  { heading: "Sources & Further Reading", brief: "8-15 specific sources (papers, reports, articles, vendors, communities) the reader can investigate further. Use real names and URLs you are confident exist; mark uncertain items as '(verify before citing)'." },
];

const SECTION_PLAN_DEEP = [
  ...SECTION_PLAN_STANDARD.slice(0, 6),
  { heading: "Comparative Analysis", brief: "A head-to-head comparison of the top 3-5 options/approaches/vendors relevant to the topic, including price, fit, and trade-offs." },
  { heading: "Case Studies", brief: "2-3 short case studies (real or composite, clearly labeled) illustrating how the topic plays out in practice." },
  { heading: "Build vs Buy Decision Framework", brief: "A decision framework the audience can apply to their specific situation, with criteria, scoring, and a worked example." },
  SECTION_PLAN_STANDARD[6],
];

function sanitize(str: string, maxLen = 500): string {
  return String(str || "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, maxLen);
}

function buildSystemPrompt(): string {
  return [
    "You are a senior research analyst writing a paid client report.",
    "Output ONLY the body text for the requested section — no heading, no preface, no meta commentary.",
    "Be specific, concrete, and useful. Cite real sources by name when you reference them.",
    "If you are uncertain, say so explicitly rather than fabricating.",
    "Use plain prose with short paragraphs. Use '-' bullet lists where appropriate. No markdown headings.",
    "Aim for ~350-500 words per section unless brevity serves the reader better.",
  ].join("\n");
}

function buildSectionPrompt(intake: ResearchReportIntake, section: { heading: string; brief: string }): string {
  return [
    `RESEARCH TOPIC: ${intake.topic}`,
    intake.audience ? `INTENDED AUDIENCE: ${intake.audience}` : "",
    intake.focus ? `KEY ANGLE / FOCUS: ${intake.focus}` : "",
    "",
    `SECTION TO WRITE: "${section.heading}"`,
    `WHAT THIS SECTION MUST COVER: ${section.brief}`,
    "",
    "Write the section now.",
  ].filter(Boolean).join("\n");
}

async function generateSection(modelId: string, tenantId: number, intake: ResearchReportIntake, section: { heading: string; brief: string }): Promise<string> {
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
    if (!text) return `(No content generated for this section. The agent may need to retry. Topic: ${intake.topic})`;
    return text;
  } catch (err: any) {
    console.warn(`[research-report] Section "${section.heading}" failed: ${err.message}`);
    return `(This section could not be generated automatically. Error: ${err.message?.slice(0, 200) || "unknown"}. Please contact support and we will regenerate this report or refund.)`;
  }
}

export async function fulfillResearchReport(params: {
  intake: ResearchReportIntake;
  customerEmail: string;
  orderId: string;
  tenantId?: number;
}): Promise<FulfillmentResult> {
  const tenantId = params.tenantId || 1;
  const intake: ResearchReportIntake = {
    topic: sanitize(params.intake.topic, 500),
    audience: params.intake.audience ? sanitize(params.intake.audience, 250) : undefined,
    focus: params.intake.focus ? sanitize(params.intake.focus, 350) : undefined,
    depth: params.intake.depth === "deep" ? "deep" : "standard",
    // R123 — preserve opt-in CoVe flag through sanitization; without this,
    // `verify: true` on a standard-depth report would be silently dropped.
    verify: params.intake.verify === true,
  };

  if (!intake.topic) {
    return { success: false, error: "Research topic was empty after sanitization" };
  }

  const plan = intake.depth === "deep" ? SECTION_PLAN_DEEP : SECTION_PLAN_STANDARD;

  // Background work — force the free-tier lane so we don't bleed paid API spend on a $49 sale.
  // Manually request a 'powerful' tier model with freeTierOnly enforced.
  const modelId = await getModelForTierAsync("powerful", tenantId, { freeTierOnly: true });
  console.log(`[research-report] Order ${params.orderId} — using model ${modelId} for ${plan.length} sections (depth=${intake.depth})`);

  // R123 — CoVe verification: opt-in via intake.verify, or auto-on for deep reports.
  const useCoVe = intake.verify === true || intake.depth === "deep";

  const sections: { heading: string; body: string }[] = [];
  let coveStats = { sectionsVerified: 0, contradictionsFound: 0, questionsAsked: 0 };
  for (const s of plan) {
    const body = await generateSection(modelId, tenantId, intake, s);
    let finalBody = body;
    // Skip CoVe on bookend sections (intro/disclaimer style) and on the
    // sources section (verifier would flag every "(verify before citing)" as
    // uncertain by design).
    const skipCove = s.heading === "Sources & Further Reading" || !useCoVe;
    if (!skipCove && body && body.length >= 200 && !body.startsWith("(")) {
      try {
        const cove = await verifyWithCoVe({
          draft: body,
          topic: `${intake.topic} — section: ${s.heading}`,
          tenantId,
          maxQuestions: 6,
          modelTier: "balanced",
        });
        if (!cove.unchanged && cove.revised) {
          finalBody = cove.revised;
          coveStats.sectionsVerified++;
          coveStats.contradictionsFound += cove.contradictions.length;
          coveStats.questionsAsked += cove.questionsAsked;
          console.log(`[research-report] CoVe revised "${s.heading}": ${cove.contradictions.length} contradiction(s) caught, ${cove.questionsAsked} question(s) asked`);
        } else if (cove.warning) {
          console.warn(`[research-report] CoVe skipped "${s.heading}": ${cove.warning}`);
        }
      } catch (e: any) {
        // Fail-open: a bad verification pass must never sink the section.
        console.warn(`[research-report] CoVe error on "${s.heading}" (ignored): ${e?.message || String(e)}`);
      }
    }
    sections.push({ heading: s.heading, body: finalBody });
  }
  if (useCoVe) {
    console.log(`[research-report] Order ${params.orderId} — CoVe summary: ${coveStats.sectionsVerified}/${plan.length} sections revised, ${coveStats.contradictionsFound} contradictions caught across ${coveStats.questionsAsked} questions`);
  }

  const generatedAt = new Date().toISOString().slice(0, 10);
  const introBody = [
    `Topic: ${intake.topic}`,
    intake.audience ? `Prepared for: ${intake.audience}` : "",
    intake.focus ? `Focus: ${intake.focus}` : "",
    `Depth: ${intake.depth === "deep" ? "Deep dive" : "Standard"}`,
    `Order: ${params.orderId}`,
    `Generated: ${generatedAt}`,
    "",
    "This report was researched and written by the VisionClaw Agent platform. It synthesizes publicly available information as of the generation date. Treat it as a starting point, not the final word — verify any claim before acting on it in a high-stakes setting.",
  ].filter(Boolean).join("\n");

  const finalSections = [
    { heading: "About This Report", body: introBody },
    ...sections,
    { heading: "Disclaimer", body: "This report was generated by an AI research pipeline using publicly available information. While every reasonable effort has been made to ensure accuracy, the report may contain errors, outdated facts, or fabricated citations. Verify all material claims before relying on them for legal, financial, medical, or other consequential decisions. [Your Company] and the VisionClaw Agent platform make no warranty of accuracy and are not liable for decisions made on the basis of this report." },
  ];

  const safeName = intake.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "report";
  const fileName = `research-report-${safeName}-${Date.now()}.pdf`;
  const outputPath = path.join("uploads", fileName);

  const pdfResult = await createPdf({
    title: `Research Report: ${intake.topic.slice(0, 80)}`,
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

  // createPdf returns absolute path — we want the project-relative path for delivery-pipeline
  const absPath = pdfResult.path;
  const relPath = path.relative(process.cwd(), absPath);
  const finalRelPath = relPath.startsWith("..") ? outputPath : relPath;

  if (!fs.existsSync(absPath)) {
    return { success: false, error: `PDF was reported as written but not found on disk: ${absPath}`, modelUsed: modelId };
  }

  console.log(`[research-report] Order ${params.orderId} — PDF ready at ${finalRelPath} (${pdfResult.pages || "?"} pages)`);
  return { success: true, filePath: finalRelPath, fileName, pages: pdfResult.pages, modelUsed: modelId, sections: finalSections };
}
