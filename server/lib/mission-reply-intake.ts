// ─────────────────────────────────────────────────────────────────────────────
// Verified Revenue Missions — event-driven reply intake (Task: CPT 5.6 #2).
//
// Shared scan core for BOTH the automated heartbeat task (mission_reply_intake,
// every 15 min, prod-only) and the operator backstop script
// (scripts/mission-reply-scan.ts — the manual reconciliation sweep).
//
// For every LIVE experiment of the tenant with a reply token: Gmail-search the
// token, dedupe by Gmail message id against mission_evidence.external_ref
// (the DB partial unique index is the authoritative backstop), classify with
// the deterministic keyword heuristic, write mission evidence, and PAUSE the
// prospect's outreach enrollment so no further contacts go out to someone who
// already answered.
//
// Fail-closed rules (all fail toward NOT recording / NOT touching sequences):
//  - Gmail module/search failure → no writes for that pass, error surfaced;
//  - message fetch failure → message skipped (retried next pass / manual sweep),
//    never classified from empty text (an empty snippet would classify as
//    positive_reply — i.e. a fetch failure would count as demand);
//  - unmatched sender (no extractable email) → skipped by default
//    (requireSender=true); only the operator script relaxes this, and an
//    unmatched sender NEVER pauses/advances any enrollment either way;
//  - enrollment pause is scoped to (tenant, the experiment's own sequence_id,
//    the matched sender) and only moves rows OUT of 'active'/'paused' — it
//    never resurrects stopped/completed enrollments.
//
// READ-ONLY against Gmail; DB writes: mission_evidence (+rollups via
// addEvidence) and outreach_enrollments status. No FS, no git → prod-safe.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "../db";
import { sql } from "drizzle-orm";
import { addEvidence } from "./revenue-missions";
import {
  classifyReplyRich,
  evidenceTypeForCategory,
  pauseActionForCategory,
  isDemandCategory,
  type ReplyCategory,
  REPLY_CATEGORIES,
} from "./reply-classification";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

function assertTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`mission-reply-intake: invalid tenantId ${tenantId} (fail closed)`);
  }
}

/** Pure. First plausible email address in a From header, lowercased. */
export function extractSenderEmail(from: string): string | null {
  const m = String(from || "").match(/[\w.+-]+@[\w-]+\.[\w.-]*\w/);
  return m ? m[0].toLowerCase() : null;
}

export interface ReplyAssessment {
  contactEmail: string | null;
}

/**
 * Pure fail-closed intake gate for one fetched Gmail message. Returns null
 * when the message must NOT proceed to classification/recording:
 *  - fetchOk=false → a message we couldn't read must never be classified
 *    (an unreadable message must never count as demand);
 *  - no extractable sender email AND requireSender → cannot be matched to a
 *    prospect, so the automated path leaves it for the operator sweep.
 * When requireSender=false (operator sweep), an unmatched sender may still be
 * recorded with contactEmail=null — callers must never touch a sequence
 * without a matched sender.
 */
export function assessReplyMessage(args: {
  fetchOk: boolean;
  from: string;
  snippet: string;
  requireSender?: boolean;
}): ReplyAssessment | null {
  if (!args.fetchOk) return null;
  const contactEmail = extractSenderEmail(args.from);
  if (!contactEmail && args.requireSender !== false) return null;
  return { contactEmail };
}

export interface ReplyScanSummary {
  scannedExperiments: number;
  newEvidence: number;
  pausedEnrollments: number;
  ambiguousForReview: number; // routed to the owner review queue, never demand
  skipped: number; // fetch failures / unmatched senders left for the next pass
  gmailUnavailable: boolean;
  errors: string[];
}

/**
 * One reply-intake pass for a tenant. Cheap when idle: a single SELECT and an
 * immediate return when no live experiments carry reply tokens.
 */
