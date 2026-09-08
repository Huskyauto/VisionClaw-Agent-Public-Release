/**
 * Tools-layer-split — scheduled-posts domain tool definitions.
 *
 * Selection: the 2 read/lifecycle scheduled-post tools that read ONLY the
 * `_tenantId` trust signal — `cancel_scheduled_post`, `list_scheduled_posts`.
 * In the legacy facade each was an individual switch arm that dispatched into
 * `./lib/scheduled-post-runner`. The sole trust channel is `_tenantId`, covered
 * by the trusted ToolContext seam. The adjacent producer
 * `schedule_cross_platform_post` (destructive, requireApproval, reads
 * `_personaName`/`_userId`) stays legacy — deferred to a trust-seam slice.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const cancelScheduledPostDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cancel_scheduled_post",
    description: "Cancel a pending scheduled cross-platform post by id. Only works while the post is still 'pending' — already-publishing or already-sent posts cannot be unsent. Returns {ok, cancelled} where cancelled=false means the row was already past the pending state.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "scheduled_posts.id returned by schedule_cross_platform_post." },
      },
      required: ["id"],
    },
  },
};

export const listScheduledPostsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_scheduled_posts",
    description: "List this tenant's scheduled cross-platform posts. Optional status filter (pending | publishing | sent | partial | failed | cancelled). Returns the most recent 50 by default, ordered by scheduled_for DESC. Read-only.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter: pending | publishing | sent | partial | failed | cancelled." },
        limit: { type: "integer", description: "1-200, default 50." },
      },
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const scheduledPostsDomainDefinitions: ToolDefinition[] = [
  cancelScheduledPostDefinition,
  listScheduledPostsDefinition,
];
