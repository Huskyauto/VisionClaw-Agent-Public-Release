/**
 * Tools-layer-split S17 — finance-domain tool definitions.
 *
 * Selection: the 7 DB-backed invoicing + expenses tools that cluster
 * contiguously in both the legacy TOOL_DEFINITIONS array and the legacy switch —
 * `create_invoice`, `list_invoices`, `update_invoice_status`,
 * `invoice_aging_report`, `log_expense`, `list_expenses`, `expense_report`. In
 * the facade each was an individual switch arm that dispatched into
 * `./business-tools` with `{ ...params, tenant_id: params._tenantId }` (the sole
 * trust channel is `_tenantId`, covered by the trusted ToolContext seam; the
 * `business-tools` fns read NO `_`-prefixed key — verified — so the dispatcher's
 * `stripTrustSignals` is behavior-neutral). Adjacent finance/reporting tools
 * stay legacy per the smallest-safe-batch precedent: the scattered
 * finance-report cluster (`revenue_report`, `profit_and_loss`,
 * `cash_flow_summary`, `business_health_score`, `financial_snapshot`,
 * `record_kpi`/`kpi_dashboard`/`kpi_trend`) is interleaved with the CRM
 * (`add_customer`/`update_customer`/`list_customers`/`log_interaction`/
 * `customer_pipeline`) and contract (`create_contract`/`list_contracts`/
 * `update_contract_status`) regions and migrates with those domains later; the
 * market-data `finance_*` / `forecast_ticker` / `analyze_portfolio` tools are
 * network-touching (S4 network-stays-legacy precedent) and migrate later.
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes — inventory diff must stay byte-clean).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const createInvoiceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_invoice",
    description: "Create a business invoice with line items, auto-calculate totals, and track in the accounting system. Use for billing clients. Returns invoice ID and total. The invoice is stored in the database for tracking, aging reports, and P&L.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Client/company name to bill" },
        customer_email: { type: "string", description: "Client email for the invoice" },
        customer_id: { type: "number", description: "Customer ID from CRM (optional — links invoice to customer record)" },
        invoice_number: { type: "string", description: "Custom invoice number (auto-generated if omitted)" },
        issue_date: { type: "string", description: "Issue date YYYY-MM-DD (default: today)" },
        due_date: { type: "string", description: "Due date YYYY-MM-DD (default: 30 days from today)" },
        tax_rate: { type: "number", description: "Tax rate percentage (default: 0)" },
        payment_terms: { type: "string", description: "Payment terms text (default: Net 30)" },
        notes: { type: "string", description: "Additional invoice notes" },
        items: { type: "array", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unit_price: { type: "number" } }, required: ["description", "unit_price"] }, description: "Line items — each needs description and unit_price, quantity defaults to 1" },
      },
      required: ["customer_name", "items"],
    },
  },
};

export const listInvoicesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_invoices",
    description: "Use when reviewing receivables at session start, when Bob asks \"who owes us money\", before sending payment-reminder outreach, or when reconciling against Stripe. Returns invoices with status, amounts, and overdue flags. Filter by status (draft/sent/paid/overdue/cancelled) to focus on action items.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "cancelled", "partial"] }, limit: { type: "number" } }, required: [] },
  },
};

export const updateInvoiceStatusDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "update_invoice_status",
    description: "Update an invoice's status (draft → sent → paid) and optionally record payment amount.",
    parameters: { type: "object", properties: { invoice_id: { type: "number", description: "Invoice ID" }, status: { type: "string", enum: ["draft", "sent", "paid", "overdue", "cancelled", "partial"] }, amount_paid: { type: "number", description: "Payment amount received" } }, required: ["invoice_id", "status"] },
  },
};

export const invoiceAgingReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "invoice_aging_report",
    description: "Generate accounts receivable aging report — shows current, 30-day, 60-day, and 90+ day overdue invoices with totals. Essential for cash flow management.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const logExpenseDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "log_expense",
    description: "Record a business expense for tracking and tax purposes. Categories: software, hosting, api_costs, marketing, travel, meals, office, equipment, professional_services, insurance, taxes, payroll, utilities, subscriptions, other.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Expense amount in dollars" },
        category: { type: "string", description: "Expense category" },
        vendor: { type: "string", description: "Vendor/payee name" },
        description: { type: "string", description: "What the expense was for" },
        date: { type: "string", description: "Expense date YYYY-MM-DD (default: today)" },
        payment_method: { type: "string", description: "How it was paid (credit_card, bank_transfer, cash, etc.)" },
        is_deductible: { type: "boolean", description: "Tax deductible? (default: true)" },
        project_id: { type: "number", description: "Link to a project (optional)" },
      },
      required: ["amount", "category"],
    },
  },
};

export const listExpensesDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_expenses",
    description: "Use when preparing a P&L view, answering \"how much did we spend on X\", before approving a recurring charge, or when categorizing for tax/accounting. Returns expense rows with date, amount, vendor, category, and notes for the requested date range.",
    parameters: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" }, category: { type: "string" }, limit: { type: "number" } }, required: [] },
  },
};

export const expenseReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "expense_report",
    description: "Generate an expense report broken down by category with totals, averages, and deductible amounts. Perfect for tax prep or monthly reviews.",
    parameters: { type: "object", properties: { start_date: { type: "string", description: "Start date YYYY-MM-DD (default: Jan 1)" }, end_date: { type: "string", description: "End date YYYY-MM-DD (default: today)" } }, required: [] },
  },
};

// --- finance-report cluster (migrated after invoicing+expenses) -------------
// The 8 DB-backed KPI + financial-report tools. Same `_tenantId`-only seam and
// `business-tools` dispatch as the invoicing tools above. Definitions are
// VERBATIM copies of the objects previously inline in tools.ts TOOL_DEFINITIONS.

export const recordKpiDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "record_kpi",
    description: "Record a KPI metric value. Categories: revenue, growth, engagement, operations, financial, marketing, sales, product. Tracks against optional targets.",
    parameters: {
      type: "object",
      properties: {
        metric_name: { type: "string", description: "KPI name (e.g., 'Monthly Revenue', 'Customer Count', 'Churn Rate')" },
        category: { type: "string", enum: ["revenue", "growth", "engagement", "operations", "financial", "marketing", "sales", "product"] },
        value: { type: "number" }, target: { type: "number", description: "Target value for this metric" },
        unit: { type: "string", description: "Unit of measurement (count, dollars, percent, etc.)" },
        period: { type: "string", enum: ["daily", "weekly", "monthly", "quarterly", "yearly"] },
        period_start: { type: "string", description: "Period start date YYYY-MM-DD" },
        notes: { type: "string" },
      },
      required: ["metric_name", "category", "value"],
    },
  },
};

export const kpiDashboardDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "kpi_dashboard",
    description: "View the KPI dashboard — shows latest values for all tracked metrics with target percentages, organized by category.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const kpiTrendDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "kpi_trend",
    description: "View the trend history for a specific KPI metric over time. Shows values, targets, and whether it's improving or declining.",
    parameters: { type: "object", properties: { metric_name: { type: "string" }, limit: { type: "number", description: "Number of periods to show (default: 12)" } }, required: ["metric_name"] },
  },
};

export const profitAndLossDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "profit_and_loss",
    description: "Generate a Profit & Loss (P&L) statement — revenue vs expenses with net income and profit margin. The core financial report for any business.",
    parameters: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } }, required: [] },
  },
};

export const revenueReportDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "revenue_report",
    description: "Monthly revenue breakdown with top customers. Shows invoiced vs collected amounts and average invoice size.",
    parameters: { type: "object", properties: { months: { type: "number", description: "Number of months to analyze (default: 6)" } }, required: [] },
  },
};

export const cashFlowSummaryDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "cash_flow_summary",
    description: "Cash flow summary — monthly cash in (payments received) vs cash out (expenses) with net position.",
    parameters: { type: "object", properties: { months: { type: "number", description: "Number of months (default: 3)" } }, required: [] },
  },
};

export const businessHealthScoreDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "business_health_score",
    description: "Calculate an overall business health score (0-100, grade A-F) based on collection rate, profit margin, overdue invoices, customer win rate, and KPI performance. A quick executive snapshot.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const financialSnapshotDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "financial_snapshot",
    description: "Unified financial snapshot — one call gives you everything: revenue with period-over-period variance and trend (up/down/stable), collections aging (current/30/60/90+ day buckets), average receivable age, expenses with variance, net income trend, profit margin, burn rate, runway estimate, and health grade. Replaces calling 5+ separate financial tools. Supports month, quarter, or year periods with automatic comparison to the previous period.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["month", "quarter", "year"], description: "Time period to analyze (default: month). Automatically compares against the previous equivalent period." },
      },
      required: [],
    },
  },
};

/** Full ordered set, for any consumer that wants the domain's definitions. */
export const financeDomainDefinitions: ToolDefinition[] = [
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
];
