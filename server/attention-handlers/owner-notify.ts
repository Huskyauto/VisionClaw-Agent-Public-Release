import { sendEmail, isEmailConfigured } from "../email";
import { db } from "../db";
import { sql } from "drizzle-orm";

const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

// Per-event-type cooldown so a runaway publisher can't spam the inbox.
const COOLDOWN_MS = 5 * 60 * 1000;
const lastSentByType = new Map<string, number>();

// Event types whose audience is an in-app persona (Felix), NOT the human
// owner's email inbox. These still get scored at wake-immediately so they
// surface in the Attention Stream on /home, but they do not page Bob at
// 4:52 AM. Add to this set when a publisher's audience is clearly an
// agent rather than the human.
const FELIX_AUDIENCE_ONLY = new Set([
  // Felix is the sole decision maker on plans — they appear in his queue.
  "plan.proposed",
  "plan.revised",
  // Internal proposal verifier failures are an engineering signal for the
  // research loop, not a customer/revenue issue. Felix routes them.
  "research.experiment.failed",
]);

// For delivery/research events, sanity-check that the referenced row
// actually exists. Orphan references are almost always test fixtures or
// stale events from earlier dev runs, not real production incidents.
async function referencedEntityExists(eventType: string, data: any): Promise<boolean> {
  try {
    if (eventType.startsWith("delivery.") && typeof data?.deliveryId === "number") {
      const r: any = await db.execute(sql`SELECT 1 FROM delivery_logs WHERE id = ${data.deliveryId} LIMIT 1`);
      return ((r.rows || r) as any[]).length > 0;
    }
    if (eventType.startsWith("research.experiment.") && typeof data?.proposalId === "number") {
      const r: any = await db.execute(sql`SELECT 1 FROM code_proposals WHERE id = ${data.proposalId} LIMIT 1`);
      return ((r.rows || r) as any[]).length > 0;
    }
    if (eventType.startsWith("plan.") && typeof data?.planId === "number") {
      const r: any = await db.execute(sql`SELECT 1 FROM plans WHERE id = ${data.planId} LIMIT 1`);
      return ((r.rows || r) as any[]).length > 0;
    }
  } catch {
    // If the existence probe itself fails, fall back to allowing the
    // notification — better a possible false-positive page than a silent
    // miss on a real production incident.
    return true;
  }
  // No id field to check → assume real and allow the email.
  return true;
}

export async function notifyOwnerOfHighSalienceEvent(params: {
  eventId: number;
  eventType: string;
  source: string;
  salienceScore: number;
  data: any;
  meta: any;
}): Promise<{ sent: boolean; reason?: string }> {
  const { eventId, eventType, source, salienceScore, data, meta } = params;

  // Helper: hand a suppressed event to the internal resolver so it
  // doesn't rot in the queue waiting on a human. Best-effort, async,
  // never blocks the publish path.
  const dispatchToResolver = (note: string) => {
    setImmediate(() => {
      import("../internal-resolver")
        .then(({ resolveDroppedEvent }) => resolveDroppedEvent({ eventId, eventType, data }))
        .then((r) => console.log(`[attention] event #${eventId} (${eventType}) ${note} → resolver action=${r.action}${r.details ? ` (${r.details})` : ""}`))
        .catch((err) => console.error(`[attention] resolver dispatch failed for event #${eventId}: ${err?.message || err}`));
    });
  };

  // Audience routing: plan.proposed and similar agent-decision events
  // should reach Felix in-app, not the human owner's email at 3am.
  // Hand off to the internal resolver so the event is actually acted on.
  if (FELIX_AUDIENCE_ONLY.has(eventType)) {
    dispatchToResolver("→ felix audience");
    return { sent: false, reason: "felix_audience_only" };
  }

  // Drop orphan/test-fixture events that reference non-existent rows.
  // Still hand to the resolver for audit-trail logging.
  const exists = await referencedEntityExists(eventType, data);
  if (!exists) {
    console.log(`[attention] Dropping owner email for event #${eventId} (${eventType}) — referenced entity does not exist (orphan/test fixture)`);
    dispatchToResolver("→ orphan reference");
    return { sent: false, reason: "orphan_reference" };
  }

  const last = lastSentByType.get(eventType) || 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return { sent: false, reason: "cooldown" };
  }

  if (!isEmailConfigured()) {
    console.error(
      `[attention] HIGH-SALIENCE event #${eventId} (${eventType}, score=${salienceScore}) — email not configured, logging only`,
      { source, data, meta },
    );
    return { sent: false, reason: "email_not_configured" };
  }

  const summary = JSON.stringify(data || {}, null, 2).slice(0, 1500);
  const subject = `[ATTENTION ${salienceScore}] ${eventType} — ${source}`;
  const text = [
    `🦞 VisionClaw Attention Bus`,
    ``,
    `Event #${eventId} crossed the wake threshold.`,
    ``,
    `Type:    ${eventType}`,
    `Source:  ${source}`,
    `Score:   ${salienceScore} / 100   (rule: ${meta?.rule || "wake_immediately"})`,
    `Revenue at risk: $${meta?.revenueAtRiskUsd || 0}`,
    `Novel in 24h:    ${meta?.novel ? "yes" : "no"}`,
    `Customer-facing: ${meta?.customerFacing ? "yes" : "no"}`,
    ``,
    `Payload:`,
    summary,
    ``,
    `View in dashboard: /home (Attention Stream)`,
  ].join("\n");

  try {
    await (sendEmail as any)({
      to: OWNER_EMAIL,
      subject,
      text,
    });
    lastSentByType.set(eventType, Date.now());
    console.log(`[attention] Owner notified of event #${eventId} (${eventType}, score=${salienceScore})`);
    return { sent: true };
  } catch (err: any) {
    console.error(`[attention] Owner notify failed for event #${eventId}:`, err.message);
    return { sent: false, reason: err.message };
  }
}
