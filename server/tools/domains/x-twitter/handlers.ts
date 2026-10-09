/**
 * Tools-layer-split S15 — x-twitter-domain migrated handlers.
 *
 * Selection: the 9 `x_*` X/Twitter API tools — `x_post_tweet`,
 * `x_delete_tweet`, `x_get_tweet`, `x_get_mentions`, `x_get_timeline`,
 * `x_search`, `x_like_tweet`, `x_retweet`, `x_get_me`. Adjacent social tools stay
 * legacy per smallest-safe-batch: the scattered marketing social-post tools and
 * the cross-platform scheduler cluster (incl. the destructive, requireApproval
 * `schedule_cross_platform_post`, which reads `_personaName`/`_userId` trust
 * channels outside ToolContext) migrate in a later pass.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, error strings verbatim). The ONLY edits:
 * caller-supplied `params._tenantId` reads become `ctx.tenantId` (the dispatcher
 * strips + re-stamps it from the trusted context) — the six owner-gated tools
 * read it; the three read-only lookups (`x_get_tweet`, `x_get_timeline`,
 * `x_search`) read no trust signal at all (`_ctx`). The sole external dependency
 * (`../../../social-publisher`) is pulled via a call-time dynamic `import(...)`
 * inside each handler — NOT a top-level static import — so the domain module
 * statically imports only within server/tools/ and cannot recurse back into the
 * app graph (acyclicity invariant, plan.md S2; same seam S8/S9/S11/S12/S13/S14
 * used). The `isXConfigured()` gate, the numeric-tweet-id regex, the owner-tenant
 * authorization check, and every clamp are preserved verbatim. No tools.ts
 * module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  xPostTweetDefinition,
  xDeleteTweetDefinition,
  xGetTweetDefinition,
  xGetMentionsDefinition,
  xGetTimelineDefinition,
  xSearchDefinition,
  xLikeTweetDefinition,
  xRetweetDefinition,
  xGetMeDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function xPostTweetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xPostTweet, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X/Twitter API keys not configured." };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_post_tweet" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  if (!params.text) return { error: "text is required" };
  if (params.text.length > 280) return { error: `Tweet too long (${params.text.length}/280 chars)` };
  return xPostTweet(params.text, params.reply_to_id, params.quote_tweet_id);
}

async function xDeleteTweetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xDeleteTweet, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_delete_tweet" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  if (!params.tweet_id || !/^\d+$/.test(params.tweet_id)) return { error: "Valid numeric tweet_id is required" };
  return xDeleteTweet(params.tweet_id);
}

async function xGetTweetHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { xGetTweet, isXConfigured } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  if (!params.tweet_id || !/^\d+$/.test(params.tweet_id)) return { error: "Valid numeric tweet_id is required" };
  return xGetTweet(params.tweet_id);
}

async function xGetMentionsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xGetMentions, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_get_mentions" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  const count = Math.min(Math.max(Number(params.count) || 10, 5), 100);
  return xGetMentions(count);
}

async function xGetTimelineHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { xGetTimeline, isXConfigured } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  if (!params.username || !/^[A-Za-z0-9_]{1,15}$/.test(params.username)) return { error: "Valid username is required (1-15 alphanumeric/underscore chars)" };
  const count = Math.min(Math.max(Number(params.count) || 10, 5), 100);
  return xGetTimeline(params.username, count);
}

async function xSearchHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { xSearchRecent, isXConfigured } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  if (!params.query || params.query.length > 512) return { error: "query is required (max 512 chars)" };
  const count = Math.min(Math.max(Number(params.count) || 10, 10), 100);
  return xSearchRecent(params.query, count);
}

async function xLikeTweetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xLikeTweet, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_like_tweet" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  if (!params.tweet_id || !/^\d+$/.test(params.tweet_id)) return { error: "Valid numeric tweet_id is required" };
  return xLikeTweet(params.tweet_id);
}

async function xRetweetHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xRetweet, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_retweet" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  if (!params.tweet_id || !/^\d+$/.test(params.tweet_id)) return { error: "Valid numeric tweet_id is required" };
  return xRetweet(params.tweet_id);
}

async function xGetMeHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { xGetMe, isXConfigured, getXOwnerTenantId } = await import("../../../social-publisher");
  if (!isXConfigured()) return { error: "X API keys not configured" };
  const tenantId = ctx.tenantId;
  if (!tenantId) return { error: "Tenant context required for x_get_me" };
  if (tenantId !== getXOwnerTenantId() && tenantId !== 1) return { error: "X/Twitter access restricted to account owner." };
  return xGetMe();
}

/** Registered by ./index.ts at import time. */
export const xTwitterDomainTools: RegisteredTool[] = [
  defineTool(xPostTweetDefinition, xPostTweetHandler),
  defineTool(xDeleteTweetDefinition, xDeleteTweetHandler),
  defineTool(xGetTweetDefinition, xGetTweetHandler),
  defineTool(xGetMentionsDefinition, xGetMentionsHandler),
  defineTool(xGetTimelineDefinition, xGetTimelineHandler),
  defineTool(xSearchDefinition, xSearchHandler),
  defineTool(xLikeTweetDefinition, xLikeTweetHandler),
  defineTool(xRetweetDefinition, xRetweetHandler),
  defineTool(xGetMeDefinition, xGetMeHandler),
];
