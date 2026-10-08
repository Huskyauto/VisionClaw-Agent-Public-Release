/**
 * Action Ledger S3 — reconciler core (feature contract:
 * data/feature-contracts/action-ledger/ — spec.md + plan.md § S3).
 *
 * One bounded pass over the ledger's non-terminal debris:
 *   1. SWEEP: stale in-flight rows (`prepared`/`executing` past the threshold —
 *      a crash between prepare and settle) are parked as `unknown`.
 *   2. PROBE: each `unknown` row whose tool has a verify probe is checked for
 *      provider-side proof. Positive proof of commit → settle `committed`
 *      (WITHOUT re-executing anything — this is the "commit-after-timeout"
 *      acceptance path). Affirmative, proven provider failure → settle `failed`.
 *   3. DIGEST: rows that remain `unknown` (no probe, probe found nothing, or
 *      probe errored) are surfaced to the owner digest ONCE (dedup marker in
 *      provider_receipt) and left `unknown` for a human decision. They are
 *      NEVER retried — timeout retries stay disabled until S5's proof gate.
 *
 * By construction this module has NO tool executor in its dependency surface:
 * the reconciler cannot re-execute a side effect even by bug — the strongest
 * form of the "never toward retry" contract stance.
 *
 * Deps are injectable (tests run pure, no pg pool — node-test-db-pool-hang);
 * production deps load via call-time dynamic import in loadDefaultDeps().
 */

import type { VerifyProbe, VerifyProbeResult } from "./action-ledger-probes";
import type { UnknownAttemptRow } from "./action-ledger";

export interface ReconcilerDeps {
  sweepStale: (olderThanMinutes: number, limit: number) => Promise<number>;
  listUnknown: (limit: number) => Promise<UnknownAttemptRow[]>;
  getProbe: (toolName: string) => VerifyProbe | undefined;
  settle: (
    id: number,
    tenantId: number,
    outcome: "committed" | "failed",
    opts?: { providerReceipt?: unknown; error?: string },
  ) => Promise<boolean>;
  markDigested: (id: number, tenantId: number) => Promise<boolean>;
  /** Queue ONE owner-digest line for an unresolvable row. Must not throw hard. */
  queueOwnerDigest: (row: UnknownAttemptRow, note: string) => Promise<void>;
  staleMinutes: number;
  batchLimit: number;
}

export interface ReconcileSummary {
  swept: number;
  scanned: number;
  committed: number;
  failed: number;
  stillUnknown: number;
  digested: number;
  probeErrors: number;
}

export async function reconcileOnce(deps: ReconcilerDeps): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    swept: 0, scanned: 0, committed: 0, failed: 0,
    stillUnknown: 0, digested: 0, probeErrors: 0,
  };

  summary.swept = await deps.sweepStale(deps.staleMinutes, deps.batchLimit);

  const rows = await deps.listUnknown(deps.batchLimit);
  for (const row of rows) {
    summary.scanned++;
    let resolved = false;
    let note = "no verify probe registered for this tool";

    const probe = deps.getProbe(row.toolName);
    if (probe) {
      let res: VerifyProbeResult;
      try {
        res = await probe(row);
      } catch (e: any) {
        summary.probeErrors++;
        res = { outcome: "unknown", note: `probe threw: ${e?.message || e}` };
      }
      if (res.outcome === "committed") {
        // Provider proved the commit — settle WITHOUT re-execution.
        const ok = await deps.settle(row.id, row.tenantId, "committed", {
          providerReceipt: (res as any).receipt ?? { source: "reconciler_probe" },
        });
        if (ok) { summary.committed++; resolved = true; }
        else note = "probe proved commit but settle transitioned no row (already settled?)";
      } else if (res.outcome === "failed" && (res as any).proven === true) {
        // Only an AFFIRMATIVE provider-side failure record settles `failed`.
        const ok = await deps.settle(row.id, row.tenantId, "failed", {
          providerReceipt: (res as any).receipt ?? { source: "reconciler_probe" },
          error: "provider affirmatively recorded failure (reconciler probe)",
        });
        if (ok) { summary.failed++; resolved = true; }
        else note = "probe proved failure but settle transitioned no row";
      } else {
        note = (res as any).note || "probe could not prove an outcome";
      }
    }

    if (!resolved) {
      summary.stillUnknown++;
      if (!row.digestedAt) {
        // Digest ONCE, never retry. Queue first, mark second: a failed mark
        // risks a duplicate digest line next run (annoying), a failed queue
        // with an eager mark risks a silently-buried row (unacceptable).
        try {
          await deps.queueOwnerDigest(row, note);
          const marked = await deps.markDigested(row.id, row.tenantId);
          if (marked) summary.digested++;
        } catch (e: any) {
          console.error(`[al-reconcile] owner-digest queue failed for attempt ${row.id}: ${e?.message || e}`);
        }
      }
    }
  }
  return summary;
}

/** Production deps — call-time dynamic imports keep this module test-safe. */
export async function loadDefaultDeps(overrides: Partial<ReconcilerDeps> = {}): Promise<ReconcilerDeps> {
  const [ledger, probes] = await Promise.all([
    import("./action-ledger"),
    import("./action-ledger-probes"),
  ]);
  const staleMinutes = clampInt(process.env.AL_STALE_MINUTES, 30, 5, 24 * 60);
  const batchLimit = clampInt(process.env.AL_RECONCILE_BATCH, 50, 1, 200);
  return {
    sweepStale: ledger.sweepStaleAttempts,
    listUnknown: ledger.listUnknownAttemptsAllTenants,
    getProbe: probes.getVerifyProbe,
    settle: ledger.settleAttempt,
    markDigested: ledger.markReconcilerDigested,
    queueOwnerDigest: async (row, note) => {
      // Same table + category the owner-digest-flush cron reads
      // (server/attention-handlers/owner-notify.ts precedent).
      const { db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const title = `[action-ledger] unresolved ${row.toolName} attempt #${row.id}`.slice(0, 300);
      const message = JSON.stringify({
        attemptId: row.id, tool: row.toolName, risk: row.risk,
        idempotencyKey: row.idempotencyKey, startedAt: row.startedAt,
        note, decision: "outcome unprovable — needs a human verdict (settle committed/failed or compensate); it will NOT be retried automatically",
      }).slice(0, 2000);
      const metadata = JSON.stringify({ source: "action-ledger-reconciler", attemptId: row.id, toolName: row.toolName });
      await db.execute(sql`
        INSERT INTO notifications (tenant_id, type, title, message, category, metadata)
        VALUES (${row.tenantId}, 'digest', ${title}, ${message}, 'owner_digest', ${metadata}::jsonb)
      `);
    },
    staleMinutes,
    batchLimit,
    ...overrides,
  };
}

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}
