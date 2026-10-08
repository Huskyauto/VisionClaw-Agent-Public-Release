/**
 * architect-incident-backtest.ts — measure the platform's automated self-repair
 * CATCH-RATE, the way Anthropic Institute's "When AI builds itself" (2026) frames
 * it: their headline internal number is that an automated reviewer "would have
 * caught ~1/3 of the bugs behind past production incidents." VisionClaw already
 * runs that loop (Agentic CI Self-Healer + architect review + jury-decides-and-
 * ships) and records every incident in `repair_incidents`. This backtest turns
 * "the self-repair loop is worth it" from a vibe into a measured percentage, and
 * surfaces the per-classification BLIND SPOTS the loop consistently fails to close.
 *
 * It reuses the same aggregation that powers the /admin/ecosystem-health card
 * (server/lib/self-improvement-metrics.ts) — one source of truth, no drift.
 *
 * Operator-runnable (no prompts, env-configured):
 *   TENANT_ID    tenant to analyze (default 1)
 *   FAIL_UNDER   optional 0..1 catch-rate floor; exit 3 if below (CI gate, off by default)
 *
 * Exit codes: 0 = report produced; 1 = DB/query error; 3 = catch-rate below FAIL_UNDER.
 */
import { summarizeSelfImprovement } from "../server/lib/self-improvement-metrics";

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

async function main() {
  const tenantId = parseInt(process.env.TENANT_ID || "1", 10) || 1;
  const failUnder = process.env.FAIL_UNDER != null && process.env.FAIL_UNDER !== ""
    ? Number(process.env.FAIL_UNDER)
    : null;

  let s;
  try {
    s = await summarizeSelfImprovement(tenantId, { throwOnError: true });
  } catch (e: any) {
    console.error(`[backtest] FAIL — could not query repair_incidents: ${e?.message || e}`);
    process.exit(1);
    return;
  }

  console.log("=".repeat(64));
  console.log(`ARCHITECT / SELF-REPAIR INCIDENT BACKTEST — tenant ${tenantId}`);
  console.log(`(Anthropic Institute 2026 benchmark: ~33% of past incidents catchable)`);
  console.log("=".repeat(64));

  if (s.sampleSize === 0) {
    console.log(`No incidents recorded yet for tenant ${tenantId}. Nothing to backtest.`);
    process.exit(0);
    return;
  }

  console.log(`Incidents analyzed:     ${s.sampleSize} (most recent window)`);
  console.log(`Auto-resolved:          ${s.autoResolved}  (catch-rate ${pct(s.autoResolveRate)})`);
  console.log(`Escalated to owner:     ${s.escalated}  (${pct(s.escalationRate)})`);
  console.log(`Held by safety guard:   ${s.safetyHeld}  (fail-closed — correct, not a miss)`);
  console.log(`30d trend:              ${s.trendDelta >= 0 ? "+" : ""}${Math.round(s.trendDelta * 100)} pts ` +
    `(now ${pct(s.recentResolveRate)} vs prior ${pct(s.priorResolveRate)})`);
  console.log(`Catch-rate vs floor:    ${pct(s.autoResolveRate)} vs ${pct(s.threshold)} ` +
    `${s.breached ? "⚠️  BELOW FLOOR" : "OK"}`);

  console.log("\nBy classification (catch-rate · sample):");
  for (const c of s.byClassification) {
    console.log(`  ${c.classification.padEnd(22)} ${pct(c.resolveRate).padStart(4)} · ${c.total}`);
  }

  // Blind spots: classifications the loop closes WORSE than its own overall rate,
  // with enough sample to be real. These are where to invest next.
  const blind = s.byClassification.filter((c) => c.total >= 3 && c.resolveRate < s.autoResolveRate);
  if (blind.length > 0) {
    console.log("\nBlind spots (below overall catch-rate, sample ≥ 3):");
    for (const c of blind) {
      console.log(`  • ${c.classification} — only ${pct(c.resolveRate)} auto-closed across ${c.total} incidents`);
    }
  } else {
    console.log("\nNo classification-level blind spots (all tiers at/above overall catch-rate).");
  }

  if (failUnder != null && Number.isFinite(failUnder) && s.sampleSize >= 10 && s.autoResolveRate < failUnder) {
    console.error(`\n[backtest] catch-rate ${pct(s.autoResolveRate)} is below FAIL_UNDER ${pct(failUnder)} — failing.`);
    process.exit(3);
    return;
  }
  process.exit(0);
}

main();
