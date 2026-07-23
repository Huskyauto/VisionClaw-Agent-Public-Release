import { db } from "./db";
import { sql } from "drizzle-orm";

export interface RevenueMetrics {
  current: number;
  previous: number;
  variance: number;
  variancePct: string;
  trend: "up" | "down" | "stable";
  collected: number;
  collectionRate: string;
}

export interface CollectionsMetrics {
  total: number;
  aging: {
    current: number;
    days30: number;
    days60: number;
    days90plus: number;
  };
  overdueCount: number;
  averageAgeDays: number;
}

export interface ExpenseMetrics {
  current: number;
  previous: number;
  variance: number;
  variancePct: string;
  trend: "up" | "down" | "stable";
  topCategories: Array<{ category: string; amount: number }>;
}

export interface FinancialSnapshot {
  period: string;
  previousPeriod: string;
  revenue: RevenueMetrics;
  collections: CollectionsMetrics;
  expenses: ExpenseMetrics;
  netIncome: number;
  previousNetIncome: number;
  netTrend: "up" | "down" | "stable";
  profitMargin: string;
  burnRate: number | null;
  runwayMonths: number | null;
  healthGrade: string;
}

const VALID_INVOICE_STATUSES = ["draft", "sent", "paid", "overdue", "cancelled", "partial"];
const VALID_DEAL_STAGES = ["prospect", "lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost", "churned"];
const VALID_CONTRACT_STATUSES = ["draft", "sent", "signed", "active", "expired", "cancelled"];
const EXPENSE_CATEGORIES = ["software", "hosting", "api_costs", "marketing", "travel", "meals", "office", "equipment", "professional_services", "insurance", "taxes", "payroll", "utilities", "subscriptions", "other"];

function tenantGuard(tenantId: number): number {
  if (!tenantId) throw new Error("tenant_id is required for business operations");
  return tenantId;
}

// ─── INVOICING ────────────────────────────────────────────────────────────────

export async function createInvoice(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const invoiceNumber = params.invoice_number || `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const dueDate = params.due_date || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const issueDate = params.issue_date || new Date().toISOString().split("T")[0];

  const items: { description: string; quantity: number; unit_price: number }[] = params.items || [];
  const subtotal = items.reduce((sum, i) => sum + (i.quantity || 1) * i.unit_price, 0);
  const taxRate = params.tax_rate || 0;
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const res = await db.execute(sql`
    INSERT INTO invoices (tenant_id, invoice_number, customer_id, customer_name, customer_email, issue_date, due_date, status, subtotal, tax_rate, tax_amount, total, payment_terms, notes)
    VALUES (${tid}, ${invoiceNumber}, ${params.customer_id || null}, ${params.customer_name || null}, ${params.customer_email || null}, ${issueDate}, ${dueDate}, ${"draft"}, ${subtotal}, ${taxRate}, ${taxAmount}, ${total}, ${params.payment_terms || "Net 30"}, ${params.notes || null})
    RETURNING id
  `);
  const invoiceId = (res as any).rows[0].id;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const amount = (item.quantity || 1) * item.unit_price;
    await db.execute(sql`
      INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order)
      VALUES (${invoiceId}, ${item.description}, ${item.quantity || 1}, ${item.unit_price}, ${amount}, ${i + 1})
    `);
  }

  if (params.customer_id) {
    await db.execute(sql`UPDATE customers SET total_revenue = total_revenue + ${total}, updated_at = CURRENT_TIMESTAMP WHERE id = ${params.customer_id} AND tenant_id = ${tid}`);
  }

  return { success: true, invoice_id: invoiceId, invoice_number: invoiceNumber, subtotal, tax_amount: taxAmount, total, items_count: items.length, status: "draft", message: `Invoice ${invoiceNumber} created — $${total.toFixed(2)} total, ${items.length} line items` };
}

export async function listInvoices(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const statusFilter = params.status ? sql` AND status = ${params.status}` : sql``;
  const res = await db.execute(sql`
    SELECT id, invoice_number, customer_name, issue_date, due_date, status, total, amount_paid,
      CASE WHEN status != 'paid' AND due_date < CURRENT_DATE THEN true ELSE false END as is_overdue
    FROM invoices WHERE tenant_id = ${tid} ${statusFilter}
    ORDER BY issue_date DESC LIMIT ${params.limit || 50}
  `);
  return { success: true, invoices: (res as any).rows, count: (res as any).rows.length };
}

export async function updateInvoiceStatus(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.invoice_id) return { error: "invoice_id required" };
  if (!VALID_INVOICE_STATUSES.includes(params.status)) return { error: `Invalid status. Valid: ${VALID_INVOICE_STATUSES.join(", ")}` };

  const updates: string[] = [`status = '${params.status}'`, `updated_at = CURRENT_TIMESTAMP`];
  if (params.amount_paid !== undefined) updates.push(`amount_paid = ${params.amount_paid}`);

  await db.execute(sql`UPDATE invoices SET status = ${params.status}, amount_paid = COALESCE(${params.amount_paid || null}, amount_paid), updated_at = CURRENT_TIMESTAMP WHERE id = ${params.invoice_id} AND tenant_id = ${tid}`);
  return { success: true, message: `Invoice ${params.invoice_id} updated to '${params.status}'` };
}

export async function invoiceAgingReport(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const res = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
      COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) as paid_total,
      COUNT(*) FILTER (WHERE status IN ('sent','draft') AND due_date >= CURRENT_DATE) as current_count,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','draft') AND due_date >= CURRENT_DATE), 0) as current_outstanding,
      COUNT(*) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days') as overdue_30,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as overdue_30_amount,
      COUNT(*) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days') as overdue_60,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days'), 0) as overdue_60_amount,
      COUNT(*) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '60 days') as overdue_90_plus,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '60 days'), 0) as overdue_90_plus_amount,
      COUNT(*) as total_invoices,
      COALESCE(SUM(total), 0) as total_invoiced,
      COALESCE(SUM(amount_paid), 0) as total_collected
    FROM invoices WHERE tenant_id = ${tid}
  `);
  return { success: true, aging: (res as any).rows[0], message: "Accounts receivable aging report" };
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────

