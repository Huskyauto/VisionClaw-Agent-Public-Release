/**
 * Scheduled-post runner — Round A of the self-hosted multi-platform scheduler.
 *
 * Pulls due rows from `scheduled_posts`, locks them with SELECT ... FOR UPDATE
 * SKIP LOCKED so two heartbeat ticks (or a heartbeat + an ad-hoc admin run)
 * can never double-publish, fans out to `publishPost` per platform, records
 * per-platform results, and applies exponential backoff on retries.
 *
 * Failure semantics:
 *   - At least one platform succeeds AND any failed → status='partial' (no retry)
 *   - All platforms succeed → status='sent'
 *   - All platforms fail → attempts++; if attempts<max → status='pending' with
 *     next_attempt_at = now() + backoff; else status='failed'
 *
 * Tenant isolation: every UPDATE pins by id; SELECT pins by id+tenant_id when
 * cancelling. The runner itself is system-scope (admin tenant context) so it
 * can fire across tenants — publishPost still resolves the OAuth token from
 * the row's tenant_id.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { publishPost } from "../social-publisher";
import { logSilentCatch } from "./silent-catch";

// R113.6 Round B — Facebook + YouTube wired. YouTube is video-only (no public
// Data API surface for text-only posts), so we require a videoUrl/driveFileId
// at schedule time. Facebook posts to the first managed Page (or a pageId
// override) using the user's Graph token + pages_manage_posts scope.
const SUPPORTED_PLATFORMS = new Set(["x", "linkedin", "instagram", "facebook", "youtube", "threads", "pinterest"]);
const VIDEO_REQUIRED_PLATFORMS = new Set(["youtube"]);
// R115.4 — Instagram + Pinterest are image-first publishers. Without an
// https imageUrl up-front, the publish step deterministically fails. Reject
// at schedule time (mirrors the VIDEO_REQUIRED_PLATFORMS guard).
const IMAGE_REQUIRED_PLATFORMS = new Set(["instagram", "pinterest"]);
const MAX_BATCH_PER_TICK = 10;
const BACKOFF_BASE_SECONDS = 60;

export interface RunResult {
  picked: number;
  sent: number;
  partial: number;
  failed: number;
  retried: number;
  errors: number;
}

function backoffSeconds(attempts: number): number {
  // 60s, 4min, 16min, 64min — exponential with base 4, capped at 1h.
  const raw = BACKOFF_BASE_SECONDS * Math.pow(4, Math.max(0, attempts - 1));
  return Math.min(raw, 3600);
}

export async function runDueScheduledPosts(): Promise<RunResult> {
  const result: RunResult = { picked: 0, sent: 0, partial: 0, failed: 0, retried: 0, errors: 0 };

  // Pull up to MAX_BATCH_PER_TICK due rows, lock them, flip to 'publishing'
  // atomically in one CTE so a concurrent runner instance sees 0 due rows.
  let due: any[] = [];
  try {
    const picked = await db.execute(sql`
      WITH due AS (
        SELECT id FROM scheduled_posts
        WHERE status = 'pending'
          AND scheduled_for <= NOW()
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY scheduled_for ASC
        LIMIT ${MAX_BATCH_PER_TICK}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE scheduled_posts sp
         SET status = 'publishing',
             locked_at = NOW(),
             locked_by = 'heartbeat',
             updated_at = NOW()
        FROM due
       WHERE sp.id = due.id
      RETURNING sp.id, sp.tenant_id, sp.platforms, sp.content,
                sp.image_url, sp.image_base64, sp.video_url, sp.campaign,
                sp.attempts, sp.max_attempts, sp.per_platform_results
    `);
    due = (picked as any).rows || picked;
  } catch (e: any) {
    if (e.message?.includes("does not exist")) return result; // table not migrated yet
    console.error("[scheduled-post-runner] poll failed:", e.message);
    result.errors++;
    return result;
  }

  if (!due || due.length === 0) return result;
  result.picked = due.length;

  for (const row of due) {
    // Declared at outer scope so the catch block below can read publish state
    // and avoid blindly resetting to 'pending' after a partial publish — that
    // would republish the platforms that already succeeded (architect R113.7+sec
    // post-edit review, MED-HIGH-2: partial-terminal invariant leak on exception).
    const perResults: Record<string, any> = row.per_platform_results || {};
    let okCount = 0;
    let failCount = 0;
    try {
      const platforms: string[] = Array.isArray(row.platforms) ? row.platforms : [];
      const lastErrors: string[] = [];

      for (const platform of platforms) {
        // Skip if this platform already succeeded in a prior attempt — idempotency.
        if (perResults[platform]?.success === true) {
          okCount++;
          continue;
        }
        if (!SUPPORTED_PLATFORMS.has(platform)) {
          perResults[platform] = { success: false, platform, error: `unsupported platform: ${platform}` };
          failCount++;
          lastErrors.push(`${platform}: unsupported`);
          continue;
        }
        try {
          const r = await publishPost({
            tenantId: row.tenant_id,
            platform,
            content: row.content,
            imageBase64: row.image_base64 || undefined,
            imageUrl: row.image_url || undefined,
            videoUrl: row.video_url || undefined,
            campaign: row.campaign || undefined,
          });
          perResults[platform] = r;
          if (r.success) okCount++;
          else {
            failCount++;
            if (r.error) lastErrors.push(`${platform}: ${r.error.slice(0, 200)}`);
          }
        } catch (perr: any) {
          perResults[platform] = { success: false, platform, error: perr?.message || String(perr) };
          failCount++;
          lastErrors.push(`${platform}: ${perr?.message || "exception"}`);
        }
      }

      const attempts = (row.attempts || 0) + 1;
      const maxAttempts = row.max_attempts || 3;
      const allOk = failCount === 0 && okCount > 0;
      const anyOk = okCount > 0;
      const noneOk = okCount === 0;

      let nextStatus: string;
      let nextAttemptAt: Date | null = null;
      if (allOk) {
        nextStatus = "sent";
      } else if (anyOk) {
        // Partial success — no retry (would double-post the succeeded platforms).
        nextStatus = "partial";
      } else if (noneOk && attempts < maxAttempts) {
        nextStatus = "pending";
        nextAttemptAt = new Date(Date.now() + backoffSeconds(attempts) * 1000);
        result.retried++;
      } else {
        nextStatus = "failed";
      }

      // Bind jsonb literal explicitly — Drizzle won't auto-cast a JS object.
      const resultsJson = JSON.stringify(perResults);
      const lastErrorStr = lastErrors.length > 0 ? lastErrors.join(" | ").slice(0, 2000) : null;

      await db.execute(sql`
        UPDATE scheduled_posts
           SET status = ${nextStatus},
               attempts = ${attempts},
               per_platform_results = ${resultsJson}::jsonb,
               last_error = ${lastErrorStr},
               next_attempt_at = ${nextAttemptAt},
               locked_at = NULL,
               locked_by = NULL,
               updated_at = NOW()
         WHERE id = ${row.id}
      `);

      if (nextStatus === "sent") result.sent++;
      else if (nextStatus === "partial") result.partial++;
      else if (nextStatus === "failed") result.failed++;
    } catch (rowErr: any) {
      result.errors++;
      console.error(`[scheduled-post-runner] row ${row.id} failed:`, rowErr.message);
      // Architect R113.7+sec MED-HIGH-2 fix: if ANY platform already published
      // (okCount > 0) we must NOT reset to 'pending' — that double-publishes the
      // succeeded platforms on the next tick. Fail-CLOSED to 'partial' (terminal)
      // and persist what we know. Only revert to 'pending' for retry when zero
      // platforms have succeeded yet.
      const failClosedStatus = okCount > 0 ? "partial" : "pending";
      try {
        const resultsJson = JSON.stringify(perResults);
        await db.execute(sql`
          UPDATE scheduled_posts
             SET status = ${failClosedStatus},
                 per_platform_results = ${resultsJson}::jsonb,
                 locked_at = NULL,
                 locked_by = NULL,
                 last_error = ${`runner-exception: ${rowErr?.message || "unknown"}`.slice(0, 2000)},
                 updated_at = NOW()
           WHERE id = ${row.id} AND status = 'publishing'
        `);
        if (failClosedStatus === "partial") result.partial++;
      } catch (releaseErr) {
        logSilentCatch("server/lib/scheduled-post-runner.ts", releaseErr);
      }
    }
  }

  return result;
}

/**
 * Tenant-scoped API for the chat-tool layer + the calendar UI.
 */
