// R98.13 W4 — Prompt → Contract router. Declarative per-format pipelines that
// bind a customer request to ONE canonical execution shape. Felix doesn't
// re-invent the order of operations every time; the router classifies the
// request and hands back the exact tool sequence + validators + delivery step.
//
// Closes the entire class of "Felix forgot to call X" / "Felix called things
// in the wrong order" failures by making the format -> pipeline mapping data
// instead of vibes.

import { runLlmTask } from "./llm-task";

export type DeliverableFormat =
  | "video"        // narrated MP4 with slides + voiceover
  | "audio"        // standalone narration MP3
  | "pdf"          // styled report PDF
  | "slides"       // Google Slides deck (PPTX/PDF export)
  | "spreadsheet"  // Excel / Google Sheet
  | "document"     // long-form Google Doc
  | "html_app"     // single-file downloadable HTML utility
  | "image"        // single generated image
  | "research"     // research brief — no file, just analysis
  | "none";        // not a deliverable request — chat reply

export interface PipelineStep {
  tool: string;                       // tool name to call
  required: boolean;                  // if false, skip on missing inputs
  purpose: string;                    // one-line why
  inputsHint?: string;                // what params Felix should fill
  // R98.16 #2 — Wave Table. Steps with the same `wave` number can be
  // dispatched in parallel; steps in higher waves wait for all lower waves
  // to finish. `dependsOn` is the step indices (0-based within the pipeline)
  // this step needs before running. Decided once at plan-time using the
  // 4-question dependency test:
  //   1. Does it write a file another step reads? → SEQUENTIAL after writer.
  //   2. Does it depend on another step's return value? → SEQUENTIAL.
  //   3. Does it READ a file written by another step? → SEQUENTIAL after writer.
  //   4. Otherwise → PARALLEL (same wave as siblings).
  // Felix's planner reads this directly instead of re-inferring dependencies
  // from prose every turn (which previously defaulted to fully sequential).
  wave?: number;                      // 1-based; default 1 (run first / sequential)
  dependsOn?: number[];               // step indices this step waits for
}

export interface DeliverablePipeline {
  format: DeliverableFormat;
  description: string;
  steps: PipelineStep[];              // ordered DAG (mostly linear)
  graderFormat?: DeliverableFormat;   // which W3 grader to use; omit if not graded
  passingGradeBar: number;            // 0-100; default 85
  acceptanceNotes: string;            // human-readable bar from the plan doc
  // R98.21 — Hyperagent-cross-pollination: upfront cost+duration estimate so Felix
  // can tell the customer "~$8 / ~12 min" before starting work. These are MEDIAN
  // estimates from the last ~30 days of similar runs (rounded). Prefer the wider
  // band (estDurationMinHigh/estCostUsdHigh) when speaking to a paying customer
  // so we underpromise. If a value is 0 the format has no measurable cost yet.
  estDurationMinLow: number;
  estDurationMinMedian: number;
  estDurationMinHigh: number;
  estCostUsdLow: number;
  estCostUsdMedian: number;
  estCostUsdHigh: number;
}

