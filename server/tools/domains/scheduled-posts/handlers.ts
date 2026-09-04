/**
 * Tools-layer-split — scheduled-posts-domain migrated handlers.
 *
 * The 2 read/lifecycle scheduled-post tools. In the legacy facade each was an
 * individual switch arm that dispatched into `./lib/scheduled-post-runner`.
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (no renames, no
 * behavior change, no added gate). The ONLY edits: the caller-supplied
 * `params._tenantId` read becomes `ctx.tenantId` (the dispatcher strips +
 * re-stamps it from the trusted context), and the dynamic-import specifier is
 * re-based from the facade's `./lib/scheduled-post-runner` to
 * `../../../lib/scheduled-post-runner`. VERIFIED SAFE: the runner fns
 * (`cancelScheduledPost`, `listScheduledPosts`) read the tenant solely via the
 * explicit `tenantId` arg and read NO `_`-prefixed trust signal, so the
 * dispatcher-stripped `params` is behavior-neutral. The sole external
 * dependency is pulled via a call-time dynamic `import(...)` inside each handler
 * (acyclicity invariant, plan.md S2; same seam as the finance/crm domains).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  cancelScheduledPostDefinition,
  listScheduledPostsDefinition,
} from "./definitions";

async function cancelScheduledPostHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for cancel_scheduled_post" };
  try {
    const { cancelScheduledPost } = await import("../../../lib/scheduled-post-runner");
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "id must be a positive integer" };
    return await cancelScheduledPost(id, ctx.tenantId);
  } catch (e: any) {
    return { ok: false, error: e?.message || "cancel_scheduled_post failed" };
  }
}

async function listScheduledPostsHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { ok: false, error: "Tenant context required for list_scheduled_posts" };
  try {
    const { listScheduledPosts } = await import("../../../lib/scheduled-post-runner");
    return await listScheduledPosts({
      tenantId: ctx.tenantId,
      status: params.status ? String(params.status) : undefined,
      limit: params.limit ? Number(params.limit) : undefined,
    });
  } catch (e: any) {
    return { ok: false, error: e?.message || "list_scheduled_posts failed" };
  }
}

/** Registered by ./index.ts at import time. */
export const scheduledPostsDomainTools: RegisteredTool[] = [
  defineTool(cancelScheduledPostDefinition, cancelScheduledPostHandler),
  defineTool(listScheduledPostsDefinition, listScheduledPostsHandler),
];