export async function scheduleCrossPlatformPost(params: {
  tenantId: number;
  platforms: string[];
  content: string;
  scheduledFor: string; // ISO
  imageUrl?: string;
  imageBase64?: string;
  videoUrl?: string;
  campaign?: string;
  createdBy?: string;
}): Promise<{ ok: true; id: number; scheduledFor: string } | { ok: false; error: string }> {
  if (!params.tenantId || !Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    return { ok: false, error: "tenantId required" };
  }
  if (!Array.isArray(params.platforms) || params.platforms.length === 0) {
    return { ok: false, error: "platforms must be a non-empty array" };
  }
  const lowered = params.platforms.map((p) => String(p).toLowerCase().trim());
  const unknown = lowered.filter((p) => !SUPPORTED_PLATFORMS.has(p));
  if (unknown.length > 0) {
    return { ok: false, error: `unsupported platforms: ${unknown.join(", ")}. supported: ${Array.from(SUPPORTED_PLATFORMS).join(", ")}` };
  }
  if (!params.content || typeof params.content !== "string" || params.content.trim().length === 0) {
    return { ok: false, error: "content required (non-empty string)" };
  }
  if (params.content.length > 10_000) {
    return { ok: false, error: "content too long (>10000 chars)" };
  }
  const when = new Date(params.scheduledFor);
  if (isNaN(when.getTime())) {
    return { ok: false, error: "scheduledFor must be a valid ISO timestamp" };
  }
  // R113.6 Round B — video-required platforms must carry a videoUrl up-front
  // or the publish step will deterministically fail. Reject at schedule time.
  const needsVideo = lowered.filter((p) => VIDEO_REQUIRED_PLATFORMS.has(p));
  if (needsVideo.length > 0 && !params.videoUrl) {
    return { ok: false, error: `videoUrl required for platforms: ${needsVideo.join(", ")}. YouTube is video-only — the Data API has no text-post endpoint. Provide an https videoUrl (or use the standalone youtube tool with a Drive file id).` };
  }
  if (params.videoUrl && !/^https:\/\//i.test(params.videoUrl)) {
    return { ok: false, error: "videoUrl must be an https URL" };
  }
  // R115.4 — Image-required platforms (Instagram, Pinterest) must carry an
  // imageUrl up-front (mirrors the YouTube videoUrl guard above). Reject at
  // schedule time so users fail fast instead of queueing a deterministic
  // publish failure.
  const needsImage = lowered.filter((p) => IMAGE_REQUIRED_PLATFORMS.has(p));
  if (needsImage.length > 0 && !params.imageUrl) {
    return { ok: false, error: `imageUrl required for platforms: ${needsImage.join(", ")}. Instagram + Pinterest are image-first — the publish step deterministically fails without a public https image. Provide an https imageUrl.` };
  }
  if (params.imageUrl && !/^https:\/\//i.test(params.imageUrl)) {
    return { ok: false, error: "imageUrl must be an https URL" };
  }
  // Build Postgres text[] literal — Drizzle sql`` will NOT auto-cast a JS array.
  const arrLit = `{${lowered.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(",")}}`;
  try {
    const ins = await db.execute(sql`
      INSERT INTO scheduled_posts
        (tenant_id, platforms, content, image_url, image_base64, video_url,
         scheduled_for, campaign, created_by, status)
      VALUES
        (${params.tenantId}, ${arrLit}::text[], ${params.content},
         ${params.imageUrl || null}, ${params.imageBase64 || null},
         ${params.videoUrl || null},
         ${when.toISOString()}::timestamptz, ${params.campaign || null},
         ${params.createdBy || null}, 'pending')
      RETURNING id, scheduled_for
    `);
    const row = ((ins as any).rows || ins)[0];
    return { ok: true, id: row.id, scheduledFor: new Date(row.scheduled_for).toISOString() };
  } catch (e: any) {
    return { ok: false, error: `insert failed: ${e?.message || "unknown"}` };
  }
}

