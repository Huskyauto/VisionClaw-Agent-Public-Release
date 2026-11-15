import { sql } from "drizzle-orm";
import { db, getRlsEnforcementReceipt } from "./db";
import { isProductionRuntime } from "./lib/runtime-env";
import { captureDeployedVerifierSource } from "./lib/workspace-verifier-source-artifact";
import { scopedTransactionObservation } from "./lib/rls-observation";
import { summarizeSecurityReview, type SecurityReviewObservation } from "./lib/staged-security-review-policy";

const KIND = "security_review_observation";
const rows = (r: any): any[] => r.rows ?? r;
let busy = false;
let bootTimer: NodeJS.Timeout | undefined, timer: NodeJS.Timeout | undefined;

/** One owner-only record/day; observations are not runnable queue work. */
export async function recordSecurityReviewObservation(): Promise<void> {
  if (busy || !isProductionRuntime() || process.env.SECURITY_REVIEW_OBSERVATION_ENABLED !== "1") return;
  busy = true;
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const counters = scopedTransactionObservation();
    const observation: SecurityReviewObservation = {
      observedAt: now.toISOString(), sourceHash: captureDeployedVerifierSource().hash,
      rls: await getRlsEnforcementReceipt(), scopedTransactions: counters.started,
    };
    const summary = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(137307, 1)`);
      const prior = rows(await tx.execute(sql`SELECT id,payload FROM agent_jobs
        WHERE tenant_id=1 AND kind=${KIND} ORDER BY created_at DESC LIMIT 32`));
      const today = prior.find(r => r.payload?.day === day);
      const earlier: SecurityReviewObservation[] = prior
        .filter(r => r.payload?.day !== day).map(r => r.payload?.observation).filter(Boolean);
      // Retain the first daily timestamp so periodic refreshes do not move
      // the seven-day start forward. Preserve the latest aggregate counters.
      if (today?.payload?.observation?.observedAt)
        observation.observedAt = today.payload.observation.observedAt;
      observation.sourceChanged = today?.payload?.observation?.sourceChanged === true
        || (today !== undefined && today.payload?.observation?.sourceHash !== observation.sourceHash);
      observation.availabilityUnproven = today?.payload?.observation?.availabilityUnproven === true
        || today?.payload?.observation?.rls?.available === "unknown"
        || today?.payload?.observation?.rls?.available === "unavailable"
        || observation.rls.available !== "available";
      const report = summarizeSecurityReview([...earlier, observation], now);
      const payload = JSON.stringify({ version: 1, day, observation, counters, report,
        scope: "catalog_and_scoped_transaction_observation_only", lastObservedAt: now.toISOString() });
      if (today) await tx.execute(sql`UPDATE agent_jobs SET payload=${payload}::jsonb
        WHERE id=${today.id} AND tenant_id=1 AND kind=${KIND} AND status='succeeded'`);
      else await tx.execute(sql`INSERT INTO agent_jobs
        (tenant_id,kind,status,payload,attempts,max_attempts,created_at,completed_at)
        VALUES (1,${KIND},'succeeded',${payload}::jsonb,0,1,${now},${now})`);
      return report;
    });
    console.info(`[security-review] ${JSON.stringify(summary)}`);
  } catch {
    console.error("[security-review] observation unavailable; no security clearance or enforcement change");
  } finally { busy = false; }
}

export function startSecurityReviewObserver(): void {
  if (timer || bootTimer || !isProductionRuntime()
    || process.env.SECURITY_REVIEW_OBSERVATION_ENABLED !== "1") return;
  bootTimer = setTimeout(() => {
    bootTimer = undefined;
    void recordSecurityReviewObservation();
    timer = setInterval(() => { void recordSecurityReviewObservation(); }, 6 * 3600_000);
    timer.unref();
  }, 60_000);
  bootTimer.unref();
  console.info("[security-review] seven-day report-only observation armed; enforcement requires separate owner approval");
}
