/**
 * Built With Bob — weekly recap publish + durable approval resolution.
 *
 * Shared by the autonomous orchestrator (auto-publish path) and the one-tap
 * email approval routes (`/api/bwb/approve`). Publishing fans out to YouTube
 * (public, tagged) and a NATIVE Facebook Page video via the proven
 * `publishPost` bridge — both download the bytes from the supplied Drive file
 * id (preferred) or fall back to the public https play link.
 *
 * Durable state lives in `agentApprovals` (no new table); the cid contract is
 * `bwb-approval-<approvalId>` so the HMAC HITL token links resolve back to the
 * row.
 */
import { db } from "./db";
import { agentApprovals } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { publishPost } from "./social-publisher";

export interface WeeklyPublishContext {
  kind: "bwb-weekly";
  tenantId: number;
  title: string;
  description: string;
  tags?: string[];
  playlist?: string;
  videoId?: string;
  driveFileId?: string | null;
  videoUrl?: string | null; // public https play link (fallback when no driveFileId)
  deliveryUrl?: string | null;
  projectFileId?: number | null;
}

export interface WeeklyPublishResult {
  youtube: { success: boolean; postUrl?: string; error?: string };
  facebook: { success: boolean; postUrl?: string; error?: string };
}

export const bwbCid = (approvalId: number) => `bwb-approval-${approvalId}`;
export const bwbApprovalIdFromCid = (cid: string): number | null => {
  const m = /^bwb-approval-(\d+)$/.exec(cid || "");
  return m ? Number(m[1]) : null;
};

/**
 * Publish a produced weekly recap to YouTube (public) + Facebook (native video).
 * Never throws — returns per-platform success/error so the caller can report.
 */
export async function publishWeeklyVideo(ctx: WeeklyPublishContext): Promise<WeeklyPublishResult> {
  const videoUrl = ctx.videoUrl || undefined;
  const driveFileId = ctx.driveFileId || undefined;

  const result: WeeklyPublishResult = {
    youtube: { success: false },
    facebook: { success: false },
  };

  if (!videoUrl && !driveFileId) {
    const err = "No driveFileId or videoUrl available to publish.";
    return { youtube: { success: false, error: err }, facebook: { success: false, error: err } };
  }

  try {
    const yt = await publishPost({
      tenantId: ctx.tenantId,
      platform: "youtube",
      content: ctx.description,
      title: ctx.title,
      videoUrl,
      driveFileId,
      tags: ctx.tags,
      privacyStatus: "public",
      campaign: "bwb-weekly",
    });
    result.youtube = { success: yt.success, postUrl: yt.postUrl, error: yt.error };
  } catch (e: any) {
    result.youtube = { success: false, error: e?.message || "youtube publish exception" };
  }

  try {
    const fb = await publishPost({
      tenantId: ctx.tenantId,
      platform: "facebook",
      content: ctx.description,
      title: ctx.title,
      videoUrl,
      driveFileId,
      campaign: "bwb-weekly",
    });
    result.facebook = { success: fb.success, postUrl: fb.postUrl, error: fb.error };
  } catch (e: any) {
    result.facebook = { success: false, error: e?.message || "facebook publish exception" };
  }

  return result;
}

/**
 * Resolve a durable BWB approval (from the one-tap email link or an operator).
 * On approve → publishes. Idempotent: only a `pending` row transitions.
 */
export async function resolveBwbApproval(params: {
  approvalId: number;
  tenantId: number;
  approved: boolean;
  decidedBy?: string;
}): Promise<
  | { ok: false; reason: "not_found" | "already_handled" }
  | { ok: true; approved: false }
  | { ok: true; approved: true; publish: WeeklyPublishResult }
> {
  const [row] = await db
    .update(agentApprovals)
    .set({
      status: params.approved ? "approved" : "rejected",
      decision: { approved: params.approved },
      decidedBy: params.decidedBy ?? "bwb-email-link",
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(agentApprovals.id, params.approvalId),
        eq(agentApprovals.tenantId, params.tenantId),
        eq(agentApprovals.status, "pending"),
        // Defense-in-depth: only ever claim/publish genuine BWB-weekly approval
        // rows. A non-BWB approval (different context.kind) can never be flipped
        // or published through this path, even with a valid id+tenant.
        sql`${agentApprovals.context}->>'kind' = 'bwb-weekly'`,
      ),
    )
    .returning();

  if (!row) {
    // Distinguish "already handled" from "not found / wrong tenant".
    const [exists] = await db
      .select({ id: agentApprovals.id })
      .from(agentApprovals)
      .where(and(eq(agentApprovals.id, params.approvalId), eq(agentApprovals.tenantId, params.tenantId)))
      .limit(1);
    return { ok: false, reason: exists ? "already_handled" : "not_found" };
  }

  if (!params.approved) {
    return { ok: true, approved: false };
  }

  const ctx = (row.context || {}) as Partial<WeeklyPublishContext>;
  const publish = await publishWeeklyVideo({
    kind: "bwb-weekly",
    tenantId: params.tenantId,
    title: ctx.title || "Built With Bob — Weekly Recap",
    description: ctx.description || "",
    tags: ctx.tags,
    playlist: ctx.playlist,
    videoId: ctx.videoId,
    driveFileId: ctx.driveFileId,
    videoUrl: ctx.videoUrl,
    projectFileId: ctx.projectFileId,
  });

  return { ok: true, approved: true, publish };
}
