#!/usr/bin/env tsx
/**
 * Sweep Gmail (allowlisted senders, last N days), classify each new message,
 * route to its destination (BWB ideas / capability_gaps / competitor_changes /
 * log-only), and print a JSON summary.
 *
 * Env overrides:
 *   INBOX_SINCE_DAYS   default 2 (overlap buffer for daily cron)
 *   INBOX_MAX_MESSAGES default 100
 *   INBOX_DRY_RUN      "1" to skip writes
 *
 * Designed to be run via Replit Scheduled Deployment on a daily cron.
 * Exit codes: 0=success (incl. zero new), 1=hard failure (auth/network).
 */
import { ingestGmailInbox } from "../server/lib/inbox-ingest";

async function main() {
  const sinceDays = Number(process.env.INBOX_SINCE_DAYS) || 2;
  const maxMessages = Number(process.env.INBOX_MAX_MESSAGES) || 100;
  const dryRun = process.env.INBOX_DRY_RUN === "1";

  console.log(`[inbox-ingest] starting (sinceDays=${sinceDays}, maxMessages=${maxMessages}, dryRun=${dryRun})`);
  const summary = await ingestGmailInbox({ sinceDays, maxMessages, dryRun });
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors.some(e => e.where === "auth")) {
    console.error("[inbox-ingest] FATAL: auth error — fix and retry");
    process.exit(1);
  }
  console.log(`[inbox-ingest] done: ${summary.newlyStored} new / ${summary.classified} classified / ${summary.errors.length} errors / ${summary.durationMs}ms`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[inbox-ingest] FATAL:", e?.stack || e);
  process.exit(1);
});
