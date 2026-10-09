/**
 * Tools-layer-split S26f — content-ops-domain tool definitions.
 *
 * Two content-operations tools:
 *   - `lookup_output_skill` — on-demand deliverable scaffolding lookup
 *                             (backed by server/lib/output-skills)
 *   - `repurpose_content`   — cross-platform content repurposer
 *                             (backed by server/lib/content-repurposer)
 *
 * Public schemas do not expose trust signals or billing controls.
 * repurpose_content now binds its bounded LLM cost to trusted ctx.tenantId.
 * `lookup_output_skill` is a global
 * template read; `repurpose_content` is read-only (does NOT publish/schedule).
 *
 * Definitions were moved from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs. Names, public schema and ordering remain unchanged; the
 * repurposer description now documents medium effort and uncertain-call handling.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const lookupOutputSkillDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "lookup_output_skill",
    description: "Pull a structured scaffolding template for a corporate / small-business deliverable on demand. Use when you're about to produce a PRD, OKR, board deck narrative, investor update, contract review, NDA analysis, compliance checklist, sales battlecard, discovery call prep, GTM plan, pricing strategy, content calendar, press release, email campaign, job description, performance review, onboarding plan, incident postmortem, runbook, SOP, vendor evaluation, executive summary, meeting notes, RICE prioritisation, or roadmap narrative — fetch the template FIRST, then fill it in with the user's context. Two modes: (1) pass `topic` to get the markdown scaffolding for that specific deliverable; (2) pass `department` (Product|Strategy|Communications|Sales|Marketing|Legal|HR|Operations) to list available topics within a department. Returns {ok, topic, department, content} on hit, or {ok:false, available_topics:[...]} on miss. Cheap: pure local file read, <5ms.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The specific deliverable topic (e.g. 'prd-template', 'investor-update', 'contract-review'). lowercase-with-dashes. Mutually exclusive with department." },
        department: { type: "string", description: "Optional: list topics filtered to a department. One of: Product, Strategy, Communications, Sales, Marketing, Legal, HR, Operations." },
        persona: { type: "string", description: "Optional: filter to topics that fit a persona (e.g. 'minerva', 'felix', 'legal')." },
      },
    },
  },
};

export const repurposeContentDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "repurpose_content",
    description: "Create platform-shaped drafts from one source for X, LinkedIn, Instagram, Facebook, Threads and Pinterest. Draft-only: never publishes or schedules. Paid native route uses budgeted Haiku 5.5 medium; resolver-selected flat/free routes are preserved. On *_NO_RETRY uncertain-completion errors, do not automatically repeat or switch paid tools. Returns {ok, variants:[{platform, content, suggestedImagePrompt?, charCount, truncated}]}. Review drafts before using schedule_cross_platform_post or saveDraftPost; existing approval rules still apply.",
    parameters: {
      type: "object",
      properties: {
        sourceText: { type: "string", description: "Long-form source content to repurpose. Minimum 20 chars. Capped at 24,000 chars before LLM call." },
        targetPlatforms: { type: "array", items: { type: "string", enum: ["x", "linkedin", "instagram", "facebook", "threads", "pinterest"] }, description: "Non-empty array of platform identifiers. Variants are emitted in this exact order." },
        brandVoice: { type: "string", description: "Optional brand voice hint (e.g. 'casual, wellness focused, honest about struggle')." },
        callToAction: { type: "string", description: "Optional required call-to-action (e.g. 'visit ai-buddy-wellness-protocol-4-26-26.replit.app')." },
      },
      required: ["sourceText", "targetPlatforms"],
    },
  },
};

export const contentOpsDomainDefinitions: ToolDefinition[] = [
  lookupOutputSkillDefinition,
  repurposeContentDefinition,
];
