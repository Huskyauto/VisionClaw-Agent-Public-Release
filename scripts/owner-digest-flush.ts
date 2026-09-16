// ─────────────────────────────────────────────────────────────────────────────
// Owner Notification Digest — daily flush
// ─────────────────────────────────────────────────────────────────────────────
// Bob 2026-06-04 autonomy upgrade ("more autonomous, minimal human touch").
//
// The attention bus (server/event-bus.ts) now routes events into three bands:
//   · score >= 70  → page Bob IMMEDIATELY (true escalations: money, safety,
//                    customer-facing failures). Unchanged.
//   · 40 <= score < 70 → enqueued into the `notifications` table with
//                    category='owner_digest' (this script's input).
//   · score < 40   → not surfaced to the owner at all (unchanged).
//
// This script runs once a day (heartbeat maintenance_script cron, production
// only), collapses every pending digest row into ONE summary email, and marks
// them read. The point is to stop routine, non-urgent signals from paging Bob
// one-at-a-time while keeping true escalations instant.
//
// One-line agent-runnable: no prompts, env-configured, meaningful exit codes:
//   0  success (sent a digest, or nothing pending)
//   1  fatal error (DB or email failure)
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";

const OWNER_EMAIL =
  process.env.OWNER_ALERT_EMAIL ||
  process.env.OWNER_EMAIL ||
  process.env.SITE_OWNER_EMAIL ||
  process.env.SITE_CONTACT_EMAIL ||
  "";

async function main(): Promise<number> {
  // Atomically CLAIM up to 500 unread digest rows by flipping is_read in the
  // same statement that returns them (FOR UPDATE SKIP LOCKED on the inner
  // select). Two overlapping flush runs therefore get disjoint row sets — no
  // duplicate digest email. Tradeoff: if the email send below throws, the
  // claimed rows stay marked-read (not re-sent), but they still live in the
  // table and remain visible in the in-app Attention Stream — acceptable for a
  // best-effort daily digest of routine (non-escalation) signals.
  const res: any = await db.execute(sql`
    UPDATE notifications
    SET is_read = true
    WHERE id IN (
      SELECT id FROM notifications
      WHERE category = 'owner_digest' AND is_read = false
      ORDER BY created_at ASC
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, title, message, category, metadata, created_at
  `);
  const rows: any[] = (res.rows || res) as any[];

  if (!rows.length) {
    console.log("[digest] nothing pending — no digest email sent");
    return 0;
  }

  // Group by event type for a scannable summary.
  const byType = new Map<string, any[]>();
  for (const r of rows) {
    const t = (r.metadata?.eventType as string) || "unknown";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(r);
  }

  const lines: string[] = [
    "🦞 VisionClaw — Daily Owner Digest",
    "",
    `${rows.length} mid-salience notification${rows.length === 1 ? "" : "s"} (score 40–69) batched since the last digest.`,
    "True escalations (score ≥ 70) were paged to you immediately and are NOT in this digest.",
    "",
  ];

  for (const [type, items] of Array.from(byType.entries()).sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`── ${type}  (${items.length}) ──`);
    for (const it of items.slice(0, 25)) {
      const score = it.metadata?.salienceScore ?? "?";
      const source = it.metadata?.source ?? "";
      const when = it.created_at ? new Date(it.created_at).toISOString().replace("T", " ").slice(0, 16) : "";
      lines.push(`  · [${score}] ${when} ${source}`.trimEnd());
      const msg = (it.message || "").replace(/\s+/g, " ").trim();
      if (msg && msg !== "{}") lines.push(`      ${msg.slice(0, 200)}`);
    }
    if (items.length > 25) lines.push(`  …and ${items.length - 25} more of this type.`);
    lines.push("");
  }

  lines.push("View everything: /home (Attention Stream)");
  lines.push("");
  lines.push("— VisionClaw Owner Digest (daily; routine signals only, no spam)");

  const subject = `[DIGEST] ${rows.length} notification${rows.length === 1 ? "" : "s"} — ${new Date().toISOString().slice(0, 10)}`;
  const text = lines.join("\n");

  if (!OWNER_EMAIL) {
    console.warn("[digest] no OWNER_*_EMAIL configured — marking rows read without sending");
  } else {
    const inboxResult = await getOrCreateTenantInbox(1);
    const inboxId =
      typeof inboxResult === "string"
        ? inboxResult
        : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({ inboxId, to: OWNER_EMAIL, subject, text });
    console.log(`[digest] sent digest of ${rows.length} notifications to ${OWNER_EMAIL}`);
  }

  // Rows were already claimed (is_read=true) atomically at the top, so there is
  // no second mark-read pass and no double-send window.
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[digest] FATAL: ${err?.message || err}`);
    process.exit(1);
  });
