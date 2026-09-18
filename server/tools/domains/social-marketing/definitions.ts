/**
 * Tools-layer-split S25q — social-marketing-domain tool definitions.
 *
 * The 4 contiguous social/marketing tools (`draft_social_post`,
 * `manage_content_calendar`, `marketing_analytics`, `marketing_experiment`) —
 * all backed by `server/social-marketing`, one coherent cluster (author +
 * schedule + measure + A/B-test marketing content).
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array; the
 * facade re-imports these const refs so the LLM-facing surface (names,
 * descriptions, parameter schemas, ordering) is byte-identical.
 *
 * NOTE: `compose_social_post` (a separate tool that internally reuses the
 * `draftSocialPost` backing fn) is NOT part of this slice and stays in the
 * legacy facade untouched.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const draftSocialPostDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "draft_social_post",
    description: "Draft a social media post for VisionClaw Health marketing. Generates platform-optimized content using AI with brand voice guidelines. Returns draft text ready for review/posting.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["x", "linkedin", "tiktok", "instagram"], description: "Target social media platform" },
        topic: { type: "string", description: "What the post should be about" },
        style: { type: "string", enum: ["announcement", "insight", "question", "thread", "hot-take", "build-in-public", "educational", "user-success"], description: "Content style/format" },
        include_cta: { type: "boolean", description: "Include a call-to-action (default true)" },
        include_hashtags: { type: "boolean", description: "Include relevant hashtags (default true)" },
      },
      required: ["platform", "topic"],
    },
  },
};

export const manageContentCalendarDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "manage_content_calendar",
    description: "Use when scheduling social posts ahead of time, when answering \"what is going out this week\", or when removing a post that no longer fits. Three sub-ops: add (schedule new post), view (list upcoming), remove (cancel scheduled). Returns the modified calendar slice. Pair with marketing_analytics to learn from past performance.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "remove", "clear_past"], description: "Calendar action" },
        platform: { type: "string", enum: ["x", "linkedin", "tiktok", "instagram", "all"], description: "Platform filter" },
        content: { type: "string", description: "Post content (for add action)" },
        scheduled_date: { type: "string", description: "ISO date string for scheduling (for add action)" },
        post_id: { type: "string", description: "Post ID to remove (for remove action)" },
        style: { type: "string", description: "Content style tag" },
        campaign: { type: "string", description: "Campaign name to group posts" },
      },
      required: ["action"],
    },
  },
};

export const marketingAnalyticsDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "marketing_analytics",
    description: "Use AFTER posts have published to log results and learn — also when Bob asks \"is the content strategy working\" or before planning the next campaign. Returns post-level metrics (impressions/likes/shares/conversions), campaign roll-ups, and optimization recommendations. Sub-ops: log result, view analytics, get recommendations.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["log_result", "view_analytics", "top_performers", "recommendations"], description: "Analytics action" },
        platform: { type: "string", description: "Platform filter" },
        post_content: { type: "string", description: "The post content (for log_result)" },
        metrics: {
          type: "object",
          description: "Post performance metrics",
          properties: {
            views: { type: "number" },
            likes: { type: "number" },
            replies: { type: "number" },
            reposts: { type: "number" },
            clicks: { type: "number" },
            bookmarks: { type: "number" },
          },
        },
        date_range: { type: "string", enum: ["today", "week", "month", "all"], description: "Time period for analytics" },
        campaign: { type: "string", description: "Campaign filter" },
      },
      required: ["action"],
    },
  },
};

export const marketingExperimentDefinition: ToolDefinition = {
  type: "function" as const,
  function: {
    name: "marketing_experiment",
    description: "Use when testing a marketing variable (subject line, CTA copy, posting time, image style) on social/email. Captures hypothesis + variants, then determines a winner once results are in. Returns the experiment row with variants, results, and (when available) statistical winner. For one-off creative, use marketing_analytics instead — experiments require ≥2 variants.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "log_result", "get_winner", "list"], description: "Experiment action" },
        experiment_name: { type: "string", description: "Name of the experiment" },
        hypothesis: { type: "string", description: "What you expect to happen" },
        variant_a: { type: "string", description: "First variant content/approach" },
        variant_b: { type: "string", description: "Second variant content/approach" },
        variant_a_metrics: { type: "object", description: "Metrics for variant A" },
        variant_b_metrics: { type: "object", description: "Metrics for variant B" },
        learning: { type: "string", description: "Key takeaway from the experiment" },
        next_action: { type: "string", description: "What to do based on results" },
      },
      required: ["action"],
    },
  },
};

/** All social-marketing-domain definitions, in facade splice order. */
export const socialMarketingDomainDefinitions: ToolDefinition[] = [
  draftSocialPostDefinition,
  manageContentCalendarDefinition,
  marketingAnalyticsDefinition,
  marketingExperimentDefinition,
];