export async function logExpense(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.amount) return { error: "amount is required" };
  if (!params.category) return { error: `category required. Valid: ${EXPENSE_CATEGORIES.join(", ")}` };

  const res = await db.execute(sql`
    INSERT INTO expenses (tenant_id, date, category, vendor, description, amount, payment_method, receipt_url, is_deductible, tax_category, project_id, status)
    VALUES (${tid}, ${params.date || new Date().toISOString().split("T")[0]}, ${params.category}, ${params.vendor || null}, ${params.description || null}, ${params.amount}, ${params.payment_method || null}, ${params.receipt_url || null}, ${params.is_deductible !== false}, ${params.tax_category || params.category}, ${params.project_id || null}, ${"recorded"})
    RETURNING id
  `);
  return { success: true, expense_id: (res as any).rows[0].id, amount: params.amount, category: params.category, message: `Expense logged: $${Number(params.amount).toFixed(2)} for ${params.category}` };
}

export async function listExpenses(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const catFilter = params.category ? sql` AND category = ${params.category}` : sql``;
  const startDate = params.start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const endDate = params.end_date || new Date().toISOString().split("T")[0];

  const res = await db.execute(sql`
    SELECT id, date, category, vendor, description, amount, payment_method, is_deductible, status
    FROM expenses WHERE tenant_id = ${tid} AND date >= ${startDate} AND date <= ${endDate} ${catFilter}
    ORDER BY date DESC LIMIT ${params.limit || 100}
  `);
  return { success: true, expenses: (res as any).rows, count: (res as any).rows.length, period: `${startDate} to ${endDate}` };
}

export async function expenseReport(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const startDate = params.start_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
  const endDate = params.end_date || new Date().toISOString().split("T")[0];

  const res = await db.execute(sql`
    SELECT
      category,
      COUNT(*) as transaction_count,
      SUM(amount) as total_amount,
      AVG(amount) as avg_amount,
      SUM(CASE WHEN is_deductible THEN amount ELSE 0 END) as deductible_amount
    FROM expenses
    WHERE tenant_id = ${tid} AND date >= ${startDate} AND date <= ${endDate}
    GROUP BY category
    ORDER BY total_amount DESC
  `);

  const totals = await db.execute(sql`
    SELECT
      COUNT(*) as total_transactions,
      COALESCE(SUM(amount), 0) as total_spent,
      COALESCE(SUM(CASE WHEN is_deductible THEN amount ELSE 0 END), 0) as total_deductible
    FROM expenses
    WHERE tenant_id = ${tid} AND date >= ${startDate} AND date <= ${endDate}
  `);

  return {
    success: true,
    period: `${startDate} to ${endDate}`,
    by_category: (res as any).rows,
    totals: (totals as any).rows[0],
    message: `Expense report: ${startDate} to ${endDate}`
  };
}

