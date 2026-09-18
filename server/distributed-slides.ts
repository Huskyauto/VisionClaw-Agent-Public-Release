import { runLlmTask } from "./llm-task";
import * as fs from "fs";
import * as path from "path";

import { logSilentCatch } from "./lib/silent-catch";
function loadProjectContext(): string {
  try {
    const featuresPath = path.resolve(process.cwd(), "VisionClaw-Comprehensive-Features.txt");
    if (fs.existsSync(featuresPath)) {
      return fs.readFileSync(featuresPath, "utf-8").slice(0, 6000);
    }
  } catch (_silentErr) { logSilentCatch("server/distributed-slides.ts", _silentErr); }
  return "";
}

interface SectionPlan {
  sectionTitle: string;
  slideIndices: number[];
  slideBriefs: { layout: string; focus: string }[];
}

interface DeckOutline {
  title: string;
  sections: SectionPlan[];
  totalSlides: number;
  theme: string;
}

const LAYOUT_CATALOG = `AVAILABLE LAYOUTS:
- TITLE: Opening/closing (title + subtitle). Use for slide 1 and last slide only.
- SECTION_HEADER: Section divider with title + optional body text.
- BIG_NUMBER: One big stat (bigNumber + bigNumberLabel). Max 2 optional bullets.
- FLOWCHART: Process flow boxes (flowSteps: [{label, description?, color?}]). MAX 4 STEPS.
- ARCHITECTURE: Layered system diagram (architectureTiers: [{label, items[], color?}]). MAX 3 TIERS, max 4 items per tier.
- METRICS_DASHBOARD: KPI cards (metrics: [{value, label, trend?}]). MAX 4 METRICS.
- COMPARISON: Side-by-side cards (comparisonItems: [{title, bullets[], highlight?}]). MAX 3 CARDS, max 4 bullets each.
- TIMELINE: Horizontal milestones (timelineItems: [{date, title, description?}]). MAX 5 ITEMS.
- PROCESS: Numbered vertical steps (processSteps: [{number, title, description?}]). MAX 4 STEPS.
- TABLE: Data table (table: {headers[], rows[][]}). MAX 4 COLUMNS, max 6 rows.
- TWO_COLUMNS: Split layout (leftColumn + rightColumn: {title, bullets[]}). Max 5 bullets per side.
- IMAGE_FULL: Full-slide generated image with title as caption.
- IMAGE_RIGHT / IMAGE_LEFT: Image + text side-by-side. Max 4 bullets on text side.
- QUOTE: Quotation (quote + quoteAttribution).
- TITLE_AND_BODY: Simple title + bullets or body text. Max 6 bullets.`;

const CONTENT_RULES = `CRITICAL CONTENT DENSITY RULES:
- Titles: MAX 8 words
- Bullets: MAX 7 words each
- Max bullets per slide: 6
- flowSteps: MAX 4 steps, labels max 3 words each
- architectureTiers: MAX 3 tiers, MAX 4 items per tier
- processSteps: MAX 4 steps
- timelineItems: MAX 5 items
- metrics: MAX 4, values should be short
- comparisonItems: MAX 3 cards, max 4 bullets each
- table: MAX 4 columns, MAX 6 data rows
- NEVER put long sentences on slide face — use speakerNotes for details
- All values must be strings, never raw numbers`;

export async function planDeckOutline(
  topic: string,
  slideCount: number,
  theme: string,
  tenantId?: number,
): Promise<DeckOutline> {
  const ctx = loadProjectContext();
  const ctxBlock = ctx ? `\n\nPROJECT CONTEXT (use as source of truth — do NOT invent features or stats):\n${ctx}\n` : "";

  const planResult = await runLlmTask({
    prompt: `You are a presentation architect. Plan the STRUCTURE of a ${slideCount}-slide deck. Do NOT write slide content yet — just plan sections.${ctxBlock}

Break the deck into 4-6 sections of 2-4 slides each. For each section, specify:
- sectionTitle: what this section covers
- slideBriefs: array of {layout, focus} for each slide in this section

Rules:
- Slide 1 = TITLE layout (its own section "Opening")
- Last slide = TITLE layout (its own section "Closing")
- Use at least 6 different layout types across the deck for variety
- Each section should be a coherent topic that a specialist could write independently
- Include at least 2 sections that would benefit from diagrams or images

${LAYOUT_CATALOG}

Return JSON: {"title": "Deck Title", "sections": [...], "totalSlides": ${slideCount}, "theme": "${theme}"}`,
    input: { topic, slideCount, theme },
    model: "gemini-2.5-flash",
    thinking: "medium",
    maxTokens: 4096,
    timeoutMs: 30000,
    tenantId,
  });

  if (!planResult.success || !planResult.json?.sections) {
    const fallbackSections: SectionPlan[] = [
      { sectionTitle: "Opening", slideIndices: [0], slideBriefs: [{ layout: "TITLE", focus: "Title slide" }] },
      { sectionTitle: "Overview", slideIndices: [1, 2, 3], slideBriefs: [
        { layout: "SECTION_HEADER", focus: "Overview" },
        { layout: "TITLE_AND_BODY", focus: "Key points" },
        { layout: "BIG_NUMBER", focus: "Key metric" },
      ]},
      { sectionTitle: "Details", slideIndices: [4, 5, 6, 7], slideBriefs: [
        { layout: "SECTION_HEADER", focus: "Deep dive" },
        { layout: "ARCHITECTURE", focus: "System design" },
        { layout: "FLOWCHART", focus: "Process" },
        { layout: "TWO_COLUMNS", focus: "Comparison" },
      ]},
      { sectionTitle: "Impact", slideIndices: [8, 9, 10], slideBriefs: [
        { layout: "METRICS_DASHBOARD", focus: "Results" },
        { layout: "TIMELINE", focus: "Roadmap" },
        { layout: "COMPARISON", focus: "Before/after" },
      ]},
      { sectionTitle: "Closing", slideIndices: [11], slideBriefs: [{ layout: "TITLE", focus: "Call to action" }] },
    ];
    return { title: topic.slice(0, 60), sections: fallbackSections, totalSlides: 12, theme };
  }

  const outline = planResult.json as DeckOutline;
  outline.theme = theme;
  let idx = 0;
  for (const section of outline.sections) {
    section.slideIndices = section.slideBriefs.map(() => idx++);
  }
  outline.totalSlides = idx;
  return outline;
}

