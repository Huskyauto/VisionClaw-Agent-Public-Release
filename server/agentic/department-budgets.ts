/**
 * Departmental budget enforcement (R125+14 — Manus agentic gap #5).
 *
 * Builds on the existing agent_cost_ledger. Spend is ATTRIBUTED to a department
 * via the persona→department map (DEPARTMENTS in scaffolding.ts) using the new
 * nullable `department` column on the ledger. A department whose period spend
 * crosses its ceiling is flagged (warning at 80%, exceeded at 100%) and an event
 * is emitted so the orchestrator can throttle / negotiate rather than overspend.
 *
 * This is enforcement + visibility, NOT a hard kill — the decision to block or
 * negotiate is left to the caller (shouldThrottle returns a recommendation).
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { DEPARTMENTS } from "../scaffolding";
import { emitEvent } from "../event-bus";
import { logSilentCatch } from "../lib/silent-catch";

export function personaToDepartment(personaId?: number | null): string | null {
  if (!personaId) return null;
  const primary = DEPARTMENTS.find(d => d.primaryPersonaId === personaId);
  if (primary) return primary.id;
  const backup = DEPARTMENTS.find(d => d.backupPersonaId === personaId);
  if (backup) return backup.id;
  return null;
}

export function isValidDepartment(department: string): boolean {
  return DEPARTMENTS.some(d => d.id === department);
}

function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function weekStart(d = new Date()): Date {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday-anchored week
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
}
function periodStartFor(period: string): Date {
  return period === "weekly" ? weekStart() : monthStart();
}

export async function getDepartmentSpend(tenantId: number, department: string, since: Date): Promise<number> {
  const r: any = await db.execute(sql`
    SELECT COALESCE(SUM(cost_usd::numeric), 0)::text AS total
    FROM agent_cost_ledger
    WHERE tenant_id = ${tenantId} AND department = ${department} AND created_at >= ${since}
  `);
  const rows = r.rows ?? r;
  return parseFloat(rows[0]?.total || "0");
}

export interface BudgetCheck {
  department: string;
  hasBudget: boolean;
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  period: string;
  periodStart: string;
  withinBudget: boolean;
  utilization: number;
  status: "ok" | "warning" | "exceeded" | "no_budget";
}

export async function checkDepartmentBudget(tenantId: number, department: string): Promise<BudgetCheck> {
  const r: any = await db.execute(sql`
    SELECT * FROM department_budgets
    WHERE tenant_id = ${tenantId} AND department = ${department} AND status = 'active'
    ORDER BY period_start DESC LIMIT 1
  `);
  const budget = (r.rows ?? r)[0];
  if (!budget) {
    return {
      department, hasBudget: false, limitUsd: 0, spentUsd: 0, remainingUsd: 0,
      period: "none", periodStart: "", withinBudget: true, utilization: 0, status: "no_budget",
    };
  }
  const period = budget.period as string;
  const since = periodStartFor(period);
  const spent = await getDepartmentSpend(tenantId, department, since);
  const limit = parseFloat(budget.limit_usd || "0");
  const utilization = limit > 0 ? spent / limit : 0;
  const status: BudgetCheck["status"] =
    limit <= 0 ? "no_budget" : spent >= limit ? "exceeded" : utilization >= 0.8 ? "warning" : "ok";
  return {
    department, hasBudget: true, limitUsd: limit, spentUsd: spent,
    remainingUsd: limit - spent, period, periodStart: since.toISOString(),
    withinBudget: spent < limit, utilization, status,
  };
}

export async function setDepartmentBudget(
  tenantId: number, department: string, limitUsd: number, period: "monthly" | "weekly" = "monthly",
): Promise<BudgetCheck> {
  if (!isValidDepartment(department)) {
    throw new Error(`Unknown department "${department}". Valid: ${DEPARTMENTS.map(d => d.id).join(", ")}`);
  }
  if (!Number.isFinite(limitUsd) || limitUsd < 0) {
    throw new Error("limitUsd must be a non-negative finite number");
  }
  const since = periodStartFor(period);
  await db.execute(sql`
    INSERT INTO department_budgets (tenant_id, department, period, limit_usd, period_start, status)
    VALUES (${tenantId}, ${department}, ${period}, ${limitUsd.toFixed(2)}, ${since}, 'active')
    ON CONFLICT (tenant_id, department, period_start)
    DO UPDATE SET limit_usd = ${limitUsd.toFixed(2)}, period = ${period}, status = 'active', updated_at = now()
  `);
  return checkDepartmentBudget(tenantId, department);
}

export async function checkAllBudgets(tenantId: number): Promise<BudgetCheck[]> {
  const r: any = await db.execute(sql`
    SELECT DISTINCT department FROM department_budgets WHERE tenant_id = ${tenantId} AND status = 'active'
  `);
  const rows = (r.rows ?? r) as any[];
  return Promise.all(rows.map(row => checkDepartmentBudget(tenantId, row.department)));
}

/**
 * Recommendation for the orchestrator. shouldThrottle=true once a department is
 * over budget — the caller decides whether to pause, escalate, or negotiate.
 */
export async function budgetGuard(tenantId: number, personaId?: number | null): Promise<{
  shouldThrottle: boolean;
  check: BudgetCheck | null;
}> {
  const dept = personaToDepartment(personaId);
  if (!dept) return { shouldThrottle: false, check: null };
  const check = await checkDepartmentBudget(tenantId, dept);
  return { shouldThrottle: check.hasBudget && !check.withinBudget, check };
}

/**
 * Heartbeat-callable sweep. Emits budget.warning / budget.exceeded events for any
 * active department budget that has crossed its threshold this period. Idempotent
 * per period+status via the event payload (event-bus dedups downstream).
 */
export async function runBudgetEnforcement(): Promise<{ checked: number; warnings: number; exceeded: number; failed: boolean }> {
  let warnings = 0, exceeded = 0, checked = 0, failed = false;
  try {
    const r: any = await db.execute(sql`
      SELECT DISTINCT tenant_id, department FROM department_budgets WHERE status = 'active'
    `);
    const rows = (r.rows ?? r) as any[];
    for (const row of rows) {
      checked++;
      const check = await checkDepartmentBudget(row.tenant_id, row.department);
      if (check.status === "exceeded") {
        exceeded++;
        await emitEvent({
          type: "budget.exceeded", source: "department-budgets", tenantId: row.tenant_id,
          data: { department: check.department, spentUsd: check.spentUsd, limitUsd: check.limitUsd, period: check.period, periodStart: check.periodStart },
        });
      } else if (check.status === "warning") {
        warnings++;
        await emitEvent({
          type: "budget.warning", source: "department-budgets", tenantId: row.tenant_id,
          data: { department: check.department, spentUsd: check.spentUsd, limitUsd: check.limitUsd, utilization: check.utilization, period: check.period },
        });
      }
    }
  } catch (e) { failed = true; logSilentCatch("server/agentic/department-budgets.ts", e); }
  return { checked, warnings, exceeded, failed };
}