// ─── CRM / CUSTOMERS ────────────────────────────────────────────────────────

export async function addCustomer(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.company_name && !params.contact_name) return { error: "company_name or contact_name required" };

  const res = await db.execute(sql`
    INSERT INTO customers (tenant_id, company_name, contact_name, email, phone, address, city, state, zip, country, industry, status, notes, deal_stage, deal_value, assigned_to)
    VALUES (${tid}, ${params.company_name || null}, ${params.contact_name || null}, ${params.email || null}, ${params.phone || null}, ${params.address || null}, ${params.city || null}, ${params.state || null}, ${params.zip || null}, ${params.country || "US"}, ${params.industry || null}, ${params.status || "active"}, ${params.notes || null}, ${params.deal_stage || "prospect"}, ${params.deal_value || null}, ${params.assigned_to || null})
    RETURNING id
  `);
  return { success: true, customer_id: (res as any).rows[0].id, message: `Customer added: ${params.company_name || params.contact_name}` };
}

export async function updateCustomer(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.customer_id) return { error: "customer_id required" };

  const fields: string[] = [];
  const updateMap: Record<string, any> = {
    company_name: params.company_name, contact_name: params.contact_name, email: params.email,
    phone: params.phone, address: params.address, city: params.city, state: params.state,
    zip: params.zip, industry: params.industry, status: params.status, notes: params.notes,
    deal_stage: params.deal_stage, deal_value: params.deal_value, assigned_to: params.assigned_to,
  };
  // R79.3 loaded-gun guard: keys come from a hardcoded updateMap above so
  // they're literal-safe today, but a future refactor that does e.g.
  // `{...updateMap, ...params.custom_fields}` would silently introduce a SQL
  // injection vector via sql.raw(key). Enforce the allowlist explicitly so
  // the safe-by-construction invariant survives future edits.
  const ALLOWED_CUSTOMER_COLUMNS: ReadonlySet<string> = new Set([
    "company_name", "contact_name", "email", "phone", "address", "city",
    "state", "zip", "industry", "status", "notes", "deal_stage",
    "deal_value", "assigned_to",
  ]);

  let query = sql`UPDATE customers SET updated_at = CURRENT_TIMESTAMP`;
  for (const [key, val] of Object.entries(updateMap)) {
    if (val !== undefined) {
      if (!ALLOWED_CUSTOMER_COLUMNS.has(key)) {
        throw new Error(`updateCustomer: column "${key}" not in allowlist (R79.3 SQL-injection guard)`);
      }
      query = sql`${query}, ${sql.raw(key)} = ${val}`;
    }
  }
  if (params.deal_stage) query = sql`${query}, last_contact_at = CURRENT_TIMESTAMP`;
  query = sql`${query} WHERE id = ${params.customer_id} AND tenant_id = ${tid}`;
  await db.execute(query);
  return { success: true, message: `Customer ${params.customer_id} updated` };
}

export async function listCustomers(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const stageFilter = params.deal_stage ? sql` AND deal_stage = ${params.deal_stage}` : sql``;
  const statusFilter = params.status ? sql` AND status = ${params.status}` : sql``;
  const res = await db.execute(sql`
    SELECT id, company_name, contact_name, email, phone, industry, status, deal_stage, deal_value, total_revenue, last_contact_at, created_at
    FROM customers WHERE tenant_id = ${tid} ${stageFilter} ${statusFilter}
    ORDER BY updated_at DESC LIMIT ${params.limit || 50}
  `);
  return { success: true, customers: (res as any).rows, count: (res as any).rows.length };
}

export async function logInteraction(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.customer_id) return { error: "customer_id required" };
  if (!params.interaction_type) return { error: "interaction_type required (call, email, meeting, demo, proposal, follow_up, note)" };

  await db.execute(sql`
    INSERT INTO customer_interactions (tenant_id, customer_id, interaction_type, subject, notes, outcome, follow_up_date, created_by)
    VALUES (${tid}, ${params.customer_id}, ${params.interaction_type}, ${params.subject || null}, ${params.notes || null}, ${params.outcome || null}, ${params.follow_up_date || null}, ${params.created_by || "agent"})
  `);
  await db.execute(sql`UPDATE customers SET last_contact_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${params.customer_id} AND tenant_id = ${tid}`);
  return { success: true, message: `Logged ${params.interaction_type} with customer ${params.customer_id}` };
}

