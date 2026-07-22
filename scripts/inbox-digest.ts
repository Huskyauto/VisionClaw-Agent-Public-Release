#!/usr/bin/env tsx
/**
 * Build + send the daily inbox-ingest digest email to OWNER_EMAIL.
 *
 * Env overrides:
 *   INBOX_DIGEST_SINCE_HOURS default 24
 *   INBOX_DIGEST_DRY_RUN     "1" to print instead of sending
 *
 * Designed to run via Replit Scheduled Deployment ~30min after inbox-ingest.
 * Exit codes: 0=success (incl. zero rows), 1=hard failure.
 */
import { buildInboxDigest } from "../server/lib/inbox-ingest";

async function main() {
  const sinceHours = Number(process.env.INBOX_DIGEST_SINCE_HOURS) || 24;
  const dryRun = process.env.INBOX_DIGEST_DRY_RUN === "1";

  const digest = await buildInboxDigest({ sinceHours });
  console.log(`[inbox-digest] built: ${digest.rowCount} rows, subject="${digest.subject}"`);

  if (digest.rowCount === 0) {
    console.log("[inbox-digest] no classifications in window — skipping send");
    process.exit(0);
  }

  if (dryRun) {
    console.log("--- TEXT ---\n" + digest.text);
    process.exit(0);
  }

  const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL || process.env.SITE_CONTACT_EMAIL;
  if (!ownerEmail) {
    console.error("[inbox-digest] no OWNER_EMAIL env var set");
    process.exit(1);
  }

  const { sendEmailDirect } = await import("../server/email");
  await sendEmailDirect({
    to: ownerEmail,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
  });
  console.log(`[inbox-digest] sent to ${ownerEmail}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[inbox-digest] FATAL:", e?.stack || e);
  process.exit(1);
});