export const DELIVERABLE_PIPELINES: Record<DeliverableFormat, DeliverablePipeline> = {
  video: {
    format: "video",
    description: "Narrated MP4 with slides + voiceover. Director-planned, then produced.",
    steps: [
      { tool: "plan_video_production", required: true, purpose: "R98.3 director — decompose topic into per-slide narration + image prompts.", inputsHint: "{topic, duration_sec, audience, tone}", wave: 1 },
      { tool: "produce_video", required: true, purpose: "Render the MP4 from the director's plan.", inputsHint: "spread `result.produce_video_args` + `email_to: <customer_email>`", wave: 2, dependsOn: [0] },
      { tool: "verify_deliverable", required: true, purpose: "Contract check (extension/MIME/render/size).", inputsHint: "{deliverable_type:'video', file_path: <result.video_path>}", wave: 3, dependsOn: [1] },
      // grade_deliverable reads the video file but only depends on verify having confirmed it exists; runs in same wave as verify_delivery_proof when proof URL is independent.
      { tool: "grade_deliverable", required: false, purpose: "W3 vision grader — sample frames, audio LUFS, no >2s black, no meta-narration. Auto-revise if <85.", inputsHint: "{deliverable_type:'video', file_path}", wave: 4, dependsOn: [2] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 three-proof gate — artifact + URL on trusted host + optional project_files row.", inputsHint: "{deliverable_type:'video', file_path, file_url:<watch_url>}", wave: 4, dependsOn: [2] },
    ],
    graderFormat: "video",
    passingGradeBar: 85,
    acceptanceNotes: "H.264+AAC, +faststart, audio end-to-end with no >250ms gap, duration within ±5% of script, opens in Drive HTML5 preview, signed URL HEAD 200.",
    estDurationMinLow: 8, estDurationMinMedian: 14, estDurationMinHigh: 25,
    estCostUsdLow: 1.50, estCostUsdMedian: 4.20, estCostUsdHigh: 9.00,
  },
  audio: {
    format: "audio",
    description: "Standalone narration MP3 (no video).",
    steps: [
      { tool: "generate_audio", required: true, purpose: "Render narration via ElevenLabs.", inputsHint: "{text, voice_id?, title?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check (extension/MIME/duration).", inputsHint: "{deliverable_type:'audio', file_path}", wave: 2, dependsOn: [0] },
      { tool: "grade_deliverable", required: false, purpose: "W3 audio grader — LUFS in -23..-16, no end-cut, transcript matches script ≥95%.", inputsHint: "{deliverable_type:'audio', file_path, expected_spec:{transcript:<script>}}", wave: 3, dependsOn: [1] },
      { tool: "deliver_product", required: true, purpose: "Drive upload + branded email.", inputsHint: "{file_path, customer_email, product_name}", wave: 3, dependsOn: [1] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'audio', file_path, file_url:<drive viewUrl>}", wave: 4, dependsOn: [3] },
    ],
    graderFormat: "audio",
    passingGradeBar: 85,
    acceptanceNotes: "44.1kHz, LUFS -23 to -16, last 1.5s audible (not silence-padded), ID3 title set, signed URL HEAD 200.",
    estDurationMinLow: 1, estDurationMinMedian: 3, estDurationMinHigh: 6,
    estCostUsdLow: 0.20, estCostUsdMedian: 0.60, estCostUsdHigh: 1.50,
  },
  pdf: {
    format: "pdf",
    description: "Premium styled PDF report — branded cover, stats grid, tables, two-column layouts.",
    steps: [
      { tool: "create_styled_report", required: true, purpose: "Generate executive-quality PDF with auto-Drive-upload.", inputsHint: "{title, sections:[...], brandColor?, customer_email?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check (extension, MIME, page count, fonts embedded).", inputsHint: "{deliverable_type:'pdf', file_path}", wave: 2, dependsOn: [0] },
      // grade and verify_delivery_proof both read the file but neither depends on the other.
      { tool: "grade_deliverable", required: false, purpose: "W3 PDF grader — first/middle/last page render, no broken layout.", inputsHint: "{deliverable_type:'pdf', file_path, expected_spec:{min_pages, max_pages}}", wave: 3, dependsOn: [1] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'pdf', file_path, file_url:<drive viewUrl>}", wave: 3, dependsOn: [1] },
    ],
    graderFormat: "pdf",
    passingGradeBar: 85,
    acceptanceNotes: "Page count matches outline, fonts embedded, first page renders, signed URL HEAD 200.",
    estDurationMinLow: 2, estDurationMinMedian: 5, estDurationMinHigh: 10,
    estCostUsdLow: 0.15, estCostUsdMedian: 0.45, estCostUsdHigh: 1.20,
  },
  slides: {
    format: "slides",
    description: "Google Slides deck with auto-presenter narration + PPTX/PDF export.",
    steps: [
      { tool: "orchestrate", required: false, purpose: "Use orchestrate fast-path for 8+ slide decks; it dispatches the distributed builder + create_slides + auto-presenter in one shot.", inputsHint: "{objective:'<original prompt>'}", wave: 1 },
      { tool: "create_slides", required: true, purpose: "Build deck (use directly for ≤8 slides; use orchestrate for larger).", inputsHint: "{title, slides:[{title, content, image_prompt?}], auto_present?:true}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check.", inputsHint: "{deliverable_type:'slides', file_path: <pptx_path or pdf_path>}", wave: 2, dependsOn: [1] },
      { tool: "grade_deliverable", required: false, purpose: "W3 slides grader — vision LLM checks photo presence on required slides, on-brand colors, narration-matches-slide-content. Auto-revise if <85.", inputsHint: "{deliverable_type:'slides', file_path, expected_spec:{slide_count, requires_photo_on:[...]}}", wave: 3, dependsOn: [2] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'slides', file_path, file_url:<presentation_url>}", wave: 3, dependsOn: [2] },
    ],
    graderFormat: "slides",
    passingGradeBar: 85,
    acceptanceNotes: "Photo present where required (R98.6), narration row count == slide count, PPTX + PDF both export, signed URL HEAD 200.",
    estDurationMinLow: 4, estDurationMinMedian: 9, estDurationMinHigh: 18,
    estCostUsdLow: 0.80, estCostUsdMedian: 2.10, estCostUsdHigh: 5.00,
  },
  spreadsheet: {
    format: "spreadsheet",
    description: "Excel/Google Sheet — data table, formulas, optional charts.",
    steps: [
      { tool: "create_spreadsheet", required: true, purpose: "Build spreadsheet with auto-Drive-upload.", inputsHint: "{title, sheets:[{name, headers, rows}], customer_email?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check.", inputsHint: "{deliverable_type:'csv_data', file_path}", wave: 2, dependsOn: [0] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'csv_data', file_path, file_url:<drive viewUrl>}", wave: 3, dependsOn: [1] },
    ],
    passingGradeBar: 85,
    acceptanceNotes: "Workbook opens in Excel/Sheets, headers correct, row count matches, signed URL HEAD 200.",
    estDurationMinLow: 1, estDurationMinMedian: 3, estDurationMinHigh: 7,
    estCostUsdLow: 0.10, estCostUsdMedian: 0.30, estCostUsdHigh: 0.80,
  },
  document: {
    format: "document",
    description: "Long-form Google Doc with structure (headings, lists, tables).",
    steps: [
      { tool: "create_document", required: true, purpose: "Generate formatted document and upload to Drive.", inputsHint: "{title, sections:[...], customer_email?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check.", inputsHint: "{deliverable_type:'pdf_document' or 'document', file_path}", wave: 2, dependsOn: [0] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'document', file_path, file_url:<drive viewUrl>}", wave: 3, dependsOn: [1] },
    ],
    passingGradeBar: 85,
    acceptanceNotes: "Doc opens in Google Docs, structure preserved, signed URL HEAD 200.",
    estDurationMinLow: 2, estDurationMinMedian: 5, estDurationMinHigh: 12,
    estCostUsdLow: 0.20, estCostUsdMedian: 0.50, estCostUsdHigh: 1.40,
  },
  html_app: {
    format: "html_app",
    description: "Single-file downloadable HTML utility (password gen, calculator, timer, todo).",
    steps: [
      { tool: "build_html_app", required: true, purpose: "R98.12 W5 — generate self-contained <!doctype html> with inline CSS+JS, jsdom-smoke-tested.", inputsHint: "{topic, description, features?, app_type?, smoke_assertion?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check.", inputsHint: "{deliverable_type:'html_page', file_path}", wave: 2, dependsOn: [0] },
      // grade + deliver both depend on a verified file but not on each other.
      { tool: "grade_deliverable", required: false, purpose: "W3 HTML grader — re-run jsdom + per-app-type smoke assertion.", inputsHint: "{deliverable_type:'html_page', file_path, expected_spec:{smoke_assertion}}", wave: 3, dependsOn: [1] },
      { tool: "deliver_product", required: true, purpose: "Drive upload + branded email.", inputsHint: "{file_path, customer_email, product_name}", wave: 3, dependsOn: [1] },
      { tool: "verify_delivery_proof", required: true, purpose: "W2 gate.", inputsHint: "{deliverable_type:'html_page', file_path, file_url:<drive viewUrl>}", wave: 4, dependsOn: [3] },
    ],
    graderFormat: "html_app",
    passingGradeBar: 85,
    acceptanceNotes: "Single-file (or zipped ≤2MB), opens without console errors, per-app smoke test passes, signed URL HEAD 200.",
    estDurationMinLow: 2, estDurationMinMedian: 4, estDurationMinHigh: 8,
    estCostUsdLow: 0.15, estCostUsdMedian: 0.40, estCostUsdHigh: 1.00,
  },
  image: {
    format: "image",
    description: "Single generated image (cinematic, branded, or stock-style).",
    steps: [
      { tool: "generate_image", required: true, purpose: "Generate via image model.", inputsHint: "{prompt, aspect_ratio?, style?}", wave: 1 },
      { tool: "verify_deliverable", required: true, purpose: "Contract check.", inputsHint: "{deliverable_type:'image', file_path}", wave: 2, dependsOn: [0] },
      { tool: "deliver_product", required: false, purpose: "Optional: Drive upload + email if customer wants delivery.", inputsHint: "{file_path, customer_email, product_name}", wave: 3, dependsOn: [1] },
    ],
    passingGradeBar: 80,
    acceptanceNotes: "Image renders, dimensions match request, no watermark.",
    estDurationMinLow: 1, estDurationMinMedian: 2, estDurationMinHigh: 4,
    estCostUsdLow: 0.04, estCostUsdMedian: 0.12, estCostUsdHigh: 0.40,
  },
  research: {
    format: "research",
    description: "Research brief — analysis only, no file deliverable.",
    steps: [
      // Research siblings: same wave (1) means Felix can fan them out in parallel
      // when both are useful (e.g. a quick web_search alongside deep_research).
      { tool: "deep_research", required: false, purpose: "Heavy multi-source research synthesis.", inputsHint: "{topic, depth?:'standard'|'deep'}", wave: 1 },
      { tool: "web_search", required: false, purpose: "Lightweight web search if deep_research is overkill.", inputsHint: "{query}", wave: 1 },
    ],
    passingGradeBar: 0,
    acceptanceNotes: "Synthesized findings in chat reply with citations.",
    estDurationMinLow: 2, estDurationMinMedian: 6, estDurationMinHigh: 15,
    estCostUsdLow: 0.10, estCostUsdMedian: 0.45, estCostUsdHigh: 1.80,
  },
  none: {
    format: "none",
    description: "Not a deliverable request — answer in chat.",
    steps: [],
    passingGradeBar: 0,
    acceptanceNotes: "Direct chat reply.",
    estDurationMinLow: 0, estDurationMinMedian: 0, estDurationMinHigh: 0,
    estCostUsdLow: 0, estCostUsdMedian: 0, estCostUsdHigh: 0,
  },
};

// R98.21 — Customer-facing estimate string for the planner's response.
// Prefer high-end so we underpromise. Returns "" for the `none` format.
export function formatEstimate(p: DeliverablePipeline): string {
  if (p.estDurationMinHigh === 0 && p.estCostUsdHigh === 0) return "";
  const dur = p.estDurationMinLow === p.estDurationMinHigh
    ? `~${p.estDurationMinMedian} min`
    : `~${p.estDurationMinLow}-${p.estDurationMinHigh} min`;
  const cost = p.estCostUsdLow === p.estCostUsdHigh
    ? `~$${p.estCostUsdMedian.toFixed(2)}`
    : `~$${p.estCostUsdLow.toFixed(2)}-$${p.estCostUsdHigh.toFixed(2)}`;
  return `${dur} · ${cost}`;
}

export interface ClassifyResult {
  format: DeliverableFormat;
  confidence: number;                 // 0-1
  reasoning: string;                  // why this format
  extracted_params: Record<string, any>; // any obvious params lifted from prompt (topic, duration_sec, audience, customer_email, etc.)
  suggested_pipeline: DeliverablePipeline;
  next_step_instruction: string;      // exact next tool call Felix should make
}

const CLASSIFIER_SCHEMA = {
  type: "object",
  required: ["format", "confidence", "reasoning", "extracted_params"],
  properties: {
    format: { type: "string", enum: Object.keys(DELIVERABLE_PIPELINES) },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string" },
    extracted_params: {
      type: "object",
      additionalProperties: true,
      properties: {
        topic: { type: "string" },
        duration_sec: { type: "number" },
        audience: { type: "string" },
        tone: { type: "string" },
        slide_count: { type: "number" },
        page_count: { type: "number" },
        customer_email: { type: "string" },
        title: { type: "string" },
        app_type: { type: "string" },
      },
    },
  },
} as const;

export async function classifyDeliverable(prompt: string, opts?: { tenantId?: number; hints?: string; model?: string }): Promise<ClassifyResult> {
  const cleanedPrompt = String(prompt || "").trim().slice(0, 4000);
  if (!cleanedPrompt) {
    return {
      format: "none",
      confidence: 1,
      reasoning: "Empty prompt — nothing to classify.",
      extracted_params: {},
      suggested_pipeline: DELIVERABLE_PIPELINES.none,
      next_step_instruction: "Ask the user what they want.",
    };
  }

  const formatList = Object.entries(DELIVERABLE_PIPELINES)
    .map(([k, v]) => `- ${k}: ${v.description}`)
    .join("\n");

  const classifyPrompt = `You are a deliverable-request classifier for an AI agent platform. Read the user's request below and classify it into EXACTLY ONE deliverable format.

AVAILABLE FORMATS:
${formatList}

USER REQUEST:
"""
${cleanedPrompt}
"""

${opts?.hints ? `HINTS (from caller): ${opts.hints.slice(0, 500)}\n` : ""}
RULES:
- Pick the SINGLE most specific format. If they say "make me a video" -> "video". If they say "explain X" with no file mentioned -> "research" or "none". If unclear, pick "none" with low confidence.
- "presentation", "slide deck", "slides", "pitch deck" -> "slides".
- "report", "PDF", "writeup", "executive summary" -> "pdf".
- "video", "explainer", "ad", "MP4" -> "video".
- "audio", "podcast clip", "voiceover", "MP3" -> "audio".
- "spreadsheet", "Excel", "CSV", "table of data with formulas" -> "spreadsheet".
- "doc", "Google Doc", "long-form writeup" -> "document".
- "password generator", "calculator", "timer", "todo app", "small tool", "single-page app" -> "html_app".
- "logo", "image", "picture", "illustration" -> "image".
- "research", "find out about X", "look into X" -> "research".
- Just chatting / questions -> "none".

EXTRACT any obvious params from the prompt (topic, duration in seconds, audience, tone, slide_count, page_count, customer_email, title, app_type). If a param isn't mentioned, OMIT it from extracted_params (don't guess null/undefined).

Output ONLY JSON conforming to the schema.`;

  let res;
  try {
    res = await runLlmTask({
      tenantId: opts?.tenantId,
      prompt: classifyPrompt,
      schema: CLASSIFIER_SCHEMA as any,
      model: opts?.model || "gemini-2.5-flash",
      timeoutMs: 30000,
      temperature: 0.1,
      maxTokens: 1000,
    });
  } catch (e: any) {
    return {
      format: "none",
      confidence: 0,
      reasoning: `Classifier crashed: ${e?.message || String(e)} — Felix should fall back to manual planning.`,
      extracted_params: {},
      suggested_pipeline: DELIVERABLE_PIPELINES.none,
      next_step_instruction: "Classifier failed — proceed manually based on your reading of the request.",
    };
  }

  const json = (res as any)?.json || {};
  const format = (typeof json.format === "string" && json.format in DELIVERABLE_PIPELINES) ? (json.format as DeliverableFormat) : "none";
  const confidence = typeof json.confidence === "number" ? Math.max(0, Math.min(1, json.confidence)) : 0;
  const reasoning = typeof json.reasoning === "string" ? json.reasoning.slice(0, 1000) : "(no reasoning returned)";
  const extracted_params = (json.extracted_params && typeof json.extracted_params === "object") ? json.extracted_params : {};
  const pipeline = DELIVERABLE_PIPELINES[format];
  const firstStep = pipeline.steps[0];
  const next_step_instruction = firstStep
    ? `Call \`${firstStep.tool}\` next. Purpose: ${firstStep.purpose}${firstStep.inputsHint ? ` Inputs: ${firstStep.inputsHint}.` : ""}`
    : `Format '${format}' — no producer pipeline; reply in chat.`;

  return { format, confidence, reasoning, extracted_params, suggested_pipeline: pipeline, next_step_instruction };
}