export async function customerPipeline(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const res = await db.execute(sql`
    SELECT
      deal_stage,
      COUNT(*) as count,
      COALESCE(SUM(deal_value), 0) as total_value,
      COALESCE(AVG(deal_value), 0) as avg_value
    FROM customers
    WHERE tenant_id = ${tid} AND status = 'active' AND deal_stage NOT IN ('closed_lost', 'churned')
    GROUP BY deal_stage
    ORDER BY CASE deal_stage
      WHEN 'prospect' THEN 1 WHEN 'lead' THEN 2 WHEN 'qualified' THEN 3
      WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 WHEN 'closed_won' THEN 6
      ELSE 7 END
  `);

  const totals = await db.execute(sql`
    SELECT
      COUNT(*) as total_active,
      COALESCE(SUM(deal_value), 0) as total_pipeline_value,
      COUNT(*) FILTER (WHERE deal_stage = 'closed_won') as won_count,
      COALESCE(SUM(deal_value) FILTER (WHERE deal_stage = 'closed_won'), 0) as won_value,
      COALESCE(SUM(total_revenue), 0) as lifetime_revenue
    FROM customers WHERE tenant_id = ${tid} AND status = 'active'
  `);

  return { success: true, pipeline: (res as any).rows, summary: (totals as any).rows[0], message: "Sales pipeline overview" };
}

// ─── CONTRACTS ────────────────────────────────────────────────────────────────

export async function createContract(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.title) return { error: "title required" };

  // Fail-closed ownership check: a caller-supplied customer_id must belong to
  // the caller's tenant before it is stored on the contract row.
  if (params.customer_id) {
    const owned = await db.execute(sql`SELECT id FROM customers WHERE id = ${params.customer_id} AND tenant_id = ${tid} LIMIT 1`);
    if ((owned as any).rows.length === 0) return { error: `customer ${params.customer_id} not found for this tenant` };
  }

  const res = await db.execute(sql`
    INSERT INTO contracts (tenant_id, customer_id, title, contract_type, status, start_date, end_date, value, terms, pdf_url, drive_url)
    VALUES (${tid}, ${params.customer_id || null}, ${params.title}, ${params.contract_type || "service"}, ${params.status || "draft"}, ${params.start_date || null}, ${params.end_date || null}, ${params.value || null}, ${params.terms || null}, ${params.pdf_url || null}, ${params.drive_url || null})
    RETURNING id
  `);
  return { success: true, contract_id: (res as any).rows[0].id, message: `Contract created: ${params.title}` };
}

export async function listContracts(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const statusFilter = params.status ? sql` AND status = ${params.status}` : sql``;
  const res = await db.execute(sql`
    SELECT c.id, c.title, c.contract_type, c.status, c.start_date, c.end_date, c.value, c.signed_at,
      cust.company_name as customer_name
    FROM contracts c LEFT JOIN customers cust ON cust.id = c.customer_id AND cust.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tid} ${statusFilter}
    ORDER BY c.created_at DESC LIMIT ${params.limit || 50}
  `);
  return { success: true, contracts: (res as any).rows, count: (res as any).rows.length };
}

export async function updateContractStatus(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.contract_id) return { error: "contract_id required" };
  if (!VALID_CONTRACT_STATUSES.includes(params.status)) return { error: `Invalid status. Valid: ${VALID_CONTRACT_STATUSES.join(", ")}` };

  let extra = sql``;
  if (params.status === "signed") extra = sql`, signed_at = CURRENT_TIMESTAMP`;
  await db.execute(sql`UPDATE contracts SET status = ${params.status}, updated_at = CURRENT_TIMESTAMP ${extra} WHERE id = ${params.contract_id} AND tenant_id = ${tid}`);
  return { success: true, message: `Contract ${params.contract_id} updated to '${params.status}'` };
}

// ─── KPI METRICS ──────────────────────────────────────────────────────────────

export async function recordKpi(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.metric_name) return { error: "metric_name required" };
  if (params.value === undefined) return { error: "value required" };
  if (!params.category) return { error: "category required (revenue, growth, engagement, operations, financial, marketing, sales, product)" };

  await db.execute(sql`
    INSERT INTO kpi_metrics (tenant_id, metric_name, category, value, target, unit, period, period_start, notes)
    VALUES (${tid}, ${params.metric_name}, ${params.category}, ${params.value}, ${params.target || null}, ${params.unit || "count"}, ${params.period || "monthly"}, ${params.period_start || new Date().toISOString().split("T")[0]}, ${params.notes || null})
  `);
  const pctOfTarget = params.target ? `(${((params.value / params.target) * 100).toFixed(1)}% of target)` : "";
  return { success: true, message: `KPI recorded: ${params.metric_name} = ${params.value} ${params.unit || ""} ${pctOfTarget}` };
}

