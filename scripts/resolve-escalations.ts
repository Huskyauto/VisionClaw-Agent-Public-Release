/**
 * Escalation resolver runner — drives the backlog of stuck/escalated
 * repair_incidents to a terminal state (accept / reject / fix) via the jury,
 * with Felix (the CEO persona) as a final non-destructive reviewer on the
 * residue the jury could neither clear nor confirm.
 *
 * This script NEVER applies code itself and NEVER weakens a guard — it only
 * feeds the EXISTING decision + safety machinery (see
 * server/agentic/escalation-resolver.ts for the full invariant list):
 *   · juryTriage decides; mapJuryDecision + enforceSafetyRouting route.
 *   · Code is only ever touched via the jury-UNANIMOUS-FIX → repo_surgeon path,
 *     itself gated by REPAIR_AUTOFIX_ENABLED + typecheck/rollback/HITL.
 *   · ACCEPT/REJECT close only the ledger row (reversible, fully recorded).
 *   · Bounded per run so a 200-deep backlog drains gradually (thundering-herd
 *     lesson), oldest stuck first; Felix-KEPT items skip for recheckDays.
 *
 * SAFE-BY-DEFAULT: with no flags the resolver runs in DRYRUN (classify + log,
 * write nothing). It only acts for real when ESCALATION_RESOLVER_LIVE=true. Even
 * a dryRun calls the MoA jury per incident (real spend), so EVERY run is gated by
 * the autonomous-spend governor: if today's tenant spend has hit the daily cap
 * the run is refused before any LLM call.
 *
 * Usage: npx tsx scripts/resolve-escalations.ts [--once]
 *   ESCALATION_RESOLVER_DISABLED=true   kill switch (idle, do nothing)
 *   ESCALATION_RESOLVER_LIVE=true       act for real (default: dryRun preview)
 *   ESCALATION_RESOLVER_DRYRUN=true     force dryRun even if LIVE is set
 *   ESCALATION_RESOLVER_MAX_PER_RUN     per-run cap (default 5)
 *   ESCALATION_RESOLVER_RECHECK_DAYS    skip Felix-KEPT items for N days (default 7)
 *   ESCALATION_RESOLVER_POLL_SECONDS    loop interval (default 900)
 *   ESCALATION_RESOLVER_TENANT_ID       tenant to sweep (default 1)
 *   AUTONOMOUS_DAILY_BUDGET_USD         daily autonomous-spend cap (default 25)
 *   REPAIR_AUTOFIX_ENABLED=1            repo-surgeon actually applies unanimous FIX
 *
 * Exit codes: 0 success (one-shot), 1 fatal.
 */

const POLL_SECONDS = Math.max(60, parseInt(process.env.ESCALATION_RESOLVER_POLL_SECONDS || "900", 10) || 900);
const TENANT_ID = Math.max(1, parseInt(process.env.ESCALATION_RESOLVER_TENANT_ID || "1", 10) || 1);

async function runOnce() {
  const { resolveEscalationBacklog } = await import("../server/agentic/escalation-resolver");
  const r = await resolveEscalationBacklog({ tenantId: TENANT_ID });
  if (!r.ran) {
    console.log(`[escalation-resolver] skipped: ${r.skippedReason}`);
    return r;
  }
  console.log(
    `[escalation-resolver] done${r.dryRun ? " (DRYRUN)" : ""}: considered=${r.considered} ` +
      `accepted=${r.closedAccepted} rejected=${r.closedRejected} dispatchedFix=${r.dispatchedFix} ` +
      `keptForHuman=${r.keptForHuman} errors=${r.errors}`,
  );
  for (const it of r.items) {
    console.log(`  · #${it.incidentId} → ${it.outcome} (by ${it.decidedBy}${it.juryVerdict ? `, jury ${it.juryVerdict}` : ""})`);
  }
  return r;
}

async function main() {
  const oneshot = process.argv.includes("--once");
  const live = process.env.ESCALATION_RESOLVER_LIVE === "true" && process.env.ESCALATION_RESOLVER_DRYRUN !== "true";
  console.log(
    `[escalation-resolver] start (oneshot=${oneshot}, tenant=${TENANT_ID}, ` +
      `mode=${live ? "LIVE" : "DRYRUN (safe-by-default)"}, ` +
      `autofix=${process.env.REPAIR_AUTOFIX_ENABLED === "1" ? "ON" : "OFF"}, ` +
      `dailyCapUsd=${process.env.AUTONOMOUS_DAILY_BUDGET_USD || "25"})`,
  );

  if (oneshot) {
    await runOnce();
    process.exit(0);
  }

  for (;;) {
    try {
      await runOnce();
    } catch (e) {
      console.error(`[escalation-resolver] tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

// Only run when invoked directly (so tests can import the module safely).
if (process.argv[1] && /resolve-escalations/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("[escalation-resolver] fatal:", e);
    process.exit(1);
  });
}
