export const PILOT_PRICE_USD = 175;
export const MAX_PILOT_JOBS = 30;
export const MAX_PILOT_INVOICES = 300;
export const MAX_PILOT_CSV_CHARS = 16_000;
export const JOB_HEADER = "job_id,completed_date,billing_status";
export const INVOICE_HEADER = "job_id,invoice_status";
export const SAMPLE_JOBS = `${JOB_HEADER}\nJ-101,2026-11-03,READY\nJ-102,2026-11-04,READY\nJ-103,2026-11-05,HOLD`;
export const SAMPLE_INVOICES = `${INVOICE_HEADER}\nJ-101,SENT`;

const BILLING_STATUSES = ["READY", "HOLD", "NON_BILLABLE", "UNKNOWN"] as const;
const INVOICE_STATUSES = ["SENT", "PAID", "DRAFT", "VOID", "UNKNOWN"] as const;
export const BILLING_FINDINGS = {
  "verify-for-invoicing": { label: "Verify for invoicing", action: "Check the billing system and source records before any invoice is sent." },
  "needs-info": { label: "Insufficient information", action: "Resolve the invoice status or missing billing information with the office." },
  "conflicting-status": { label: "Conflicting job and invoice statuses", action: "A sent or paid invoice was found for a held or non-billable job. Reconcile with the office." },
  "hold": { label: "Billing hold", action: "Leave on hold; confirm the reason and review date with the office." },
  "non-billable": { label: "Non-billable", action: "No invoice action based on the supplied job status." },
  "invoice-found": { label: "Sent or paid invoice found", action: "No missing invoice flagged. This does not verify billing completeness or payment." },
} as const;
export const REVIEW_LABELS = {
  pending: "Pending office review",
  "office-confirmed": "Confirmed by office",
  excluded: "Not an exception",
} as const;

type InvoiceStatus = typeof INVOICE_STATUSES[number];
export type ReviewDecision = "pending" | "office-confirmed" | "excluded";
export type BillingFinding = keyof typeof BILLING_FINDINGS;
export type BillingPilotRow = { jobId: string; completedDate: string; finding: BillingFinding };

// A deliberately narrow CSV template: fields are codes, dates, or enums and
// cannot contain commas, newlines, or escaped quotes. No general CSV ingestion.
function cells(source: string, header: string, name: string, limit: number) {
  if (source.length > MAX_PILOT_CSV_CHARS) throw new Error(`${name} is too large. Use the supplied template.`);
  const split = (line: string) => line.split(",").map(cell => cell.trim().replace(/^"([^"]*)"$/, "$1"));
  const [first, ...rest] = source.replace(/^\uFEFF/, "").trimEnd().split(/\r\n|\n|\r/);
  if (split(first).join(",") !== header) {
    throw new Error(`${name} must start with ${header}. Remove all other columns.`);
  }
  const width = header.split(",").length;
  const rows = rest.flatMap((line, index) => {
    if (!line.trim()) return [];
    const rowNumber = index + 2;
    const fields = split(line);
    if (fields.length !== width || !/^J-\d{1,8}$/.test(fields[0])) {
      throw new Error(`${name} row ${rowNumber}: use the template and a coded job ID, like J-101.`);
    }
    return [{ fields, rowNumber }];
  });
  if (rows.length > limit) throw new Error(`${name} allows up to ${limit} records.`);
  return rows;
}

export function reconcileBillingPilot(jobsCsv: string, invoicesCsv: string) {
  const jobRecords = cells(jobsCsv, JOB_HEADER, "Jobs CSV", MAX_PILOT_JOBS);
  if (!jobRecords.length) throw new Error("Jobs CSV needs at least one completed job.");
  const seen = new Set<string>();
  const jobs = jobRecords.map(({ fields: [jobId, completedDate, status], rowNumber }) => {
    if (seen.has(jobId)) throw new Error(`Jobs CSV row ${rowNumber}: duplicate job ID. Keep one row per job.`);
    seen.add(jobId);
    const date = new Date(`${completedDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate) || !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== completedDate) {
      throw new Error(`Jobs CSV row ${rowNumber}: use a valid completed date, like 2026-11-03.`);
    }
    if (!BILLING_STATUSES.some(value => value === status)) {
      throw new Error(`Jobs CSV row ${rowNumber}: use READY, HOLD, NON_BILLABLE or UNKNOWN.`);
    }
    return { jobId, completedDate, status };
  });
  const invoiceRecords = cells(invoicesCsv, INVOICE_HEADER, "Invoices CSV", MAX_PILOT_INVOICES);
  const invoices = new Map<string, Set<InvoiceStatus>>();
  for (const { fields: [jobId, status], rowNumber } of invoiceRecords) {
    const value = INVOICE_STATUSES.find(candidate => candidate === status);
    if (!value) throw new Error(`Invoices CSV row ${rowNumber}: use SENT, PAID, DRAFT, VOID or UNKNOWN.`);
    if (!invoices.has(jobId)) invoices.set(jobId, new Set());
    invoices.get(jobId)!.add(value);
  }
  const rows = jobs.map<BillingPilotRow>(({ jobId, completedDate, status }) => {
    const related = invoices.get(jobId);
    const issued = related?.has("PAID") || related?.has("SENT");
    const finding =
      issued && (status === "HOLD" || status === "NON_BILLABLE") ? "conflicting-status" :
      issued ? "invoice-found" :
      status === "HOLD" ? "hold" :
      status === "NON_BILLABLE" ? "non-billable" :
      related || status === "UNKNOWN" ? "needs-info" : "verify-for-invoicing";
    return { jobId, completedDate, finding };
  });
  return {
    rows, invoiceCount: invoiceRecords.length,
    outsideBatchCount: invoiceRecords.filter(({ fields }) => !seen.has(fields[0])).length,
  };
}

const csvCell = (value: string) => {
  const text = /^\s*[=+\-@]|\t|\r/.test(value) ? `'${value}` : value;
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The owner chooses whether and where to send this neutral report. */
export function exportBillingPilot(rows: readonly BillingPilotRow[], reviews: ReadonlyMap<string, ReviewDecision>) {
  return [
    "job_id,completed_date,finding,office_review,next_step",
    ...rows.map(row => {
      const canReview = row.finding === "verify-for-invoicing";
      const review = canReview ? reviews.get(row.jobId) ?? "pending" : undefined;
      const next = review === "excluded" ? "No follow-up requested by the office." :
        review === "office-confirmed" ? "Office owns any invoice action. Recheck for duplicates before sending." :
        BILLING_FINDINGS[row.finding].action;
      return [row.jobId, row.completedDate, BILLING_FINDINGS[row.finding].label,
        review ? REVIEW_LABELS[review] : "Not applicable", next].map(csvCell).join(",");
    }),
  ].join("\r\n") + "\r\n";
}