export async function kpiDashboard(params: any) {
  const tid = tenantGuard(params.tenant_id);

  const latest = await db.execute(sql`
    SELECT DISTINCT ON (metric_name) metric_name, category, value, target, unit, period, period_start, notes,
      CASE WHEN target > 0 THEN ROUND((value / target * 100)::numeric, 1) ELSE null END as pct_of_target
    FROM kpi_metrics WHERE tenant_id = ${tid}
    ORDER BY metric_name, period_start DESC
  `);

  const byCategory = await db.execute(sql`
    SELECT category, COUNT(DISTINCT metric_name) as metric_count,
      AVG(CASE WHEN target > 0 THEN value / target * 100 ELSE null END) as avg_target_pct
    FROM kpi_metrics WHERE tenant_id = ${tid}
      AND period_start >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY category ORDER BY category
  `);

  return { success: true, metrics: (latest as any).rows, categories: (byCategory as any).rows, message: "KPI Dashboard — latest values for all tracked metrics" };
}

export async function kpiTrend(params: any) {
  const tid = tenantGuard(params.tenant_id);
  if (!params.metric_name) return { error: "metric_name required" };

  const res = await db.execute(sql`
    SELECT value, target, period_start, notes,
      CASE WHEN target > 0 THEN ROUND((value / target * 100)::numeric, 1) ELSE null END as pct_of_target
    FROM kpi_metrics
    WHERE tenant_id = ${tid} AND metric_name = ${params.metric_name}
    ORDER BY period_start DESC LIMIT ${params.limit || 12}
  `);

  const rows = (res as any).rows;
  let trend = "insufficient data";
  if (rows.length >= 2) {
    const latest = Number(rows[0].value);
    const previous = Number(rows[1].value);
    const change = previous > 0 ? ((latest - previous) / previous * 100) : 0;
    trend = change > 0 ? `+${change.toFixed(1)}% improvement` : `${change.toFixed(1)}% decline`;
  }

  return { success: true, metric: params.metric_name, history: rows, trend, message: `Trend for ${params.metric_name}: ${trend}` };
}

// ─── BUSINESS REPORTING ───────────────────────────────────────────────────────

