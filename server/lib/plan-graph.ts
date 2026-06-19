/**
 * R106 Nugget #5 — Plan-on-Graph editing primitive (LuaN1aoAgent, Apache-2.0).
 *
 * Models a plan as a DAG of nodes with explicit dependencies, and exposes
 * three structured edit ops (ADD_NODE / UPDATE_NODE / DEPRECATE_NODE)
 * instead of a free-text task list. Topological readiness (which nodes can
 * be fired in parallel right now) falls out for free, which is the
 * underlying primitive for chunk-and-parallel orchestration.
 *
 * Tenant + plan_id scoped. Cycles are rejected at write time.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

export type PlanNodeStatus = "pending" | "in_progress" | "completed" | "failed" | "deprecated";

export interface PlanNodeRow {
  id: number;
  planId: string;
  nodeId: string;
  label: string;
  status: PlanNodeStatus;
  dependsOn: string[];
  metadata: Record<string, any>;
  // R108 A — adaptive per-node step budget (LuaN1aoAgent cherry-pick).
  // null = use orchestrator default; positive int = override for this node.
  maxSteps: number | null;
  createdAt: Date;
  updatedAt: Date;
}

async function loadPlan(tenantId: number, planId: string): Promise<PlanNodeRow[]> {
  const r = await db.execute(sql`
    SELECT id, plan_id, node_id, label, status, depends_on, metadata, max_steps, created_at, updated_at
    FROM plan_nodes
    WHERE tenant_id = ${tenantId} AND plan_id = ${planId}
    ORDER BY id ASC
  `);
  return ((r as any).rows ?? r).map((row: any) => ({
    id: Number(row.id),
    planId: row.plan_id,
    nodeId: row.node_id,
    label: row.label,
    status: row.status as PlanNodeStatus,
    dependsOn: Array.isArray(row.depends_on) ? row.depends_on : [],
    metadata: row.metadata || {},
    maxSteps: row.max_steps == null ? null : Number(row.max_steps),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function detectCycle(nodes: PlanNodeRow[]): string | null {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.nodeId, n.dependsOn || []);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  function dfs(id: string, stack: string[]): string | null {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of adj.get(id) || []) {
      if (!adj.has(dep)) continue;
      const c = color.get(dep);
      if (c === GRAY) return [...stack, dep].join(" → ");
      if (c === WHITE) {
        const cycle = dfs(dep, stack);
        if (cycle) return cycle;
      }
    }
    color.set(id, BLACK);
    stack.pop();
    return null;
  }
  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id, []);
      if (cycle) return cycle;
    }
  }
  return null;
}

export type PlanEditOp =
  | { op: "ADD_NODE"; nodeId: string; label: string; dependsOn?: string[]; metadata?: Record<string, any>; status?: PlanNodeStatus; maxSteps?: number | null }
  | { op: "UPDATE_NODE"; nodeId: string; label?: string; status?: PlanNodeStatus; dependsOn?: string[]; metadata?: Record<string, any>; maxSteps?: number | null }
  | { op: "DEPRECATE_NODE"; nodeId: string; reason?: string };

/** R108 A — sanitize an LLM-supplied maxSteps to a sane range. */
function coerceMaxSteps(v: any): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(1, Math.min(200, Math.floor(v)));
}

/**
 * Simulate the batch in-memory against the current plan state and return what
 * the post-batch graph WOULD look like, without touching the DB. Pure function
 * over loaded rows. Used to pre-validate cycles BEFORE we commit anything.
 */
