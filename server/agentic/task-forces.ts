/**
 * Task forces — scoped "subsidiaries" (R125+14 — Manus agentic gap #5c).
 *
 * The Manus review asked for "self-replicating tenants." A literal new tenant per
 * campaign would fork the platform's highest-risk surface (tenant isolation), so
 * this implements the SAFE interpretation: a task force is a scoped unit WITHIN a
 * tenant — a mission, a roster of personas, a capped budget, and a lifecycle
 * (active → paused → completed/sunset). All work still runs under the parent
 * tenant_id, so no isolation boundary is forked. Felix can spin one up for a
 * campaign, watch its budget, and sunset it when the mission is done.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { emitEvent } from "../event-bus";
import { logSilentCatch } from "../lib/silent-catch";

function personaIdArrayLiteral(ids?: number[] | null): string | null {
  if (!ids || ids.length === 0) return null;
  const clean = ids.filter(n => Number.isInteger(n));
  if (clean.length === 0) return null;
  return `{${clean.join(",")}}`;
}

export interface CreateTaskForceParams {
  tenantId: number;
  name: string;
  mission: string;
  personaIds?: number[];
  budgetUsd?: number;
  projectId?: number | null;
  deadline?: Date | null;
  createdBy?: string;
}

export async function createTaskForce(p: CreateTaskForceParams): Promise<any> {
  if (!p.name?.trim() || !p.mission?.trim()) throw new Error("createTaskForce requires name and mission");
  if (p.budgetUsd !== undefined && (!Number.isFinite(p.budgetUsd) || p.budgetUsd < 0)) throw new Error("createTaskForce: budgetUsd must be a non-negative finite number");
  if (p.deadline != null && Number.isNaN(p.deadline.getTime())) throw new Error("createTaskForce: deadline must be a valid date");
  const literal = personaIdArrayLiteral(p.personaIds);
  const r: any = await db.execute(sql`
    INSERT INTO task_forces (tenant_id, name, mission, persona_ids, budget_usd, project_id, deadline, created_by)
    VALUES (
      ${p.tenantId}, ${p.name}, ${p.mission},
      ${literal === null ? null : sql`${literal}::int[]`},
      ${(p.budgetUsd ?? 0).toFixed(2)}, ${p.projectId ?? null}, ${p.deadline ?? null}, ${p.createdBy ?? "Felix"}
    )
    RETURNING *
  `);
  const row = (r.rows ?? r)[0];
  await emitEvent({
    type: "taskforce.created", source: "task-forces", tenantId: p.tenantId,
    data: { id: row.id, name: row.name, mission: row.mission, budgetUsd: row.budget_usd, personaIds: row.persona_ids },
  }).catch(e => logSilentCatch("server/agentic/task-forces.ts", e));
  return row;
}

export async function listTaskForces(tenantId: number, status?: string): Promise<any[]> {
  const r: any = status
    ? await db.execute(sql`SELECT * FROM task_forces WHERE tenant_id = ${tenantId} AND status = ${status} ORDER BY created_at DESC LIMIT 100`)
    : await db.execute(sql`SELECT * FROM task_forces WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 100`);
  return (r.rows ?? r) as any[];
}

export async function getTaskForce(tenantId: number, id: number): Promise<any | null> {
  const r: any = await db.execute(sql`SELECT * FROM task_forces WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`);
  return (r.rows ?? r)[0] ?? null;
}

export interface ChargeResult {
  ok: boolean;
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  overBudget: boolean;
}

/** Charge spend against a task force's budget. overBudget=true once the cap is crossed. */
export async function chargeTaskForce(tenantId: number, id: number, amountUsd: number): Promise<ChargeResult | null> {
  if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error("amountUsd must be a non-negative finite number");
  const tf = await getTaskForce(tenantId, id);
  if (!tf) return null;
  // Fail-closed atomic charge: the increment only commits if it stays within
  // budget (budget_usd = 0 means unlimited). A would-be breach does NOT mutate
  // spent_usd — it is rejected, so a caller that ignores the returned flag can
  // never push the task force past its cap. The single-statement guard also
  // closes the read-then-write race between concurrent charges.
  const r: any = await db.execute(sql`
    UPDATE task_forces
    SET spent_usd = (spent_usd::numeric + ${amountUsd})::text, updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId}
      AND (budget_usd::numeric = 0 OR spent_usd::numeric + ${amountUsd} <= budget_usd::numeric)
    RETURNING spent_usd, budget_usd
  `);
  const charged = (r.rows ?? r)[0];
  if (charged) {
    const spent = parseFloat(charged.spent_usd || "0");
    const budget = parseFloat(charged.budget_usd || "0");
    return { ok: true, spentUsd: spent, budgetUsd: budget, remainingUsd: budget - spent, overBudget: false };
  }
  // Charge rejected — it would breach the cap. No mutation occurred; report the
  // pre-charge state and emit the over-budget event so the breach is observable.
  const spent = parseFloat(tf.spent_usd || "0");
  const budget = parseFloat(tf.budget_usd || "0");
  await emitEvent({
    type: "taskforce.over_budget", source: "task-forces", tenantId,
    data: { id, spentUsd: spent, budgetUsd: budget, rejectedChargeUsd: amountUsd },
  }).catch(e => logSilentCatch("server/agentic/task-forces.ts", e));
  return { ok: false, spentUsd: spent, budgetUsd: budget, remainingUsd: budget - spent, overBudget: true };
}

export async function pauseTaskForce(tenantId: number, id: number): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE task_forces SET status = 'paused', updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'active' RETURNING id
  `);
  return (r.rows ?? r).length > 0;
}

export async function resumeTaskForce(tenantId: number, id: number): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE task_forces SET status = 'active', updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'paused' RETURNING id
  `);
  return (r.rows ?? r).length > 0;
}

async function closeTaskForce(tenantId: number, id: number, status: "completed" | "sunset", result?: Record<string, any>): Promise<boolean> {
  const r: any = await db.execute(sql`
    UPDATE task_forces
    SET status = ${status}, sunset_at = now(), updated_at = now(),
        result = ${result ? JSON.stringify(result) : null}::jsonb
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status IN ('active', 'paused')
    RETURNING id, name, mission, spent_usd, budget_usd
  `);
  const row = (r.rows ?? r)[0];
  if (!row) return false;
  await emitEvent({
    type: status === "completed" ? "taskforce.completed" : "taskforce.sunset",
    source: "task-forces", tenantId,
    data: { id: row.id, name: row.name, spentUsd: row.spent_usd, budgetUsd: row.budget_usd, result: result ?? null },
  }).catch(e => logSilentCatch("server/agentic/task-forces.ts", e));
  return true;
}

export const completeTaskForce = (t: number, id: number, result?: Record<string, any>) => closeTaskForce(t, id, "completed", result);
export const sunsetTaskForce = (t: number, id: number, result?: Record<string, any>) => closeTaskForce(t, id, "sunset", result);
