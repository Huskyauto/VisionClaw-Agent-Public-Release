/**
 * Tools-layer-split S17 — finance-domain migrated handlers.
 *
 * Selection: the 7 DB-backed invoicing + expenses tools — `create_invoice`,
 * `list_invoices`, `update_invoice_status`, `invoice_aging_report`,
 * `log_expense`, `list_expenses`, `expense_report`. In the legacy facade each
 * was an individual switch arm of the form:
 *   const biz = await import("./business-tools");
 *   return biz.<fn>({ ...params, tenant_id: params._tenantId });
 * (invoice_aging_report passed only `{ tenant_id: params._tenantId }` — no
 * `...params` — preserved verbatim below).
 *
 * Handler bodies are MECHANICAL moves of the legacy switch arms (standing
 * rules: no renames, no behavior change, no added gate). The ONLY edit: the
 * caller-supplied `params._tenantId` read becomes `ctx.tenantId` (the dispatcher
 * strips + re-stamps it from the trusted context). VERIFIED SAFE: the 7
 * `business-tools` fns read the tenant solely via `tenantGuard(params.tenant_id)`
 * (which throws "tenant_id is required for business operations" on a falsy
 * value — the legacy arms had NO explicit gate, so this fail-closed behavior is
 * unchanged) and read NO `_`-prefixed trust signal, so passing the
 * dispatcher-stripped `params` alongside `tenant_id: ctx.tenantId` is
 * behavior-identical to the legacy `{ ...params, tenant_id: params._tenantId }`.
 * The sole external dependency (`../../../business-tools`) is pulled via a
 * call-time dynamic `import(...)` inside each handler — NOT a top-level static
 * import — so the domain module statically imports only within server/tools/ and
 * cannot recurse back into the app graph (acyclicity invariant, plan.md S2; same
 * seam S8–S16 used). No tools.ts module-scope helpers moved.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  createInvoiceDefinition,
  listInvoicesDefinition,
  updateInvoiceStatusDefinition,
  invoiceAgingReportDefinition,
  logExpenseDefinition,
  listExpensesDefinition,
  expenseReportDefinition,
  recordKpiDefinition,
  kpiDashboardDefinition,
  kpiTrendDefinition,
  profitAndLossDefinition,
  revenueReportDefinition,
  cashFlowSummaryDefinition,
  businessHealthScoreDefinition,
  financialSnapshotDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Handlers (mechanical moves of the legacy switch arms)
// ---------------------------------------------------------------------------

async function createInvoiceHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.createInvoice({ ...params, tenant_id: ctx.tenantId });
}

async function listInvoicesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.listInvoices({ ...params, tenant_id: ctx.tenantId });
}

async function updateInvoiceStatusHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.updateInvoiceStatus({ ...params, tenant_id: ctx.tenantId });
}

async function invoiceAgingReportHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.invoiceAgingReport({ tenant_id: ctx.tenantId });
}

async function logExpenseHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.logExpense({ ...params, tenant_id: ctx.tenantId });
}

async function listExpensesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.listExpenses({ ...params, tenant_id: ctx.tenantId });
}

async function expenseReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.expenseReport({ ...params, tenant_id: ctx.tenantId });
}

// --- finance-report cluster handlers (same _tenantId seam) ------------------

async function recordKpiHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.recordKpi({ ...params, tenant_id: ctx.tenantId });
}

async function kpiDashboardHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.kpiDashboard({ tenant_id: ctx.tenantId });
}

async function kpiTrendHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.kpiTrend({ ...params, tenant_id: ctx.tenantId });
}

async function profitAndLossHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.profitAndLoss({ ...params, tenant_id: ctx.tenantId });
}

async function revenueReportHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.revenueReport({ ...params, tenant_id: ctx.tenantId });
}

async function cashFlowSummaryHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.cashFlowSummary({ ...params, tenant_id: ctx.tenantId });
}

async function businessHealthScoreHandler(
  _params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.businessHealthScore({ tenant_id: ctx.tenantId });
}

async function financialSnapshotHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const biz = await import("../../../business-tools");
  return biz.financialSnapshot({ tenant_id: ctx.tenantId as number, period: params.period });
}

/** Registered by ./index.ts at import time. */
export const financeDomainTools: RegisteredTool[] = [
  defineTool(createInvoiceDefinition, createInvoiceHandler),
  defineTool(listInvoicesDefinition, listInvoicesHandler),
  defineTool(updateInvoiceStatusDefinition, updateInvoiceStatusHandler),
  defineTool(invoiceAgingReportDefinition, invoiceAgingReportHandler),
  defineTool(logExpenseDefinition, logExpenseHandler),
  defineTool(listExpensesDefinition, listExpensesHandler),
  defineTool(expenseReportDefinition, expenseReportHandler),
  defineTool(recordKpiDefinition, recordKpiHandler),
  defineTool(kpiDashboardDefinition, kpiDashboardHandler),
  defineTool(kpiTrendDefinition, kpiTrendHandler),
  defineTool(profitAndLossDefinition, profitAndLossHandler),
  defineTool(revenueReportDefinition, revenueReportHandler),
  defineTool(cashFlowSummaryDefinition, cashFlowSummaryHandler),
  defineTool(businessHealthScoreDefinition, businessHealthScoreHandler),
  defineTool(financialSnapshotDefinition, financialSnapshotHandler),
];
