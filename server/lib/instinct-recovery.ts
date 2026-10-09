import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { activityLog, apiV1ConversationRuns, instinctWebSubmissions } from "@shared/schema";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { instinctLoginTenantId } from "./instinct-login-binding";

const DESIGNATED_REVIEWABLE_FAILURES = new Set([
  "expert_provider_unavailable",
  "expert_context_limit",
  "expert_provider_uncertain",
  "timeout",
  "processing_error",
  "missing_reply",
  "unknown",
]);

export function isRecoverableInstinctFailure(reason: unknown): boolean {
  // Legacy unavailable/context codes can have lost transport-timeout causes.
  // Only new, provenance-preserving settled rejections qualify automatically.
  return reason === "expert_provider_rejected" || reason === "expert_context_rejected";
}

export function isDesignatedReviewableInstinctFailure(reason: unknown): boolean {
  return typeof reason === "string" && DESIGNATED_REVIEWABLE_FAILURES.has(reason);
}

export function instinctFailureExplanation(reason: unknown): string {
  if (reason === "expert_provider_unavailable" || reason === "expert_provider_rejected")
    return "AI services could not finish this request. This is a processing failure, not a permission request.";
  if (reason === "expert_context_limit" || reason === "expert_context_rejected")
    return "The request exceeded the available AI services' context limits. This is not a permission request.";
  if (reason === "timeout")
    return "This turn timed out and its result may be uncertain. Review the exact terminal failure before reopening conversation; do not resend it.";
  if (reason === "expert_provider_uncertain")
    return "An AI request timed out or had an uncertain transport result. The provider may still charge for it. The designated private channel can offer an explicit terminal-failure review; nothing should be replayed automatically.";
  if (isDesignatedReviewableInstinctFailure(reason))
    return "This legacy failure code does not establish whether remote work completed. The private channel may offer an explicit review of the current terminal failure; do not resend it.";
  return "This request did not finish safely. Owner diagnosis is required; do not resend it.";
}

/** Acknowledgement only: retain failed receipts and never launch/replay model work. */
export async function resumeInstinctFailedTurn(
  tenantId: number, conversationId: number, failedAt: string, principalTenantId: number,
  database: Pick<typeof db, "transaction"> = db,
): Promise<"resumed" | "duplicate" | "blocked"> {
  return acknowledgeFailure(tenantId, conversationId, failedAt, principalTenantId, "settled_private_channel_operator", database);
}

/** Only a trusted, independently authenticated platform owner may review ambiguity. */
export async function acknowledgeInstinctFailureAsOwner(
  owner: { tenantId: number; isAdmin: boolean }, conversationId: number, failedAt: string,
  database: Pick<typeof db, "transaction"> = db,
): Promise<"resumed" | "duplicate" | "blocked"> {
  if (owner.tenantId !== ownerTenantId() || owner.isAdmin !== true) return "blocked";
  return acknowledgeFailure(owner.tenantId, conversationId, failedAt, owner.tenantId, "platform_owner_admin", database);
}

/** Explicit private-channel review; this identity is never promoted to owner/admin authority. */
export async function acknowledgeInstinctFailureFromDesignatedLogin(
  tenantId: number, principalTenantId: number, conversationId: number, failedAt: string,
  database: Pick<typeof db, "transaction"> = db,
): Promise<"resumed" | "duplicate" | "blocked"> {
  const designatedTenantId = instinctLoginTenantId();
  if (tenantId !== ownerTenantId() || designatedTenantId === null ||
      principalTenantId !== designatedTenantId || !Number.isSafeInteger(principalTenantId) || principalTenantId <= 0)
    return "blocked";
  return acknowledgeFailure(tenantId, conversationId, failedAt, principalTenantId,
    "designated_channel_operator", database);
}