export async function cancelScheduledPost(
  id: number,
  tenantId: number,
): Promise<{ ok: true; cancelled: boolean } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "valid id required" };
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { ok: false, error: "tenantId required" };
  try {
    const r = await db.execute(sql`
      UPDATE scheduled_posts
         SET status = 'cancelled', updated_at = NOW()
       WHERE id = ${id}
         AND tenant_id = ${tenantId}
         AND status = 'pending'
      RETURNING id
    `);
    const rows = (r as any).rows || r;
    return { ok: true, cancelled: (rows?.length || 0) > 0 };
  } catch (e: any) {
    return { ok: false, error: e?.message || "cancel failed" };
  }
}

export async function listScheduledPosts(params: {
  tenantId: number;
  status?: string;
  limit?: number;
}): Promise<{ ok: true; posts: any[] } | { ok: false; error: string }> {
  if (!Number.isInteger(params.tenantId) || params.tenantId <= 0) {
    return { ok: false, error: "tenantId required" };
  }
  const limit = Math.min(Math.max(params.limit || 50, 1), 200);
  try {
    let r;
    if (params.status) {
      r = await db.execute(sql`
        SELECT id, tenant_id, platforms, content, image_url, scheduled_for,
               status, attempts, max_attempts, last_error, per_platform_results,
               campaign, created_by, next_attempt_at, created_at, updated_at
          FROM scheduled_posts
         WHERE tenant_id = ${params.tenantId} AND status = ${params.status}
         ORDER BY scheduled_for DESC
         LIMIT ${limit}
      `);
    } else {
      r = await db.execute(sql`
        SELECT id, tenant_id, platforms, content, image_url, scheduled_for,
               status, attempts, max_attempts, last_error, per_platform_results,
               campaign, created_by, next_attempt_at, created_at, updated_at
          FROM scheduled_posts
         WHERE tenant_id = ${params.tenantId}
         ORDER BY scheduled_for DESC
         LIMIT ${limit}
      `);
    }
    return { ok: true, posts: (r as any).rows || r };
  } catch (e: any) {
    return { ok: false, error: e?.message || "list failed" };
  }
}

export function getSupportedPlatforms(): string[] {
  return Array.from(SUPPORTED_PLATFORMS);
}
