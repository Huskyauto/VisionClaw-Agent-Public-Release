/**
 * Tools-layer-split S26c — reference-learner-domain tool definitions.
 *
 * The 2 taste-transfer tools (`learn_from_reference`, `recall_references`)
 * — a single coherent cluster backed solely by `server/reference-learner`
 * (`learnFromReference` / `recallReferences`).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const learnFromReferenceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "learn_from_reference",
    description: "R98.14 — TASTE TRANSFER. Point Felix at a real high-quality example on the open web (YouTube video, polished webpage, public PDF, slide deck, HTML utility) and he extracts 3-8 specific, copyable patterns that make it work — then stores them as STRATEGIC_REFERENCE_V1 memory rows so future deliverables of that format start with the taste already loaded. Use this when (a) the customer points you at a reference ('match this style'), (b) you're producing a high-stakes deliverable and want to study a known-good exemplar first, (c) Bob wants the agent to study his favorite YouTube channel before producing similar content. SSRF-jailed (https only, no internal IPs, DNS-rebinding-defended). For YouTube: pulls oEmbed metadata + thumbnail for vision analysis. For other URLs: fetches HTML (≤2MB, 15s timeout), extracts visible text + meta. Vision LLM analyzes against the format's quality-card baseline and extracts patterns BEYOND those defaults. Returns {success, patterns:[{pattern, why_it_works}], best_for, summary, style_tags, source, stored_memory_id}. Recall later via recall_references.",
    parameters: {
      type: "object",
      properties: {
        reference_url: { type: "string", description: "Public https URL of the reference. YouTube URLs (youtube.com/watch?v=... or youtu.be/...) get special handling. http/file/ftp/internal IPs REJECTED." },
        deliverable_type: { type: "string", enum: ["video", "audio", "pdf", "slides", "html_app", "spreadsheet", "document", "image"], description: "What kind of deliverable's taste you're learning." },
        what_to_learn: { type: "string", description: "Optional: caller hint about what aspect to study (e.g. 'pacing and editing rhythm', 'cover-page hierarchy', 'mobile-first layout patterns'). ≤300 chars." },
        model: { type: "string", description: "Optional analysis model override (default gemini-2.5-flash)." },
      },
      required: ["reference_url", "deliverable_type"],
    },
  },
};

export const recallReferencesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "recall_references",
    description: "R98.14 — Recall references previously learned via learn_from_reference. Filter by deliverable_type and/or style_tags. Returns up to N matching references with full pattern lists. Use at task start (alongside recall_strategic_wins + recall_failure_patterns) to load relevant taste BEFORE planning a deliverable.",
    parameters: {
      type: "object",
      properties: {
        deliverable_type: { type: "string", description: "Filter to one format. Omit for all formats." },
        style_tags: { type: "array", items: { type: "string" }, description: "Optional tag filter — returns refs whose style_tags overlap." },
        limit: { type: "number", description: "Max references to return (default 10, max 50)." },
      },
    },
  },
};

export const referenceLearnerDomainDefinitions: ToolDefinition[] = [
  learnFromReferenceDefinition,
  recallReferencesDefinition,
];
