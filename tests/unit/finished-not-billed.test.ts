import assert from "node:assert/strict";
import test from "node:test";
import * as audit from "../../shared/lib/finished-not-billed";
import { getOwnerServiceOfferings } from "../../server/lib/owner-service-offerings";
import { getPublicSiteConfig } from "../../server/site-config";
const { reconcileBillingPilot, JOB_HEADER, INVOICE_HEADER, SAMPLE_JOBS, SAMPLE_INVOICES } = audit;

test("a paid or sent record is evidence; absence, holds and ambiguous records stay distinct", () => {
  const jobs = `job_id,completed_date,billing_status
J-1,2026-11-01,READY
J-2,2026-11-02,READY
J-3,2026-11-03,HOLD
J-4,2026-11-04,UNKNOWN
J-5,2026-11-05,READY
J-6,2026-11-06,NON_BILLABLE`;
  const invoices = `job_id,invoice_status
J-1,PAID
J-1,VOID
J-5,DRAFT`;
  const { rows } = reconcileBillingPilot(jobs, invoices);
  assert.deepEqual(rows.map(row => row.finding), [
    "invoice-found", "verify-for-invoicing", "hold", "needs-info", "needs-info", "non-billable",
  ]);
});

test("bad identifiers, extra columns, dates, duplicate jobs and oversized batches fail without echoing input", () => {
  for (const invalid of [
    "job_id,completed_date,billing_status,customer\nJ-1,2026-11-01,READY,Fake Name",
    `${JOB_HEADER}\n=BAD(),2026-11-01,READY`,
    `${JOB_HEADER}\nJ-1,2026-02-29,READY`,
    `${JOB_HEADER}\nJ-1,2026-11-01,READY\nJ-1,2026-11-02,READY`,
    `${JOB_HEADER}\n${Array.from({ length: 31 }, (_, i) => `J-${i},2026-11-01,READY`).join("\n")}`,
  ]) assert.throws(() => reconcileBillingPilot(invalid, INVOICE_HEADER), error => {
    assert.match(String(error), /Jobs CSV/);
    assert.doesNotMatch(String(error), /Fake Name|BAD\(\)/);
    return true;
  });
  assert.throws(() => reconcileBillingPilot(SAMPLE_JOBS, `${INVOICE_HEADER}\nJ-101,,extra`), /Invoices CSV row 2/);
  assert.throws(() => reconcileBillingPilot(SAMPLE_JOBS, `${INVOICE_HEADER}\n${"J-101,SENT\n".repeat(301)}`), /300 records/);
  assert.throws(() => reconcileBillingPilot(SAMPLE_JOBS, " ".repeat(16001)), /too large/);
});

test("an empty invoice file is explicit and unmatched invoice records are counted", () => {
  assert.throws(() => reconcileBillingPilot(SAMPLE_JOBS, ""), /Invoices CSV must start/);
  const result = reconcileBillingPilot(`\uFEFF${JOB_HEADER}\r\n"J-101","2026-11-03","READY"`, `${INVOICE_HEADER}\r\nJ-900,SENT`);
  assert.equal(result.outsideBatchCount, 1);
  assert.equal(result.rows[0].finding, "verify-for-invoicing");
});

test("client handoff never marks unreviewed results as office-confirmed", () => {
  const result = reconcileBillingPilot(SAMPLE_JOBS, SAMPLE_INVOICES);
  const pending = audit.exportBillingPilot(result.rows, new Map([["J-101", "office-confirmed"]]));
  assert.match(pending, /J-102,2026-11-04,Verify for invoicing,Pending office review,/);
  assert.doesNotMatch(pending, /Confirmed by office/);
  const reviewed = audit.exportBillingPilot(result.rows, new Map([["J-102", "office-confirmed"]]));
  assert.match(reviewed, /J-102,2026-11-04,Verify for invoicing,Confirmed by office,/);
  assert.doesNotMatch(reviewed, /VisionClaw|https?:\/\//);
});

test("a sent or paid invoice does not hide a conflicting HOLD or NON_BILLABLE status", () => {
  const result = reconcileBillingPilot(`${JOB_HEADER}\nJ-1,2026-11-01,HOLD\nJ-2,2026-11-01,NON_BILLABLE`,
    `${INVOICE_HEADER}\nJ-1,SENT\nJ-2,PAID`);
  assert.deepEqual(result.rows.map(row => row.finding), ["conflicting-status", "conflicting-status"]);
  assert.match(audit.exportBillingPilot(result.rows, new Map()), /Conflicting job and invoice statuses/);
});

test("the same stop switch hides the workbench config and removes owner discovery", () => {
  const key = "FINISHED_NOT_BILLED_ENABLED";
  const old = process.env[key];
  try {
    for (const value of ["0", "1"]) {
      process.env[key] = value;
      assert.equal(getPublicSiteConfig().finishedNotBilledEnabled, value === "1");
      assert.equal(getOwnerServiceOfferings().some(offer => offer.path === "/admin/finished-not-billed"), value === "1");
    }
  } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
});