export async function scanMissionReplies(
  tenantId: number,
  opts?: { missionId?: number | null; requireSender?: boolean },
): Promise<ReplyScanSummary> {
  assertTenant(tenantId);
  const summary: ReplyScanSummary = {
    scannedExperiments: 0, newEvidence: 0, pausedEnrollments: 0,
    ambiguousForReview: 0, skipped: 0, gmailUnavailable: false, errors: [],
  };
  const missionFilter = opts?.missionId ?? null;

  const exps = rows(await db.execute(sql`
    SELECT * FROM mission_experiments
    WHERE tenant_id = ${tenantId} AND status = 'live' AND reply_token IS NOT NULL
      ${missionFilter ? sql`AND mission_id = ${missionFilter}` : sql``}
    ORDER BY id
  `));
  if (exps.length === 0) return summary;

  let gmailSearch: (tenantId: number, q: string, max?: number) => Promise<any>;
  let gmailGetMessage: (tenantId: number, id: string) => Promise<any>;
  try {
    ({ gmailSearch, gmailGetMessage } = await import("../google-workspace"));
  } catch (e: any) {
    summary.gmailUnavailable = true;
    summary.errors.push(`gmail module unavailable: ${e?.message ?? e}`);
    return summary; // fail closed — no writes
  }

  // Global per-(tenant, source) dedupe: one Gmail message that matches multiple
  // experiment scans must only ever produce one row. The DB partial unique
  // index (tenant_id, source, external_ref) is the authoritative backstop.
  const seen = new Set(
    rows(await db.execute(sql`
      SELECT external_ref FROM mission_evidence
      WHERE tenant_id = ${tenantId} AND source = 'gmail' AND external_ref IS NOT NULL
    `)).map((r: any) => String(r.external_ref)),
  );

  for (const exp of exps) {
    summary.scannedExperiments += 1;
    const token = String(exp.reply_token);
    let found: any;
    try {
      // Replies quote the token (subject or body footer); inbox only excludes
      // our own sends.
      found = await gmailSearch(tenantId, `"${token}" in:inbox`, 50);
    } catch (e: any) {
      summary.gmailUnavailable = true;
      summary.errors.push(`gmail search failed for exp ${exp.id}: ${e?.message ?? e}`);
      continue; // fail closed for this experiment — nothing written
    }
    const messages: any[] = found?.messages || found?.results || [];
    for (const m of messages) {
      const msgId = String(m.id ?? m.messageId ?? "");
      if (!msgId) continue;

      let fetchOk = false;
      let from = "";
      let subject = "";
      let snippet = "";
      if (!seen.has(msgId)) {
        try {
          const full = await gmailGetMessage(tenantId, msgId);
          from = String(full?.from ?? full?.headers?.from ?? "");
          subject = String(full?.subject ?? full?.headers?.subject ?? "");
          snippet = String(full?.snippet ?? full?.body ?? "").slice(0, 500);
          fetchOk = true;
        } catch (e: any) {
          summary.skipped += 1;
          summary.errors.push(`fetch failed for msg ${msgId} (exp ${exp.id}) — left for next pass: ${e?.message ?? e}`);
          continue; // fail closed — never classify a message we couldn't read
        }
        const assessed = assessReplyMessage({ fetchOk, from, snippet, requireSender: opts?.requireSender });
        if (!assessed) {
          summary.skipped += 1;
          continue; // unmatched sender — operator sweep adjudicates
        }
        // Demand gate (fail closed): an email-shaped From is NOT a match. The
        // sender must belong to an enrollment of THIS experiment's sequence
        // (any status — a completed enrollment's reply is still genuine) before
        // it may count as mission demand. A forwarded/token-leaked message from
        // a stranger is skipped on the automated path; the operator sweep
        // (requireSender=false) may still record it under human adjudication.
        const strict = opts?.requireSender !== false;
        let enrollmentMatched = false;
        if (assessed.contactEmail && exp.sequence_id) {
          enrollmentMatched = rows(await db.execute(sql`
            SELECT id FROM outreach_enrollments
            WHERE tenant_id = ${tenantId} AND sequence_id = ${Number(exp.sequence_id)}
              AND LOWER(contact_email) = ${assessed.contactEmail}
            LIMIT 1
          `)).length > 0;
        }
        if (strict && !enrollmentMatched) {
          summary.skipped += 1;
          continue;
        }
        // Honest taxonomy (CPT 5.6 priority 2b): deterministic rules first
        // (bounce/OOO/unsubscribe/wrong-person/automated/empty), cheap model
        // for the remainder. Every failure path lands on "ambiguous" — a
        // classification failure can NEVER read as demand.
        // Mission-scoped cost attribution (CPT 5.6 priority 4): the model call
        // inside classifyReplyRich lands in agent_cost_ledger with mission_id.
        const { withMissionCostAttribution } = await import("../agentic/cost-ledger");
        const { category } = await withMissionCostAttribution(
          Number(exp.mission_id),
          () => classifyReplyRich({ from, subject, snippet, tenantId }),
        );
        const evidenceType = evidenceTypeForCategory(category);
        const pauseAction = pauseActionForCategory(category);
        // Sequence reaction FIRST, evidence second: if the pause write fails we
        // skip the message entirely (retried next pass) — failing toward
        // "no more sends and no counted demand", never toward "counted demand
        // while outreach stays active". Idempotent on retry (0-row UPDATE).
        // OOO/automated are not human replies → the sequence continues.
        if (enrollmentMatched && pauseAction !== "none") {
          try {
            summary.pausedEnrollments += await pauseEnrollmentForReply({
              tenantId,
              sequenceId: Number(exp.sequence_id),
              contactEmail: assessed.contactEmail!,
              category,
              action: pauseAction,
              replyContent: snippet,
            });
          } catch (e: any) {
            summary.skipped += 1;
            summary.errors.push(`pause failed for ${assessed.contactEmail} (exp ${exp.id}) — message left for next pass: ${e?.message ?? e}`);
            continue; // fail closed — no evidence without the pause
          }
        }
        // Evidence row: demand categories → positive_reply (counts toward
        // proof-of-premise); explicit rejections → negative_reply; everything
        // else (ooo/bounce/automated/wrong_person/not_now/referral/ambiguous)
        // → "other": recorded for dedupe + audit, never counted as demand.
        const ev = await addEvidence({
          tenantId,
          missionId: Number(exp.mission_id),
          experimentId: Number(exp.id),
          type: evidenceType,
          summary: `Reply [${category}] to experiment ${exp.id} from ${from || "unknown"}: ${snippet.slice(0, 200)}`,
          source: "gmail",
          externalRef: msgId,
          contactEmail: assessed.contactEmail ?? undefined,
          raw: { from, subject, snippet, category },
        });
        seen.add(msgId);
        if (ev) summary.newEvidence += 1;
        // Ambiguous high-impact replies go to the owner review queue instead
        // of auto-counting (once, on the first recording — dedupe guards the
        // 15-min cadence). Best-effort: a notify failure never unwinds intake.
        if (ev && category === "ambiguous") {
          summary.ambiguousForReview += 1;
          await notifyOwnerAmbiguousReply({ tenantId, exp, from, subject, snippet, msgId })
            .catch((e: any) => summary.errors.push(`owner review notify failed for msg ${msgId}: ${e?.message ?? e}`));
        }
      } else if (exp.sequence_id) {
        // Already-recorded message: reconciliation still ensures the pause
        // took effect (cheap UPDATE, 0 rows when already handled). Category is
        // re-read from the stored evidence row — no Gmail refetch, no re-model.
        const evRow = rows(await db.execute(sql`
          SELECT contact_email, type, raw FROM mission_evidence
          WHERE tenant_id = ${tenantId} AND source = 'gmail' AND external_ref = ${msgId}
          LIMIT 1
        `))[0];
        const email = evRow?.contact_email ? String(evRow.contact_email).toLowerCase() : null;
        const storedCat = categoryFromEvidenceRow(evRow);
        const action = storedCat ? pauseActionForCategory(storedCat) : null;
        if (email && storedCat && action && action !== "none") {
          summary.pausedEnrollments += await pauseEnrollmentForReply({
            tenantId,
            sequenceId: Number(exp.sequence_id),
            contactEmail: email,
            category: storedCat,
            action,
            replyContent: null,
          });
        }
      }
    }
  }
  return summary;
}