export async function profitAndLoss(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const startDate = params.start_date || new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
  const endDate = params.end_date || new Date().toISOString().split("T")[0];

  const revenue = await db.execute(sql`
    SELECT
      COALESCE(SUM(total), 0) as total_invoiced,
      COALESCE(SUM(amount_paid), 0) as total_collected,
      COUNT(*) as invoice_count,
      COUNT(*) FILTER (WHERE status = 'paid') as paid_count
    FROM invoices WHERE tenant_id = ${tid} AND issue_date >= ${startDate} AND issue_date <= ${endDate}
  `);

  const expenses = await db.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0) as total_expenses,
      COUNT(*) as expense_count
    FROM expenses WHERE tenant_id = ${tid} AND date >= ${startDate} AND date <= ${endDate}
  `);

  const expenseBreakdown = await db.execute(sql`
    SELECT category, SUM(amount) as total
    FROM expenses WHERE tenant_id = ${tid} AND date >= ${startDate} AND date <= ${endDate}
    GROUP BY category ORDER BY total DESC
  `);

  const rev = (revenue as any).rows[0];
  const exp = (expenses as any).rows[0];
  const netIncome = Number(rev.total_collected) - Number(exp.total_expenses);

  return {
    success: true,
    period: `${startDate} to ${endDate}`,
    revenue: { invoiced: Number(rev.total_invoiced), collected: Number(rev.total_collected), invoice_count: Number(rev.invoice_count), paid_count: Number(rev.paid_count) },
    expenses: { total: Number(exp.total_expenses), count: Number(exp.expense_count), breakdown: (expenseBreakdown as any).rows },
    net_income: netIncome,
    profit_margin: Number(rev.total_collected) > 0 ? ((netIncome / Number(rev.total_collected)) * 100).toFixed(1) + "%" : "N/A",
    message: `P&L Summary (${startDate} to ${endDate}): Revenue $${Number(rev.total_collected).toFixed(2)}, Expenses $${Number(exp.total_expenses).toFixed(2)}, Net Income $${netIncome.toFixed(2)}`
  };
}

export async function revenueReport(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const months = params.months || 6;

  const res = await db.execute(sql`
    SELECT
      TO_CHAR(issue_date, 'YYYY-MM') as month,
      COUNT(*) as invoice_count,
      SUM(total) as invoiced,
      SUM(amount_paid) as collected,
      AVG(total) as avg_invoice
    FROM invoices WHERE tenant_id = ${tid} AND issue_date >= CURRENT_DATE - (${months} || ' months')::INTERVAL
    GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
    ORDER BY month DESC
  `);

  const topCustomers = await db.execute(sql`
    SELECT customer_name, COUNT(*) as invoice_count, SUM(total) as total_value
    FROM invoices WHERE tenant_id = ${tid} AND issue_date >= CURRENT_DATE - (${months} || ' months')::INTERVAL AND customer_name IS NOT NULL
    GROUP BY customer_name ORDER BY total_value DESC LIMIT 10
  `);

  return { success: true, monthly: (res as any).rows, top_customers: (topCustomers as any).rows, message: `Revenue report — last ${months} months` };
}

export async function cashFlowSummary(params: any) {
  const tid = tenantGuard(params.tenant_id);
  const months = params.months || 3;

  const inflows = await db.execute(sql`
    SELECT
      TO_CHAR(issue_date, 'YYYY-MM') as month,
      SUM(amount_paid) as cash_in
    FROM invoices WHERE tenant_id = ${tid} AND issue_date >= CURRENT_DATE - (${months} || ' months')::INTERVAL
    GROUP BY TO_CHAR(issue_date, 'YYYY-MM')
    ORDER BY month
  `);

  const outflows = await db.execute(sql`
    SELECT
      TO_CHAR(date, 'YYYY-MM') as month,
      SUM(amount) as cash_out
    FROM expenses WHERE tenant_id = ${tid} AND date >= CURRENT_DATE - (${months} || ' months')::INTERVAL
    GROUP BY TO_CHAR(date, 'YYYY-MM')
    ORDER BY month
  `);

  const inflowMap = Object.fromEntries((inflows as any).rows.map((r: any) => [r.month, Number(r.cash_in)]));
  const outflowMap = Object.fromEntries((outflows as any).rows.map((r: any) => [r.month, Number(r.cash_out)]));
  const allMonths = [...new Set([...Object.keys(inflowMap), ...Object.keys(outflowMap)])].sort();

  const monthly = allMonths.map(m => ({
    month: m,
    cash_in: inflowMap[m] || 0,
    cash_out: outflowMap[m] || 0,
    net: (inflowMap[m] || 0) - (outflowMap[m] || 0),
  }));

  const totalIn = monthly.reduce((s, m) => s + m.cash_in, 0);
  const totalOut = monthly.reduce((s, m) => s + m.cash_out, 0);

  return {
    success: true,
    monthly,
    totals: { cash_in: totalIn, cash_out: totalOut, net: totalIn - totalOut },
    message: `Cash flow: $${totalIn.toFixed(2)} in, $${totalOut.toFixed(2)} out, net $${(totalIn - totalOut).toFixed(2)}`
  };
}

export async function businessHealthScore(params: any) {
  const tid = tenantGuard(params.tenant_id);

  const rev = await db.execute(sql`SELECT COALESCE(SUM(amount_paid), 0) as collected, COALESCE(SUM(total), 0) as invoiced FROM invoices WHERE tenant_id = ${tid} AND issue_date >= CURRENT_DATE - INTERVAL '90 days'`);
  const exp = await db.execute(sql`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE tenant_id = ${tid} AND date >= CURRENT_DATE - INTERVAL '90 days'`);
  const overdue = await db.execute(sql`SELECT COUNT(*) as count, COALESCE(SUM(total - amount_paid), 0) as amount FROM invoices WHERE tenant_id = ${tid} AND status != 'paid' AND due_date < CURRENT_DATE`);
  const customers = await db.execute(sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE deal_stage = 'closed_won') as won FROM customers WHERE tenant_id = ${tid}`);
  const kpis = await db.execute(sql`
    SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE target > 0 AND value >= target) as on_target
    FROM (SELECT DISTINCT ON (metric_name) metric_name, value, target FROM kpi_metrics WHERE tenant_id = ${tid} ORDER BY metric_name, period_start DESC) latest
  `);

  const collected = Number((rev as any).rows[0].collected);
  const invoiced = Number((rev as any).rows[0].invoiced);
  const expenses = Number((exp as any).rows[0].total);
  const overdueCount = Number((overdue as any).rows[0].count);
  const overdueAmt = Number((overdue as any).rows[0].amount);
  const totalCustomers = Number((customers as any).rows[0].total);
  const wonCustomers = Number((customers as any).rows[0].won);
  const kpiTotal = Number((kpis as any).rows[0].total);
  const kpiOnTarget = Number((kpis as any).rows[0].on_target);

  const collectionRate = invoiced > 0 ? (collected / invoiced * 100) : 0;
  const profitMargin = collected > 0 ? ((collected - expenses) / collected * 100) : 0;
  const winRate = totalCustomers > 0 ? (wonCustomers / totalCustomers * 100) : 0;
  const kpiHitRate = kpiTotal > 0 ? (kpiOnTarget / kpiTotal * 100) : 0;

  let score = 50;
  if (collectionRate > 80) score += 15; else if (collectionRate > 50) score += 8;
  if (profitMargin > 20) score += 15; else if (profitMargin > 0) score += 5;
  if (overdueCount === 0) score += 10; else if (overdueCount <= 2) score += 5;
  if (winRate > 30) score += 5;
  if (kpiHitRate > 70) score += 5;
  score = Math.min(100, Math.max(0, score));

  let grade = "F";
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";

  return {
    success: true,
    score, grade,
    metrics: {
      collection_rate: `${collectionRate.toFixed(1)}%`,
      profit_margin: `${profitMargin.toFixed(1)}%`,
      overdue_invoices: overdueCount,
      overdue_amount: overdueAmt,
      customer_win_rate: `${winRate.toFixed(1)}%`,
      kpi_hit_rate: `${kpiHitRate.toFixed(1)}%`,
      revenue_90d: collected,
      expenses_90d: expenses,
    },
    message: `Business Health Score: ${score}/100 (Grade: ${grade})`
  };
}

