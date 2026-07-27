/**
 * A/B test → conversion → auto-SOP loop (R125+14 — Manus agentic gap #3c).
 *
 * Closes the self-improvement loop on REVENUE, not just task success. An agent
 * (Apollo/Teagan) registers an experiment with 2+ variants of an outreach email
 * or landing-page block. Impressions and conversions are recorded per variant.
 * Once an experiment reaches its minimum sample / age, the heartbeat concludes it:
 * picks the winner by conversion rate (with a small-sample guard), writes the
 * winning approach as a reviewable SOP (proposed_skill), and marks it concluded.
 *
 * Built on the existing `experiments` table (category='ab_test'); variant state
 * lives in metadata so no new table is needed.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { experiments, proposedSkills } from "@shared/schema";
import { emitEvent } from "./event-bus";
import { logSilentCatch } from "./lib/silent-catch";

interface Variant {
  label: string;
  content: string;
  impressions: number;
  conversions: number;
}

interface AbMeta {
  kind: "ab_test";
  variants: Variant[];
  wedge?: string | null;
  minSample: number;
  minAgeHours: number;
  startedAt: string;
}

const DEFAULT_MIN_SAMPLE = 30;
const DEFAULT_MIN_AGE_HOURS = 24;

export async function createAbExperiment(p: {
  tenantId: number;
  hypothesis: string;
  variants: { label: string; content: string }[];
  metric?: string;
  wedge?: string | null;
  personaId?: number | null;
  minSample?: number;
  minAgeHours?: number;
}): Promise<{ id: number }> {
  if (!p.variants || p.variants.length < 2) throw new Error("createAbExperiment requires at least 2 variants");
  const meta: AbMeta = {
    kind: "ab_test",
    variants: p.variants.map(v => ({ label: v.label, content: v.content, impressions: 0, conversions: 0 })),
    wedge: p.wedge ?? null,
    minSample: p.minSample ?? DEFAULT_MIN_SAMPLE,
    minAgeHours: p.minAgeHours ?? DEFAULT_MIN_AGE_HOURS,
    startedAt: new Date().toISOString(),
  };
  const [exp] = await db.insert(experiments).values({
    hypothesis: p.hypothesis,
    approach: p.variants.map(v => v.label).join(" vs "),
    category: "ab_test",
    metric: p.metric ?? "conversion_rate",
    status: "running",
    personaId: p.personaId ?? null,
    tenantId: p.tenantId,
    metadata: meta as any,
  }).returning();
  return { id: exp.id };
}

/** Record an impression or conversion for one variant of a running experiment. */
export async function recordAbEvent(
  tenantId: number, experimentId: number, variantLabel: string, kind: "impression" | "conversion",
): Promise<boolean> {
  // R125+14 fix: read-modify-write of the JSON counters must be serialized or
  // concurrent impressions/conversions lost-update each other (skewing the
  // conversion rate and corrupting winner selection). Wrap in a transaction and
  // take a row lock (SELECT ... FOR UPDATE) so concurrent callers queue.
  return await db.transaction(async (tx) => {
    const r: any = await tx.execute(sql`
      SELECT id, metadata FROM experiments
      WHERE id = ${experimentId} AND tenant_id = ${tenantId} AND category = 'ab_test' AND status = 'running'
      LIMIT 1 FOR UPDATE
    `);
    const row = (r.rows ?? r)[0];
    if (!row) return false;
    const meta = row.metadata as AbMeta;
    const variant = meta.variants.find(v => v.label === variantLabel);
    if (!variant) return false;
    if (kind === "impression") variant.impressions++; else variant.conversions++;
    await tx.execute(sql`
      UPDATE experiments SET metadata = ${JSON.stringify(meta)}::jsonb WHERE id = ${experimentId} AND tenant_id = ${tenantId}
    `);
    return true;
  });
}

function conversionRate(v: Variant): number {
  return v.impressions > 0 ? v.conversions / v.impressions : 0;
}

/**
 * Heartbeat-callable. Concludes any running ab_test experiment that has reached
 * its minimum sample AND minimum age: picks the winner, emits an event, and
 * queues the winning content as a reviewable SOP (proposed_skill).
 */
export async function runDueAbExperiments(): Promise<{ checked: number; concluded: number }> {
  let checked = 0, concluded = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT id, tenant_id, hypothesis, metric, persona_id, metadata, created_at
      FROM experiments WHERE category = 'ab_test' AND status = 'running' LIMIT 100
    `);
    const rows = (r.rows ?? r) as any[];
    for (const row of rows) {
      checked++;
      const meta = row.metadata as AbMeta;
      if (!meta?.variants?.length) continue;
      const totalImpressions = meta.variants.reduce((s, v) => s + v.impressions, 0);
      const ageHours = (Date.now() - new Date(meta.startedAt || row.created_at).getTime()) / 3_600_000;
      if (totalImpressions < (meta.minSample ?? DEFAULT_MIN_SAMPLE)) continue;
      if (ageHours < (meta.minAgeHours ?? DEFAULT_MIN_AGE_HOURS)) continue;

      const ranked = [...meta.variants].sort((a, b) => conversionRate(b) - conversionRate(a));
      const winner = ranked[0];
      const runnerUp = ranked[1];
      const lift = runnerUp && conversionRate(runnerUp) > 0
        ? (conversionRate(winner) - conversionRate(runnerUp)) / conversionRate(runnerUp)
        : null;

      await db.execute(sql`
        UPDATE experiments
        SET status = 'concluded',
            outcome = ${`Winner: ${winner.label} (${(conversionRate(winner) * 100).toFixed(1)}% conv)`},
            result_value = ${conversionRate(winner).toFixed(4)}
        WHERE id = ${row.id} AND tenant_id = ${row.tenant_id}
      `);

      // Queue the winning approach as a reviewable SOP so future outreach reuses it.
      try {
        await db.insert(proposedSkills).values({
          tenantId: row.tenant_id,
          name: `A/B winner: ${row.hypothesis}`.slice(0, 120),
          description: `Auto-emitted by the A/B optimizer: the winning ${winner.label} variant for "${row.hypothesis}".`.slice(0, 280),
          body: `WINNING VARIANT (${winner.label}, conv ${(conversionRate(winner) * 100).toFixed(1)}%${lift != null ? `, +${(lift * 100).toFixed(0)}% vs runner-up` : ""}):\n\n${winner.content}`,
          category: meta.wedge ? `sop-${meta.wedge}` : "sop-outreach",
          sourceContext: `ab-optimizer concluded experiment #${row.id}`,
          proposingPersona: "ab-optimizer",
          confidence: 75,
        });
      } catch (e) { logSilentCatch("server/ab-optimizer.ts", e); }

      await emitEvent({
        type: "experiment.concluded", source: "ab-optimizer", tenantId: row.tenant_id,
        data: { experimentId: row.id, winner: winner.label, conversionRate: conversionRate(winner), lift, variants: meta.variants },
      }).catch(e => logSilentCatch("server/ab-optimizer.ts", e));
      concluded++;
    }
  } catch (e) { logSilentCatch("server/ab-optimizer.ts", e); }
  return { checked, concluded };
}
