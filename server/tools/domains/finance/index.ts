/**
 * Tools-layer-split S17 — finance domain barrel. Re-exports definitions for
 * the legacy facade's TOOL_DEFINITIONS splice, and registers the migrated
 * handlers at import time.
 */
import { registerTools } from "../../registry";
import { financeDomainTools } from "./handlers";

registerTools(financeDomainTools);

export {
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
  financeDomainDefinitions,
} from "./definitions";

export { financeDomainTools } from "./handlers";
