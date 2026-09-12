/**
 * Tools-layer-split S25q — social-marketing-domain migrated handlers.
 *
 * Selection: the 4 contiguous marketing tools — `draft_social_post`,
 * `manage_content_calendar`, `marketing_analytics`, `marketing_experiment`. All
 * backed by `server/social-marketing`, one coherent cluster.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing rules:
 * no renames, no behavior change, no added gate). Each legacy arm was a uniform
 * passthrough: `const { fn } = await import("./social-marketing"); return
 * fn(params as any);`.
 *
 * SEAM (critical — do NOT simplify to a bare `fn(params as any)`):
 *   Three of the four backing fns (`manageContentCalendar`, `marketingAnalytics`,
 *   `marketingExperiment`) read `params._tenantId` THEMSELVES for tenant scoping,
 *   and two of them HARD-REQUIRE it (`if (!tenantId) return { error }`).
 *   `_tenantId` is a dispatcher-STRIPPED trust signal (TRUST_SIGNAL_KEYS in
 *   server/tools/context.ts), so by the time a migrated handler runs it has
 *   already been deleted from `params`. In the legacy `executeTool` switch path
 *   params was NOT stripped, so the backing fns saw the real `_tenantId`. To stay
 *   behavior-identical, each handler RE-STAMPS `_tenantId` from the trusted
 *   `ctx.tenantId` onto the passthrough object: `fn({ ...params, _tenantId:
 *   ctx.tenantId })`. The dispatcher derives `ctx.tenantId` from the same
 *   pre-strip `params._tenantId` the legacy arm carried, so this reconstructs the
 *   exact legacy input (incl. the undefined-tenant → error branch when absent).
 *   `draft_social_post`'s backing fn declares but never READS `_tenantId`; it is
 *   re-stamped uniformly anyway (harmless — ignored downstream — and future-proof
 *   if that fn ever starts scoping by tenant).
 *
 * The backing dependency (`../../../social-marketing`) is pulled via call-time
 * dynamic `import(...)` inside each handler — NOT a top-level static import — so
 * the domain module statically imports only within server/tools/ and cannot
 * recurse back into the app graph (acyclicity invariant, plan.md S2).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  draftSocialPostDefinition,
  manageContentCalendarDefinition,
  marketingAnalyticsDefinition,
  marketingExperimentDefinition,
} from "./definitions";

async function draftSocialPostHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { draftSocialPost } = await import("../../../social-marketing");
  return draftSocialPost({ ...params, _tenantId: ctx.tenantId } as any);
}

async function manageContentCalendarHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { manageContentCalendar } = await import("../../../social-marketing");
  return manageContentCalendar({ ...params, _tenantId: ctx.tenantId } as any);
}

async function marketingAnalyticsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { marketingAnalytics } = await import("../../../social-marketing");
  return marketingAnalytics({ ...params, _tenantId: ctx.tenantId } as any);
}

async function marketingExperimentHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const { marketingExperiment } = await import("../../../social-marketing");
  return marketingExperiment({ ...params, _tenantId: ctx.tenantId } as any);
}

/** Registered by ./index.ts at import time. */
export const socialMarketingDomainTools: RegisteredTool[] = [
  defineTool(draftSocialPostDefinition, draftSocialPostHandler),
  defineTool(manageContentCalendarDefinition, manageContentCalendarHandler),
  defineTool(marketingAnalyticsDefinition, marketingAnalyticsHandler),
  defineTool(marketingExperimentDefinition, marketingExperimentHandler),
];