export async function buildSectionSlides(
  section: SectionPlan,
  deckTitle: string,
  topic: string,
  theme: string,
  tenantId?: number,
): Promise<any[]> {
  const briefList = section.slideBriefs.map((b, i) => `Slide ${i + 1}: layout=${b.layout}, focus="${b.focus}"`).join("\n");

  const ctx = loadProjectContext();
  const ctxBlock = ctx ? `\nPROJECT CONTEXT (ground ALL content in these real facts — do NOT hallucinate):\n${ctx.slice(0, 4000)}\n` : "";

  const result = await runLlmTask({
    prompt: `You are a presentation content writer. Write ONLY the ${section.slideBriefs.length} slides described below for the "${section.sectionTitle}" section of a deck about: "${topic}"

Deck title: "${deckTitle}"
Theme: ${theme}
${ctxBlock}
YOUR ASSIGNED SLIDES:
${briefList}

${LAYOUT_CATALOG}

${CONTENT_RULES}

DESIGN RULES:
1. Every slide MUST have "layout" and "title" fields
2. Include "speakerNotes" on every slide (2-3 sentences for the presenter)
3. Populate all required fields for each layout type
4. For IMAGE_FULL/IMAGE_RIGHT/IMAGE_LEFT, include a "generateImage" field with a vivid AI image prompt
5. For technical slides, consider including "diagramCode" (Mermaid syntax, max 8 nodes)
6. Keep content concise and visual — this is a presentation, not a document

Return JSON: {"slides": [...]}`,
    input: { section: section.sectionTitle, topic, slideBriefs: section.slideBriefs },
    model: "gemini-2.5-flash",
    maxTokens: 4096,
    timeoutMs: 30000,
    tenantId,
  });

  if (result.success && result.json?.slides) {
    return result.json.slides;
  }

  return section.slideBriefs.map(brief => ({
    layout: brief.layout,
    title: brief.focus,
    body: `Content for: ${brief.focus}`,
    speakerNotes: `Talk about ${brief.focus} in the context of ${section.sectionTitle}`,
  }));
}

export async function buildPresentationDistributed(
  topic: string,
  slideCount: number = 15,
  theme: string = "dark-tech",
  tenantId?: number
): Promise<{ slides: any[]; title: string; sections: number; tokensPerSection: string; method: string }> {
  console.log(`[distributed-slides] Planning deck outline: "${topic}" (${slideCount} slides, ${theme})`);
  const outline = await planDeckOutline(topic, slideCount, theme, tenantId);
  console.log(`[distributed-slides] Outline ready: "${outline.title}" — ${outline.sections.length} sections, ${outline.totalSlides} slides`);

  const sectionResults = await Promise.all(
    outline.sections.map(async (section, idx) => {
      const startTime = Date.now();
      console.log(`[distributed-slides] Section ${idx + 1}/${outline.sections.length}: "${section.sectionTitle}" (${section.slideBriefs.length} slides)`);
      const slides = await buildSectionSlides(section, outline.title, topic, theme, tenantId);
      const elapsed = Date.now() - startTime;
      console.log(`[distributed-slides] Section ${idx + 1} done in ${elapsed}ms — ${slides.length} slides`);
      return { section: section.sectionTitle, slides, elapsed };
    })
  );

  const allSlides: any[] = [];
  for (const sr of sectionResults) {
    allSlides.push(...sr.slides);
  }

  const avgTime = Math.round(sectionResults.reduce((s, r) => s + r.elapsed, 0) / sectionResults.length);
  console.log(`[distributed-slides] Assembly complete: ${allSlides.length} slides from ${sectionResults.length} parallel sections (avg ${avgTime}ms/section)`);

  return {
    slides: allSlides,
    title: outline.title,
    sections: sectionResults.length,
    tokensPerSection: `~2-4K per section (vs ~16K+ monolithic)`,
    method: "distributed-parallel",
  };
}