/** Pure: recover a stored ReplyCategory from an evidence row (raw.category
 * first, legacy type mapping as fallback). Unknown/absent → null (no action). */
export function categoryFromEvidenceRow(evRow: any): ReplyCategory | null {
  let raw = evRow?.raw;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const cat = raw?.category;
  if (typeof cat === "string" && (REPLY_CATEGORIES as readonly string[]).includes(cat)) {
    return cat as ReplyCategory;
  }
  // Legacy rows (pre-taxonomy) only carry the binary type.
  if (evRow?.type === "negative_reply") return "not_interested";
  if (evRow?.type === "positive_reply") return "interested";
  return null;
}

/**
 * Stop further contacts to a prospect who replied. action 'pause' → 'paused'
 * (a human decides the follow-up), 'stop' → 'stopped' (permanent). Only
 * transitions rows currently 'active' (or 'paused' when stopping) — never
 * resurrects stopped/completed enrollments; 'paused'→'stopped' is one-way.
 */
export async function pauseEnrollmentForReply(args: {
  tenantId: number;
  sequenceId: number;
  contactEmail: string;
  category: ReplyCategory;
  action: "pause" | "stop";
  replyContent: string | null;
}): Promise<number> {
  const newStatus = args.action === "stop" ? "stopped" : "paused";
  const res = await db.execute(sql`
    UPDATE outreach_enrollments
    SET status = ${newStatus},
        reply_classification = COALESCE(reply_classification, ${args.category}),
        reply_content = COALESCE(reply_content, ${args.replyContent}),
        updated_at = NOW()
    WHERE tenant_id = ${args.tenantId}
      AND sequence_id = ${args.sequenceId}
      AND LOWER(contact_email) = ${args.contactEmail.toLowerCase()}
      AND status = ANY(${args.action === "stop" ? "{active,paused}" : "{active}"}::text[])
    RETURNING id
  `);
  return rows(res).length;
}

/** Best-effort owner review notification for an ambiguous reply (routed via
 * the owner email digest). Never throws into the intake path from callers —
 * they .catch(). */
async function notifyOwnerAmbiguousReply(args: {
  tenantId: number; exp: any; from: string; subject: string; snippet: string; msgId: string;
}): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) return;
  const { sendEmail, isEmailConfigured, getPrimaryInboxId } = await import("../email");
  if (!isEmailConfigured()) return;
  const inboxId = await getPrimaryInboxId();
  if (!inboxId) return;
  await sendEmail({
    inboxId,
    to: ownerEmail,
    subject: `[Mission review] Ambiguous reply on experiment ${args.exp.id} (mission ${args.exp.mission_id})`,
    text:
      `A reply could not be confidently classified and was recorded WITHOUT counting as demand.\n\n` +
      `From: ${args.from || "unknown"}\nSubject: ${args.subject || "(none)"}\nGmail message id: ${args.msgId}\n\n` +
      `Snippet:\n${args.snippet || "(empty)"}\n\n` +
      `If this is real interest, record it manually as demand evidence (positive_reply / call_booked / prospect_agreed_price) on mission ${args.exp.mission_id}. ` +
      `The prospect's outreach sequence has been paused pending your review.`,
  });
}
