import { type Express, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { pool } from "../db";
import {
  analyzeLoopConvergence,
  recommendLoopAllocation,
  type LoopOutcomeObservation,
} from "../lib/loop-portfolio-core";
import {
  appendLoopGraphEdge,
  appendLoopOutcome,
  listLoopGraph,
  type LoopPortfolioQueryable,
} from "../lib/loop-portfolio-store";
import {
  normalizeDreamReplayOptions,
  runDreamResearchReplay,
} from "../lib/dream-rsi-research";

type LoopPortfolioHelpers = {
  authMiddleware: any;
  mutateLimiter: any;
  getTenantFromRequest: (req: Request) => number | null;
  isAdminRequest: (req: Request) => boolean;
  ADMIN_TENANT_ID: number;
  db?: LoopPortfolioQueryable;
};

function asObservation(row: any): LoopOutcomeObservation {
  return {
    loopKind: row.loop_kind,
    policyVersion: row.policy_version,
    occurredAt: new Date(row.occurred_at).toISOString(),
    quality: Number(row.quality),
    costUsd: Number(row.cost_usd),
    latencyMs: Number(row.latency_ms),
    safetyPassed: Boolean(row.safety_passed),
    safetyEvaluated: Boolean(row.safety_evaluated),
    independentlyEvaluated: Boolean(row.independently_evaluated),
    persistedQuality: row.persisted_quality === null ? null : Number(row.persisted_quality),
    explorationValue: row.exploration_value === null ? null : Number(row.exploration_value),
  };
}

export function registerLoopPortfolioRoutes(app: Express, helpers: LoopPortfolioHelpers) {
  const { authMiddleware, mutateLimiter, getTenantFromRequest, isAdminRequest, ADMIN_TENANT_ID } = helpers;
  const runtimeDb = helpers.db ?? pool;
  const requireAdmin = (req: Request, res: Response): number | null => {
    const tenantId = getTenantFromRequest(req);
    if (tenantId !== ADMIN_TENANT_ID || !isAdminRequest(req)) {
      res.status(403).json({ error: "Admin access required" });
      return null;
    }
    return tenantId;
  };

  app.get("/api/admin/loop-portfolio", authMiddleware, async (req, res) => {
    try {
      const tenantId = requireAdmin(req, res);
      if (tenantId === null) return;
      const limit = Number(req.query.limit ?? 200);
      const graph = await listLoopGraph(runtimeDb, tenantId, limit);
      const observations = graph.nodes.map(asObservation);
      const byLoop = new Map<string, LoopOutcomeObservation[]>();
      for (const observation of observations) {
        const bucket = byLoop.get(observation.loopKind) ?? [];
        bucket.push(observation);
        byLoop.set(observation.loopKind, bucket);
      }
      const convergence = [...byLoop.values()].map((items) =>
        analyzeLoopConvergence(items),
      );
      const allocation = recommendLoopAllocation(observations, {
        totalBudgetUnits: 100,
        explorationReserveFraction: 0.2,
      });
      res.json({ graph, convergence, allocation });
    } catch (error) {
      console.error("[loop-portfolio] report failed", error);
      res.status(500).json({ error: "Failed to load loop portfolio report" });
    }
  });

  app.post(
    "/api/admin/loop-portfolio/dream-replay",
    authMiddleware,
    mutateLimiter,
    async (req, res) => {
      try {
        const tenantId = requireAdmin(req, res);
        if (tenantId === null) return;
        if (process.env.DREAM_RSI_REPORT_ONLY_ENABLED !== "1") {
          return res.status(409).json({ error: "Dream-RSI report-only loop is disabled" });
        }
        const programId = Number(req.body?.programId);
        const options = normalizeDreamReplayOptions({
          maxNodes: req.body?.maxNodes === undefined ? undefined : Number(req.body.maxNodes),
          maxRounds: req.body?.maxRounds === undefined ? undefined : Number(req.body.maxRounds),
          batchSize: req.body?.batchSize === undefined ? undefined : Number(req.body.batchSize),
        });
        const replay = await runDreamResearchReplay(runtimeDb, {
          tenantId,
          programId,
          ...options,
        });
        const cohortKey = createHash("sha256")
          .update(JSON.stringify({
            programId,
            options,
            cohort: replay.cohort,
            result: replay.result,
          }))
          .digest("hex")
          .slice(0, 20);
        const recorded: any[] = [];
        for (const policy of replay.result.policyResults) {
          const row = await appendLoopOutcome(runtimeDb, {
            tenantId,
            eventKey: `dream-rsi:${programId}:${cohortKey}:${policy.policyId}:${policy.policyVersion}`,
            loopKind: "dream-rsi-exploration",
            policyVersion: `${policy.policyId}:${policy.policyVersion}`,
            sourceType: "research_program",
            sourceId: String(programId),
            taskClass: "research-exploration",
            mode: "report_only",
            quality: policy.meanQuality,
            costUsd: 0,
            latencyMs: 0,
            safetyPassed: policy.safetyRegressions === 0,
            safetyEvaluated:
              policy.safetyRegressions > 0 ||
              (
                policy.independentlyEvaluatedCount > 0 &&
                policy.safetyEvaluatedCount === policy.independentlyEvaluatedCount
              ),
            independentlyEvaluated: policy.independentlyEvaluatedCount > 0,
            persistedQuality: null,
            explorationValue: policy.explorationValue,
            evidence: {
              coverage: policy.coverage,
              selectedCount: policy.selectedNodeIds.length,
              verdict: replay.result.verdict,
              mayPromote: false,
              mayAllocate: false,
            },
            occurredAt: new Date().toISOString(),
          });
          recorded.push(row);
        }
        for (let index = 1; index < recorded.length; index++) {
          await appendLoopGraphEdge(runtimeDb, {
            tenantId,
            edgeKey: `dream-rsi-compare:${recorded[0].id}:${recorded[index].id}`,
            sourceEventId: recorded[0].id,
            targetEventId: recorded[index].id,
            relation: "replayed_against",
            evidence: { sameHistoricalCohort: true },
          });
        }
        res.json({
          ...replay.result,
          recordedEventIds: recorded.map((row) => row.id),
          mayPromote: false,
          mayAllocate: false,
        });
      } catch (error) {
        console.error("[loop-portfolio] Dream replay failed", error);
        res.status(400).json({ error: (error as Error).message });
      }
    },
  );
}