// ─── UNIFIED FINANCIAL SNAPSHOT ──────────────────────────────────────────────

function determineTrend(current: number, previous: number): "up" | "down" | "stable" {
  if (previous === 0 && current === 0) return "stable";
  if (previous === 0) return "up";
  const changePct = ((current - previous) / previous) * 100;
  if (changePct > 2) return "up";
  if (changePct < -2) return "down";
  return "stable";
}

function variancePct(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100.0%" : "0.0%";
  return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
}

export async function financialSnapshot(params: { tenant_id: number; period?: string }): Promise<{ success: boolean; snapshot: FinancialSnapshot }> {
  const tid = tenantGuard(params.tenant_id);
  const period = params.period || "month";

  let currentStart: string, previousStart: string, previousEnd: string, periodLabel: string, prevLabel: string;
  const now = new Date();

  if (period === "quarter") {
    const qNum = Math.floor(now.getMonth() / 3);
    const qMonth = qNum * 3;
    currentStart = new Date(now.getFullYear(), qMonth, 1).toISOString().split("T")[0];
    const prevQDate = new Date(now.getFullYear(), qMonth - 3, 1);
    previousStart = prevQDate.toISOString().split("T")[0];
    previousEnd = new Date(now.getFullYear(), qMonth, 0).toISOString().split("T")[0];
    periodLabel = `Q${qNum + 1} ${now.getFullYear()}`;
    const prevQNum = Math.floor(prevQDate.getMonth() / 3);
    prevLabel = `Q${prevQNum + 1} ${prevQDate.getFullYear()}`;
  } else if (period === "year") {
    currentStart = new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0];
    previousStart = new Date(now.getFullYear() - 1, 0, 1).toISOString().split("T")[0];
    previousEnd = new Date(now.getFullYear() - 1, 11, 31).toISOString().split("T")[0];
    periodLabel = `${now.getFullYear()}`;
    prevLabel = `${now.getFullYear() - 1}`;
  } else {
    currentStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    previousStart = prevMonthDate.toISOString().split("T")[0];
    previousEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
    periodLabel = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;
    prevLabel = `${prevMonthDate.toLocaleString("default", { month: "long" })} ${prevMonthDate.getFullYear()}`;
  }

  const currentEnd = now.toISOString().split("T")[0];

  const [revCurrent, revPrevious, agingResult, avgAge, expCurrent, expPrevious, topCats] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(total), 0) as invoiced, COALESCE(SUM(amount_paid), 0) as collected, COUNT(*) as count
      FROM invoices WHERE tenant_id = ${tid} AND issue_date >= ${currentStart} AND issue_date <= ${currentEnd}
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(total), 0) as invoiced, COALESCE(SUM(amount_paid), 0) as collected
      FROM invoices WHERE tenant_id = ${tid} AND issue_date >= ${previousStart} AND issue_date <= ${previousEnd}
    `),
    db.execute(sql`
      SELECT
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status IN ('sent','draft') AND due_date >= CURRENT_DATE), 0) as current_bucket,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE AND due_date >= CURRENT_DATE - INTERVAL '30 days'), 0) as days_30,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days'), 0) as days_60,
        COALESCE(SUM(total - amount_paid) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE - INTERVAL '60 days'), 0) as days_90_plus,
        COUNT(*) FILTER (WHERE status != 'paid' AND due_date < CURRENT_DATE) as overdue_count
      FROM invoices WHERE tenant_id = ${tid}
    `),
    db.execute(sql`
      SELECT 0 as avg_days
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses
      WHERE tenant_id = ${tid} AND date >= ${currentStart} AND date <= ${currentEnd}
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses
      WHERE tenant_id = ${tid} AND date >= ${previousStart} AND date <= ${previousEnd}
    `),
    db.execute(sql`
      SELECT category, SUM(amount) as amount FROM expenses
      WHERE tenant_id = ${tid} AND date >= ${currentStart} AND date <= ${currentEnd}
      GROUP BY category ORDER BY amount DESC LIMIT 5
    `),
  ]);

  const curRev = Number((revCurrent as any).rows[0].invoiced);
  const curCollected = Number((revCurrent as any).rows[0].collected);
  const prevRev = Number((revPrevious as any).rows[0].invoiced);
  const curExp = Number((expCurrent as any).rows[0].total);
  const prevExp = Number((expPrevious as any).rows[0].total);
  const aging = (agingResult as any).rows[0];
  const avgDays = Math.round(Number((avgAge as any).rows[0].avg_days));

  const netIncome = curCollected - curExp;
  const prevCollected = Number((revPrevious as any).rows[0].collected);
  const prevNetIncome = prevCollected - prevExp;

  const monthlyBurn = curExp > 0 ? curExp : null;
  const cashOnHand = curCollected;
  const runwayMonths = monthlyBurn && monthlyBurn > 0 ? Math.round((cashOnHand / monthlyBurn) * 10) / 10 : null;

  let healthScore = 50;
  const collectionRate = curRev > 0 ? (curCollected / curRev * 100) : 0;
  if (collectionRate > 80) healthScore += 15; else if (collectionRate > 50) healthScore += 8;
  const margin = curCollected > 0 ? ((netIncome / curCollected) * 100) : 0;
  if (margin > 20) healthScore += 15; else if (margin > 0) healthScore += 5;
  if (Number(aging.overdue_count) === 0) healthScore += 10; else if (Number(aging.overdue_count) <= 2) healthScore += 5;
  if (determineTrend(curRev, prevRev) === "up") healthScore += 10;
  healthScore = Math.min(100, Math.max(0, healthScore));
  const grade = healthScore >= 90 ? "A" : healthScore >= 80 ? "B" : healthScore >= 70 ? "C" : healthScore >= 60 ? "D" : "F";

  const snapshot: FinancialSnapshot = {
    period: periodLabel,
    previousPeriod: prevLabel,
    revenue: {
      current: curRev,
      previous: prevRev,
      variance: curRev - prevRev,
      variancePct: variancePct(curRev, prevRev),
      trend: determineTrend(curRev, prevRev),
      collected: curCollected,
      collectionRate: curRev > 0 ? `${(curCollected / curRev * 100).toFixed(1)}%` : "N/A",
    },
    collections: {
      total: curCollected,
      aging: {
        current: Number(aging.current_bucket),
        days30: Number(aging.days_30),
        days60: Number(aging.days_60),
        days90plus: Number(aging.days_90_plus),
      },
      overdueCount: Number(aging.overdue_count),
      averageAgeDays: avgDays,
    },
    expenses: {
      current: curExp,
      previous: prevExp,
      variance: curExp - prevExp,
      variancePct: variancePct(curExp, prevExp),
      trend: determineTrend(curExp, prevExp),
      topCategories: (topCats as any).rows.map((r: any) => ({ category: r.category, amount: Number(r.amount) })),
    },
    netIncome,
    previousNetIncome: prevNetIncome,
    netTrend: determineTrend(netIncome, prevNetIncome),
    profitMargin: curCollected > 0 ? `${margin.toFixed(1)}%` : "N/A",
    burnRate: monthlyBurn,
    runwayMonths,
    healthGrade: `${grade} (${healthScore}/100)`,
  };

  return { success: true, snapshot };
}
