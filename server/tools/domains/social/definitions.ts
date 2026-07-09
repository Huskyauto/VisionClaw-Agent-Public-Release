/**
 * Tools-layer-split S14 — social-domain tool definitions.
 *
 * Selection: the 4 MarTech content/social tools (R79, ported from Charlie
 * Hills' social-media-skills MIT) — `generate_hooks`, `format_post`,
 * `generate_content_matrix`, `score_post`. They are adjacent in the legacy
 * facade, share the single external dependency `./martech-bundle`, carry no
 * module-scope helpers, and use only the `_tenantId` trust seam — the smallest
 * safe cohesive batch. Adjacent social tools stay legacy per smallest-safe-batch:
 * the `x_*` Twitter cluster is the dedicated S15 x-twitter slice; the scattered
 * marketing social-post tools (`draft_social_post`, `generate_social_image`,
 * `compose_social_post`, `publish_social_post`, `manage_social_accounts`) and
 * the cross-platform scheduler cluster (`repurpose_content`,
 * `schedule_cross_platform_post` [destructive, requireApproval, reads
 * `_personaName`/`_userId` — trust channels outside ToolContext],
 * `cancel_scheduled_post`, `list_scheduled_posts`) are scattered / network /
 * destructive and migrate in a later pass.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const generateHooksDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_hooks",
    description: "R79 (MarTech Bundle, after Charlie Hills' hook-generator MIT) — generate 6 (default) two-line LinkedIn hook variations for a topic, each <=40 chars per line, every variation including a digit and a 'How I'/'I' statement. Angles: number-led, contrarian, transformation, authority steal, admission, future shock. Reads voice profile if one exists for the tenant.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to write hooks for." },
        count: { type: "integer", description: "How many variations (default 6, max 12)." },
        voice_profile_name: { type: "string", description: "Optional voice profile name (default 'default')." },
      },
      required: ["topic"],
    },
  },
};

export const formatPostDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "format_post",
    description: "R79 (MarTech Bundle, after Charlie Hills' post-formatter MIT) — render a topic into a ready-to-publish post using a named copy framework: PAS (Problem/Agitate/Solution), AIDA (Attention/Interest/Desire/Action), BAB (Before/After/Bridge), STAR (Situation/Task/Action/Result), or SLAY (Story/Lesson/Application/Yield). Reads voice profile when present. Platform-aware (linkedin / x / newsletter).",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or angle for the post." },
        framework: { type: "string", description: "One of: PAS, AIDA, BAB, STAR, SLAY." },
        platform: { type: "string", description: "Optional platform: 'linkedin' (default), 'x', or 'newsletter'. Controls character cap + tone." },
        context_dump: { type: "string", description: "Optional raw notes / transcript / bullet points for the LLM to draw from." },
        voice_profile_name: { type: "string", description: "Optional voice profile name (default 'default')." },
      },
      required: ["topic", "framework"],
    },
  },
};

export const generateContentMatrixDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_content_matrix",
    description: "R79 (MarTech Bundle, after Charlie Hills' content-matrix MIT) — build a pillars x formats grid (Justin Welsh style) producing 32+ specific post ideas in one call. Default 8 formats: list / story / contrarian / how-to / case-study / teardown / lesson / prediction. Pillars default to those derived in the tenant's voice profile. Returns both an ideas array and a markdown table.",
    parameters: {
      type: "object",
      properties: {
        pillars: { type: "array", items: { type: "string" }, description: "Topic pillars (3-8). Defaults to the voice profile's pillars." },
        formats: { type: "array", items: { type: "string" }, description: "Post formats (3-10). Defaults to 8 standard formats." },
        voice_profile_name: { type: "string", description: "Optional voice profile name (default 'default')." },
      },
    },
  },
};

export const scorePostDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "score_post",
    description: "R79 (MarTech Bundle, after Charlie Hills' post-scorer MIT) — score a draft post 0-100 against the tenant's voice profile and (optionally) historical performance data. Returns scoreOutOf100, letter grade, sub-scores (voiceMatch / hook / body / cta), patternsMatched, patternsViolated, top 3 rewrite suggestions, and which benchmark was used ('voice + history' | 'voice only' | 'generic only'). When historical_posts_json is given, calibrates against the median engagement of that history.",
    parameters: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The post draft to score (>=20 chars)." },
        platform: { type: "string", description: "Optional platform: 'linkedin' (default), 'x', or 'newsletter'." },
        historical_posts_json: { type: "string", description: "Optional JSON array of past posts: [{ text, engagements, impressions }]. If omitted, scores against voice + generic best practices only." },
        voice_profile_name: { type: "string", description: "Optional voice profile name (default 'default')." },
      },
      required: ["draft"],
    },
  },
};

/** All social-domain definitions, for the facade's TOOL_DEFINITIONS splice. */
export const socialDomainDefinitions: ToolDefinition[] = [
  generateHooksDefinition,
  formatPostDefinition,
  generateContentMatrixDefinition,
  scorePostDefinition,
];