async function acknowledgeFailure(
  tenantId: number, conversationId: number, failedAt: string, principalTenantId: number,
  reviewAuthority: "settled_private_channel_operator" | "designated_channel_operator" | "platform_owner_admin",
  database: Pick<typeof db, "transaction">,
): Promise<"resumed" | "duplicate" | "blocked"> {
  if (tenantId !== ownerTenantId() || !Number.isSafeInteger(conversationId) || conversationId <= 0 ||
      !Number.isSafeInteger(principalTenantId) || principalTenantId <= 0 ||
      !failedAt || !Number.isFinite(Date.parse(failedAt)) || new Date(failedAt).toISOString() !== failedAt)
    return "blocked";
  return database.transaction(async tx => {
    // Saved channel binding and live API ownership are checked together under
    // locks; callers cannot acknowledge a different thread or a deleted one.
    const locked: any = await tx.execute(sql`
      SELECT r.status, r.failure_reason, r.failed_at
      FROM instinct_web_threads t
      JOIN api_v1_conversation_runs r
        ON r.tenant_id = t.tenant_id AND r.conversation_id = t.conversation_id
      JOIN conversations c ON c.id = r.conversation_id AND c.tenant_id = r.tenant_id
      WHERE t.tenant_id = ${tenantId} AND t.conversation_id = ${conversationId}
        AND t.state = 'ready' AND c.deleted_at IS NULL
      FOR UPDATE OF t, r
    `);
    const run = locked.rows[0];
    const failureAllowed = reviewAuthority === "platform_owner_admin"
      ? typeof run?.failure_reason === "string" && run.failure_reason.length > 0
      : reviewAuthority === "designated_channel_operator"
        ? isDesignatedReviewableInstinctFailure(run?.failure_reason)
        : isRecoverableInstinctFailure(run?.failure_reason);
    if (!run || !failureAllowed || !run.failed_at ||
        new Date(run.failed_at).toISOString() !== failedAt) return "blocked";
    const pending = await tx.select({ id: instinctWebSubmissions.id }).from(instinctWebSubmissions)
      .where(and(eq(instinctWebSubmissions.tenantId, tenantId),
        eq(instinctWebSubmissions.conversationId, conversationId),
        inArray(instinctWebSubmissions.state, ["accepted", "running"]))).limit(1);
    if (pending.length) return "blocked";
    if (run.status === "idle") {
      const audit = await tx.select({ id: activityLog.id }).from(activityLog)
        .where(and(eq(activityLog.tenantId, tenantId),
          eq(activityLog.action, "instinct_failure_acknowledged"),
          eq(activityLog.resourceId, String(conversationId)),
          sql`${activityLog.metadata}->>'failedAt' = ${failedAt}`)).limit(1);
      return audit.length ? "duplicate" : "blocked";
    }
    if (run.status !== "failed") return "blocked";
    const latestStates = reviewAuthority === "designated_channel_operator"
      ? ["accepted", "running", "complete", "failed", "blocked"]
      : ["accepted", "running", "complete", "failed"];
    const latest = await tx.select({ requestId: instinctWebSubmissions.requestId, state: instinctWebSubmissions.state })
      .from(instinctWebSubmissions).where(and(eq(instinctWebSubmissions.tenantId, tenantId),
        eq(instinctWebSubmissions.conversationId, conversationId),
        // Routine recovery ignores a never-claimed blocked form; reviewed recovery
        // requires the latest saved receipt, including blocked receipts, to be failed.
        inArray(instinctWebSubmissions.state, latestStates)))
      .orderBy(desc(instinctWebSubmissions.id)).limit(1);
    if (latest[0]?.state !== "failed") return "blocked";
    await tx.update(apiV1ConversationRuns).set({ status: "idle", updatedAt: new Date() })
      .where(and(eq(apiV1ConversationRuns.tenantId, tenantId),
        eq(apiV1ConversationRuns.conversationId, conversationId), eq(apiV1ConversationRuns.status, "failed")));
    const ownerReviewed = reviewAuthority === "platform_owner_admin";
    await tx.insert(activityLog).values({
      tenantId, actorType: "user",
      actorName: ownerReviewed ? `Platform owner admin (tenant ${principalTenantId})` :
        `Instinct channel operator (tenant ${principalTenantId})`,
      action: "instinct_failure_acknowledged", resourceType: "conversation", resourceId: String(conversationId),
      description: ownerReviewed
        ? "Platform owner reviewed a terminal local failure, including possible remote uncertainty, and reopened conversation. No request was replayed or budget reservation released."
        : reviewAuthority === "designated_channel_operator"
          ? "Designated private-channel operator explicitly reviewed remote uncertainty, possible billing, and partial work, then reopened conversation only. No request was replayed or budget reservation released."
          : "Acknowledged a settled AI rejection and resumed conversation. Original request was not completed or replayed.",
      metadata: {
        failedAt, reason: run.failure_reason, requestId: latest[0].requestId, principalTenantId, ownerReviewed,
        reviewAuthority,
        ...(reviewAuthority === "designated_channel_operator" ? { remoteUncertaintyAcknowledged: true } : {}),
      },
    });
    return "resumed";
  });
}