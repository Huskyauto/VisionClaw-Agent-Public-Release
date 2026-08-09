/**
 * Daily lead nurture — runs each morning, surfaces stale waitlist leads.
 *
 * For each lead in the waitlist that hasn't been contacted in 7+ days, generates
 * a personalized nurture email draft using the wedge-specific persona voice
 * and queues it in `lead_nurture_drafts` for Bob's review. NEVER auto-sends —
 * always Bob-in-the-loop on first contact.
 *
 * Designed for Replit Scheduled Deployment (daily 09:00 America/New_York).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TENANT_ID = 1;
const STALE_DAYS = 7;
const MAX_DRAFTS_PER_RUN = 20;

(async () => {
  console.log("[nurture] scanning for stale leads…");

  // Ensure draft table exists (idempotent)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lead_nurture_drafts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      wedge_slug TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_lnd_status ON lead_nurture_drafts(tenant_id, status)`);

  // Find stale leads with no pending draft
  let staleRes: any;
  try {
    staleRes = await db.execute(sql`
      SELECT l.id, l.email, l.name, l.tags, l.created_at, l.last_contacted_at
      FROM leads l
      WHERE l.tenant_id = ${TENANT_ID}
        AND (l.last_contacted_at IS NULL OR l.last_contacted_at < NOW() - (${STALE_DAYS} * INTERVAL '1 day'))
        AND NOT EXISTS (
          SELECT 1 FROM lead_nurture_drafts d
          WHERE d.lead_id = l.id AND d.status = 'pending_review'
        )
      ORDER BY COALESCE(l.last_contacted_at, l.created_at) ASC
      LIMIT ${MAX_DRAFTS_PER_RUN}
    `);
  } catch (e: any) {
    console.warn(`[nurture] leads query failed (table may not exist yet): ${e.message}`);
    process.exit(0);
  }
  const stale = staleRes.rows || staleRes;
  console.log(`[nurture] ${stale.length} stale leads`);

  if (stale.length === 0) {
    process.exit(0);
  }

  // Generate drafts (template-driven; LLM personalization optional)
  let queued = 0;
  for (const lead of stale) {
    const tags: string[] = lead.tags || [];
    const wedge =
      tags.find((t) => t === "audit-pro") ||
      tags.find((t) => t === "built-with-x") ||
      tags.find((t) => t === "youtube-portfolio-ops") ||
      "general";

    const { subject, body } = draftFor(wedge, lead.name || lead.email);
    await db.execute(sql`
      INSERT INTO lead_nurture_drafts (tenant_id, lead_id, wedge_slug, subject, body)
      VALUES (${TENANT_ID}, ${lead.id}, ${wedge}, ${subject}, ${body})
    `);
    queued++;
  }
  console.log(`[nurture] queued ${queued} drafts for review`);
  console.log(`[nurture] review queue: SELECT id, wedge_slug, subject FROM lead_nurture_drafts WHERE status='pending_review';`);
  process.exit(0);
})().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});

function draftFor(wedge: string, name: string): { subject: string; body: string } {
  const first = name.split(/[\s@]/)[0] || "there";
  switch (wedge) {
    case "audit-pro":
      return {
        subject: "Quick question on your AI readiness",
        body: `Hi ${first},\n\nSaw you signed up for the AI-Native Readiness Audit. We're opening up the paid tier in two weeks — it includes a live agent walkthrough of your stack + a 30-page report + 90 days of monitoring.\n\nBefore we lock the launch, mind sharing the one AI question keeping you up at night? It'll shape what we ship.\n\n—Bob`,
      };
    case "built-with-x":
      return {
        subject: "Your channel-in-a-box is closer than you think",
        body: `Hi ${first},\n\nYou signed up for Built-With-X. Quick context: I'm running my own channel through this exact stack right now (Built With Bob — went from idea to first revenue in 6 weeks). Happy to record a short Loom showing the workflow if useful.\n\nWhat's the story you want to turn into a channel?\n\n—Bob`,
      };
    case "youtube-portfolio-ops":
      return {
        subject: "How many channels are you running?",
        body: `Hi ${first},\n\nThanks for the YouTube Portfolio Ops signup. We're at the design-partner stage and looking for 5 multi-channel operators (3+ channels, $20K+/mo aggregate) to test the agent on real portfolios for free in exchange for case-study material.\n\nWorth a 20-min call?\n\n—Bob`,
      };
    default:
      return {
        subject: "Thanks for signing up",
        body: `Hi ${first},\n\nQuick check-in on your waitlist signup. What problem were you hoping we'd solve? Your answer literally shapes what ships first.\n\n—Bob`,
      };
  }
}
