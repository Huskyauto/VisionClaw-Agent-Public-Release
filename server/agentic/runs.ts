import { db } from "../db";
import { agentRuns } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface RunStep {
  at: string;
  step: string;
  status: "started" | "completed" | "failed";
  detail?: any;
  durationMs?: number;
}

export type RunStatus = "running" | "completed" | "failed" | "paused";

function requireScopedMutation<T extends { id: number }>(rows: T[], runId: number, tenantId: number): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`Agent run ${runId} was not found for tenant ${tenantId}`);
  }
  return row;
}

export async function createRun(params: {
  tenantId: number;
  runType: string;
  goal: string;
  state?: any;
  parentRunId?: number | null;
}) {
  const [run] = await db.insert(agentRuns).values({
    tenantId: params.tenantId,
    runType: params.runType,
    goal: params.goal,
    state: params.state ?? {},
    steps: [],
    status: "running",
    parentRunId: params.parentRunId ?? null,
  }).returning();
  return run;
}

export async function appendStep(runId: number, tenantId: number, step: RunStep) {
  try {
    const rows = await db.update(agentRuns).set({
      steps: sql`COALESCE(${agentRuns.steps}, '[]'::jsonb) || ${JSON.stringify([step])}::jsonb`,
      updatedAt: new Date(),
    }).where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId))).returning({ id: agentRuns.id });
    requireScopedMutation(rows, runId, tenantId);
  } catch (err) {
    console.warn(`[agent-runs] appendStep failed for run ${runId}:`, (err as Error)?.message);
    throw err;
  }
}

export async function updateRunState(runId: number, tenantId: number, state: any) {
  // Merge into existing JSONB atomically instead of overwriting, to avoid
  // lost updates when parallel workers write state concurrently.
  const rows = await db.update(agentRuns).set({
    state: sql`COALESCE(${agentRuns.state}, '{}'::jsonb) || ${JSON.stringify(state ?? {})}::jsonb`,
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId))).returning({ id: agentRuns.id });
  requireScopedMutation(rows, runId, tenantId);
}

export async function replaceRunState(runId: number, tenantId: number, state: any) {
  const rows = await db.update(agentRuns).set({ state, updatedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)))
    .returning({ id: agentRuns.id });
  requireScopedMutation(rows, runId, tenantId);
}

export async function completeRun(runId: number, tenantId: number, result: any) {
  const rows = await db.update(agentRuns).set({
    status: "completed",
    result,
    state: sql`COALESCE(${agentRuns.state}, '{}'::jsonb) - 'resumeClaimedAt'`,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId))).returning({ id: agentRuns.id });
  requireScopedMutation(rows, runId, tenantId);

  // Episode playbooks (Kimi K3 #2): distill the successful trajectory into a
  // reusable playbook. Fire-and-forget + dynamic import — a distillation
  // failure never blocks run completion.
  (async () => {
    const [run] = await db.select().from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)))
      .limit(1);
    if (!run) return;
    const { distillEpisode } = await import("../episode-playbooks");
    distillEpisode({
      runId: run.id,
      tenantId: run.tenantId,
      runType: run.runType,
      goal: run.goal,
      steps: Array.isArray(run.steps) ? (run.steps as any[]) : [],
      durationMs: run.completedAt && run.createdAt
        ? new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()
        : null,
    });
  })().catch((err) => {
    console.warn(`[agent-runs] episode distillation failed for run ${runId}:`, (err as Error)?.message);
  });
}

export async function failRun(runId: number, tenantId: number, error: string) {
  const rows = await db.update(agentRuns).set({
    status: "failed",
    error,
    state: sql`COALESCE(${agentRuns.state}, '{}'::jsonb) - 'resumeClaimedAt'`,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId))).returning({ id: agentRuns.id });
  requireScopedMutation(rows, runId, tenantId);
}

export async function pauseRun(runId: number, tenantId: number, state: any) {
  const rows = await db.update(agentRuns).set({
    status: "paused",
    state,
    updatedAt: new Date(),
  }).where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId))).returning({ id: agentRuns.id });
  requireScopedMutation(rows, runId, tenantId);
}

export async function getRun(runId: number, tenantId: number) {
  const [run] = await db.select().from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)))
    .limit(1);
  return run;
}

export async function listRuns(tenantId: number, limit = 50) {
  return db.select().from(agentRuns)
    .where(eq(agentRuns.tenantId, tenantId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
}

export async function withRun<T>(
  params: { tenantId: number; runType: string; goal: string; parentRunId?: number | null },
  fn: (ctx: { runId: number; log: (step: string, detail?: any) => Promise<void> }) => Promise<T>,
): Promise<{ runId: number; result: T }> {
  const run = await createRun(params);
  const log = async (step: string, detail?: any) => {
      await appendStep(run.id, params.tenantId, {
      at: new Date().toISOString(),
      step,
      status: "completed",
      detail,
    });
  };
  try {
    const result = await fn({ runId: run.id, log });
    await completeRun(run.id, params.tenantId, result);
    return { runId: run.id, result };
  } catch (err: any) {
    await failRun(run.id, params.tenantId, err?.message || String(err));
    throw err;
  }
}
