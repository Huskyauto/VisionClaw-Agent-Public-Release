import crypto from "node:crypto";
import { db } from "./db";
import { planReplayCache } from "@shared/schema";
import { generateEmbedding } from "./embeddings";
import { logSilentCatch } from "./lib/silent-catch";
import { sql } from "drizzle-orm";
import type { OrchestrationPlan, OrchestrationStep } from "./ceo-orchestrator";
import { CLASS_TO_SKILL_TYPES } from "./early-commitment";

const SIMILARITY_THRESHOLD = 0.92;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_OBJECTIVE_LEN = 12;

// R125+13.17+sec — classifier-mapping version hash. Architect MEDIUM:
// cache is keyed on (tenant_id, request_class), but request_class semantics
// depend on CLASS_TO_SKILL_TYPES (the Early Commitment narrowing). When that
// mapping changes (a class gains/loses allowed skill types), old cached plans
// were narrowed under different rules and replaying them onto the new regime
// produces "narrowing-induced hallucinations" (missing specialist). Suffix
// the requestClass with a stable 8-char hash of the mapping; on map change
// the suffix changes and old rows naturally stop matching. No schema change.
const CLASSIFIER_VERSION_HASH = crypto
  .createHash("sha256")
  .update(JSON.stringify(CLASS_TO_SKILL_TYPES))
  .digest("hex")
  .slice(0, 8);

function keyedClass(requestClass: string): string {
  return `${requestClass}:v${CLASSIFIER_VERSION_HASH}`;
}

export interface ReplayHit {
  cacheId: number;
  steps: OrchestrationStep[];
  similarity: number;
  originalObjective: string;
  hitCount: number;
  ageDays: number;
}

export async function lookupReplayablePlan(
  objective: string,
  requestClass: string,
  tenantId: number,
  escapeHatch: boolean,
): Promise<ReplayHit | null> {
  if (escapeHatch || requestClass === "open-ended") return null;
  if (!objective || objective.length < MIN_OBJECTIVE_LEN) return null;

  try {
    const embedding = await generateEmbedding(objective);
    if (!embedding) return null;

    const cutoffMs = Date.now() - MAX_AGE_MS;
    const cutoff = new Date(cutoffMs);
    const embeddingLiteral = `[${embedding.join(",")}]`;
    const versionedClass = keyedClass(requestClass);

    const result = await db.execute(sql`
      SELECT id, plan_json, objective, hit_count, created_at,
             1 - (objective_embedding <=> ${embeddingLiteral}::vector) AS similarity
      FROM plan_replay_cache
      WHERE tenant_id = ${tenantId}
        AND request_class = ${versionedClass}
        AND objective_embedding IS NOT NULL
        AND created_at > ${cutoff}
      ORDER BY objective_embedding <=> ${embeddingLiteral}::vector ASC
      LIMIT 1
    `);

    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) return null;

    const top = rows[0];
    const similarity = Number(top.similarity);
    if (!Number.isFinite(similarity) || similarity < SIMILARITY_THRESHOLD) {
      console.log(`[plan-replay] No hit (best similarity ${similarity.toFixed(3)} < ${SIMILARITY_THRESHOLD})`);
      return null;
    }

    const planJson = top.plan_json;
    const steps: OrchestrationStep[] = Array.isArray(planJson?.steps)
      ? planJson.steps.map((s: any) => ({
          ...s,
          status: "pending",
        }))
      : [];

    if (steps.length === 0) return null;

    // Bump hit metadata fire-and-forget
    db.execute(sql`
      UPDATE plan_replay_cache
      SET hit_count = hit_count + 1, last_hit_at = NOW()
      WHERE id = ${top.id} AND tenant_id = ${tenantId}
    `).catch((err) => logSilentCatch("server/plan-replay.ts", err));

    const ageDays = (Date.now() - new Date(top.created_at).getTime()) / (1000 * 60 * 60 * 24);
    console.log(`[plan-replay] HIT cache_id=${top.id} similarity=${similarity.toFixed(3)} hits=${top.hit_count + 1} age=${ageDays.toFixed(1)}d`);

    return {
      cacheId: top.id,
      steps,
      similarity,
      originalObjective: top.objective,
      hitCount: top.hit_count + 1,
      ageDays,
    };
  } catch (err) {
    logSilentCatch("server/plan-replay.ts", err);
    return null;
  }
}

export function recordPlanOutcome(
  plan: OrchestrationPlan,
  requestClass: string,
  escapeHatch: boolean,
): void {
  // Don't record open-ended plans (they're by definition not repeatable) or
  // anything that didn't fully succeed, or anything already loaded from cache.
  if (escapeHatch || requestClass === "open-ended") return;
  if (plan.status !== "complete") return;
  if ((plan as any).__replayedFromCache) return;
  if (!plan.objective || plan.objective.length < MIN_OBJECTIVE_LEN) return;
  if (!plan.steps || plan.steps.length === 0) return;

  (async () => {
    try {
      const embedding = await generateEmbedding(plan.objective);
      if (!embedding) return;

      const embeddingLiteral = `[${embedding.join(",")}]`;
      const durationMs = plan.completedAt ? (plan.completedAt - plan.createdAt) : null;

      // Strip volatile fields before persisting — replays get fresh status, ids, etc.
      const sanitizedSteps = plan.steps.map((s) => ({
        taskId: s.taskId,
        description: s.description,
        assignedPersona: s.assignedPersona,
        dependsOn: s.dependsOn,
        requiredSkillType: s.requiredSkillType,
        toolChain: s.toolChain || [],
        leanMode: s.leanMode,
      }));

      const versionedClass = keyedClass(requestClass);
      await db.execute(sql`
        INSERT INTO plan_replay_cache
          (tenant_id, request_class, objective, objective_embedding, plan_json, step_count, total_duration_ms)
        VALUES
          (${plan.tenantId}, ${versionedClass}, ${plan.objective}, ${embeddingLiteral}::vector,
           ${JSON.stringify({ steps: sanitizedSteps })}::jsonb, ${plan.steps.length}, ${durationMs})
      `);
      console.log(`[plan-replay] RECORDED class=${versionedClass} steps=${plan.steps.length} duration=${durationMs}ms`);
    } catch (err) {
      logSilentCatch("server/plan-replay.ts", err);
    }
  })();
}