function simulateBatch(current: PlanNodeRow[], ops: PlanEditOp[]): PlanNodeRow[] {
  const byId = new Map<string, PlanNodeRow>();
  for (const n of current) byId.set(n.nodeId, { ...n, dependsOn: [...(n.dependsOn || [])] });
  for (const op of ops) {
    if (op.op === "ADD_NODE") {
      // Mirror SQL upsert exactly: omitted fields default to (`pending`, [], {}),
      // they do NOT preserve prior values. Otherwise simulateBatch projects a
      // graph the DB would never produce, leading to false-positive cycle
      // rejections (e.g. ADD_NODE that intends to clear deps).
      const projected: PlanNodeRow = {
        id: -1,
        planId: "",
        nodeId: op.nodeId,
        label: op.label,
        status: op.status ?? "pending",
        dependsOn: op.dependsOn ?? [],
        metadata: op.metadata ?? {},
        maxSteps: op.maxSteps === undefined ? null : coerceMaxSteps(op.maxSteps),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byId.set(op.nodeId, projected);
    } else if (op.op === "UPDATE_NODE") {
      const existing = byId.get(op.nodeId);
      if (!existing) continue;
      if (op.label !== undefined) existing.label = op.label;
      if (op.status !== undefined) existing.status = op.status;
      if (op.dependsOn !== undefined) existing.dependsOn = op.dependsOn;
      if (op.metadata !== undefined) existing.metadata = op.metadata;
      if (op.maxSteps !== undefined) existing.maxSteps = coerceMaxSteps(op.maxSteps);
    } else if (op.op === "DEPRECATE_NODE") {
      const existing = byId.get(op.nodeId);
      if (!existing) continue;
      existing.status = "deprecated";
      existing.metadata = { ...(existing.metadata || {}), deprecated_reason: op.reason ?? "deprecated" };
    }
  }
  return Array.from(byId.values());
}

// Stable namespace for plan-graph advisory locks. Picked to not collide with
// other namespaces in the codebase (auto-consolidation uses a different one).
const PLAN_GRAPH_LOCK_NAMESPACE = 0x506c6e47; // "PlnG"

/**
 * Hash (tenantId, planId) into the int4 range pg_advisory_xact_lock requires.
 * djb2-style; collisions across tenants are tolerable since the namespace
 * argument scopes the lock space and a collision merely serializes two
 * unrelated edit batches briefly.
 */
function planLockKey(tenantId: number, planId: string): number {
  let h = 5381;
  const s = `${tenantId}::${planId}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  // Map into positive int4 range (avoid negatives that postgres also accepts
  // but make logs noisier).
  return Math.abs(h) | 0;
}

export async function applyPlanEdits(opts: {
  tenantId: number;
  planId: string;
  ops: PlanEditOp[];
}): Promise<{ applied: number; planSize: number; cycleDetected?: string }> {
  // R106.1 +sec round-3: serialize concurrent writers on the same plan via
  // pg_advisory_xact_lock + wrap apply + cycle re-check in a single
  // transaction so a detected cycle ROLLS BACK every write in the batch.
  // Architect previously pointed out that two concurrent writers could each
  // pass the in-memory pre-check and together commit a cycle that the
  // post-commit re-check would only DETECT, not undo.
  const lockKey = planLockKey(opts.tenantId, opts.planId);
  return await db.transaction(async (tx) => {
    // Lock is auto-released on COMMIT or ROLLBACK. Blocks any sibling
    // transaction holding the same (namespace, key) pair.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PLAN_GRAPH_LOCK_NAMESPACE}::int, ${lockKey}::int)`);

    // Pre-validate inside the lock so the projection reflects committed state.
    const currentRaw = await tx.execute(sql`
      SELECT id, plan_id, node_id, label, status, depends_on, metadata, max_steps, created_at, updated_at
      FROM plan_nodes
      WHERE tenant_id = ${opts.tenantId} AND plan_id = ${opts.planId}
      ORDER BY id ASC
    `);
    const current: PlanNodeRow[] = ((currentRaw as any).rows ?? currentRaw).map((row: any) => ({
      id: Number(row.id),
      planId: row.plan_id,
      nodeId: row.node_id,
      label: row.label,
      status: row.status as PlanNodeStatus,
      dependsOn: Array.isArray(row.depends_on) ? row.depends_on : [],
      metadata: row.metadata || {},
      maxSteps: row.max_steps == null ? null : Number(row.max_steps),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const projected = simulateBatch(current, opts.ops);
    const projectedCycle = detectCycle(projected);
    if (projectedCycle) {
      return { applied: 0, planSize: current.length, cycleDetected: projectedCycle };
    }

    let applied = 0;
    for (const op of opts.ops) {
      if (op.op === "ADD_NODE") {
        const meta = op.metadata ?? {};
        const deps = op.dependsOn ?? [];
        const status = op.status ?? "pending";
        const maxSteps = op.maxSteps === undefined ? null : coerceMaxSteps(op.maxSteps);
        await tx.execute(sql`
          INSERT INTO plan_nodes (tenant_id, plan_id, node_id, label, status, depends_on, metadata, max_steps)
          VALUES (${opts.tenantId}, ${opts.planId}, ${op.nodeId}, ${op.label}, ${status},
                  ${JSON.stringify(deps)}::jsonb, ${JSON.stringify(meta)}::jsonb, ${maxSteps})
          ON CONFLICT (tenant_id, plan_id, node_id) DO UPDATE
            SET label = EXCLUDED.label, status = EXCLUDED.status,
                depends_on = EXCLUDED.depends_on, metadata = EXCLUDED.metadata,
                max_steps = EXCLUDED.max_steps,
                updated_at = NOW()
        `);
        applied++;
      } else if (op.op === "UPDATE_NODE") {
        const sets: any[] = [];
        if (op.label !== undefined) sets.push(sql`label = ${op.label}`);
        if (op.status !== undefined) sets.push(sql`status = ${op.status}`);
        if (op.dependsOn !== undefined) sets.push(sql`depends_on = ${JSON.stringify(op.dependsOn)}::jsonb`);
        if (op.metadata !== undefined) sets.push(sql`metadata = ${JSON.stringify(op.metadata)}::jsonb`);
        if (op.maxSteps !== undefined) sets.push(sql`max_steps = ${coerceMaxSteps(op.maxSteps)}`);
        if (sets.length === 0) continue;
        sets.push(sql`updated_at = NOW()`);
        const setClause = sql.join(sets, sql`, `);
        await tx.execute(sql`
          UPDATE plan_nodes SET ${setClause}
          WHERE tenant_id = ${opts.tenantId} AND plan_id = ${opts.planId} AND node_id = ${op.nodeId}
        `);
        applied++;
      } else if (op.op === "DEPRECATE_NODE") {
        const meta = JSON.stringify({ deprecated_reason: op.reason ?? "deprecated" });
        await tx.execute(sql`
          UPDATE plan_nodes
          SET status = 'deprecated',
              metadata = metadata || ${meta}::jsonb,
              updated_at = NOW()
          WHERE tenant_id = ${opts.tenantId} AND plan_id = ${opts.planId} AND node_id = ${op.nodeId}
        `);
        applied++;
      }
    }

    // Post-commit re-check (still inside transaction). If a cycle slipped
    // through the pre-check (defense-in-depth), throw to ROLLBACK the entire
    // batch — nothing persists.
    const freshRaw = await tx.execute(sql`
      SELECT id, plan_id, node_id, label, status, depends_on, metadata, max_steps, created_at, updated_at
      FROM plan_nodes
      WHERE tenant_id = ${opts.tenantId} AND plan_id = ${opts.planId}
      ORDER BY id ASC
    `);
    const fresh: PlanNodeRow[] = ((freshRaw as any).rows ?? freshRaw).map((row: any) => ({
      id: Number(row.id),
      planId: row.plan_id,
      nodeId: row.node_id,
      label: row.label,
      status: row.status as PlanNodeStatus,
      dependsOn: Array.isArray(row.depends_on) ? row.depends_on : [],
      metadata: row.metadata || {},
      maxSteps: row.max_steps == null ? null : Number(row.max_steps),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const cycle = detectCycle(fresh);
    if (cycle) {
      // Throw so drizzle rolls the transaction back.
      const err: any = new Error(`PLAN_GRAPH_CYCLE_ROLLBACK:${cycle}`);
      err.__cycleDetected = cycle;
      err.__planSize = fresh.length;
      throw err;
    }
    return { applied, planSize: fresh.length };
  }).catch((err: any) => {
    if (err && typeof err.__cycleDetected === "string") {
      return { applied: 0, planSize: err.__planSize ?? 0, cycleDetected: err.__cycleDetected };
    }
    throw err;
  });
}

export async function queryPlan(opts: {
  tenantId: number;
  planId: string;
}): Promise<{
  nodes: PlanNodeRow[];
  ready: string[];
  blocked: string[];
  completed: string[];
  failed: string[];
}> {
  const nodes = await loadPlan(opts.tenantId, opts.planId);
  const completedSet = new Set(nodes.filter((n) => n.status === "completed" || n.status === "deprecated").map((n) => n.nodeId));
  const ready: string[] = [];
  const blocked: string[] = [];
  const completed: string[] = [];
  const failed: string[] = [];
  for (const n of nodes) {
    if (n.status === "completed") { completed.push(n.nodeId); continue; }
    if (n.status === "failed") { failed.push(n.nodeId); continue; }
    if (n.status === "deprecated") continue;
    if (n.status === "in_progress") continue;
    const allDepsDone = (n.dependsOn || []).every((d) => completedSet.has(d));
    if (allDepsDone) ready.push(n.nodeId);
    else blocked.push(n.nodeId);
  }
  return { nodes, ready, blocked, completed, failed };
}
