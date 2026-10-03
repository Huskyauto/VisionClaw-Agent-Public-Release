/**
 * Boot-time reconciler: ensure every known wedge track has its tracker
 * project row (tag `wedge:<slug>`) in this environment's database.
 *
 * Why this exists: the one-shot wire scripts (scripts/wire-*.ts) only ever
 * run against the DEV database. Production's database is separate and
 * read-only from the workspace, so a newly wired wedge shows a red
 * "Wedge not wired" card on the deployed app until its project row exists
 * there. This reconciler self-heals that on the next production boot.
 *
 * Scope is deliberately minimal and idempotent:
 *   - INSERT the tracker project only if no project with the wedge tag
 *     exists for the admin tenant. Never updates or deletes existing rows.
 *   - No Drive folders, brain files, or knowledge indexing here — those are
 *     dev-side concerns handled by the wire scripts (prod FS is ephemeral).
 *   - No heartbeat seeding here — wedge heartbeat prompts invoke
 *     `npx tsx scripts/...` which is broken in the prod image; seeding them
 *     in prod would create failing crons.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

const ADMIN_TENANT_ID = 1;

// Keep in lockstep with the WEDGES list in server/routes/admin-wedges.ts
// and the wire scripts. Tags mirror what scripts/wire-*.ts write.
const WEDGE_TRACKERS: { slug: string; name: string; tags: string[]; description: string }[] = [
  {
    slug: "audit-pro",
    name: "Wedge: AI-Native Readiness Audit Pro",
    tags: ["wedge:audit-pro", "wedge", "stage:validation", "track:isenberg-portfolio"],
    description: "Tracker for the Audit Pro wedge ($299 one-shot).",
  },
  {
    slug: "built-with-x",
    name: "Wedge: Built-With-X Channel-in-a-Box",
    tags: ["wedge:built-with-x", "wedge", "stage:validation", "track:agent-originals"],
    description: "Tracker for the Built-With-X wedge ($99-$999/mo).",
  },
  {
    slug: "youtube-portfolio-ops",
    name: "Wedge: YouTube Portfolio Ops",
    tags: ["wedge:youtube-portfolio-ops", "wedge", "stage:validation", "track:isenberg-iotd"],
    description: "Tracker for the YouTube Portfolio Ops wedge ($199-$999/mo).",
  },
  {
    slug: "smart-leads",
    name: "Wedge: Smart Leads, Zero Research",
    tags: ["wedge:smart-leads", "wedge", "stage:validation", "track:isenberg-iotd"],
    description: "Tracker for the Smart Leads, Zero Research wedge ($99-$499/mo). Dossiers drafted by a 3-frontier-model ensemble; SOP at data/output-skills/wedge-smart-leads-sop.md.",
  },
];

// Arbitrary but stable app-wide lock key for wedge tracker reconciliation.
// pg_advisory_xact_lock serializes concurrent boots (e.g. overlapping dev
// restarts or multiple prod instances) so the check-then-insert cannot race.
const WEDGE_RECONCILE_LOCK_KEY = 0x57454447; // "WEDG"

export async function reconcileWedgeTrackerProjects(): Promise<{ created: number }> {
  let created = 0;
  await db.transaction(async (tx) => {
    // Held until COMMIT; a second booting instance blocks here and then
    // sees the first instance's inserts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WEDGE_RECONCILE_LOCK_KEY})`);
    for (const w of WEDGE_TRACKERS) {
      const tag = `wedge:${w.slug}`;
      const res: any = await tx.execute(sql`
        INSERT INTO projects (tenant_id, name, description, status, tags)
        SELECT ${ADMIN_TENANT_ID}, ${w.name}, ${w.description}, 'active', ARRAY[${sql.join(w.tags.map((t) => sql`${t}`), sql`, `)}]::text[]
        WHERE NOT EXISTS (
          SELECT 1 FROM projects
          WHERE tenant_id = ${ADMIN_TENANT_ID} AND ${tag} = ANY(tags)
        )
      `);
      const n = (res as any).rowCount ?? ((res as any).rows?.length ?? 0);
      if (n > 0) {
        created++;
        console.log(`[wedge-reconcile] created missing tracker project for ${tag}`);
      }
    }
  });
  return { created };
}
