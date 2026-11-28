#!/usr/bin/env tsx
/**
 * Deterministic release gate. This performs no model calls and never changes
 * the application. Both policies require an authoritative completed audit:
 * either current full-audit evidence, or the preserved baseline plus exact
 * independently accepted current-source/delta evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { computeTenantAuditEvidenceHash } from "./lib/tenant-audit-evidence-hash";
import { verifyIncrementalReadiness } from "./lib/republish-incremental-readiness";

const root = path.resolve(process.env.AUDIT_EVIDENCE_ROOT || ".");
const incremental = fs.existsSync(path.join(root, ".local/republication-triage/acceptance.json"));
const baselineReportPath = path.join(root, "generated-artifacts/republish-audit-baseline/data/tenant-isolation-audit/latest.json");
const reportPath = incremental ? baselineReportPath
  : path.resolve(process.env.AUDIT_REPORT_JSON || path.join(root, "data/tenant-isolation-audit/latest.json"));
const checkpointPath = path.resolve(process.env.AUDIT_CHECKPOINT_JSON || path.join(root, "data/tenant-isolation-audit/checkpoint.json"));

function fail(reason: string): never {
  console.error(`[republish-readiness] NOT READY: ${reason}`);
  process.exit(1);
}

if (incremental && process.env.AUDIT_REPORT_JSON &&
    path.resolve(process.env.AUDIT_REPORT_JSON) !== baselineReportPath)
  fail("baseline-plus-review requires the preserved baseline report, not an override");
if (!fs.existsSync(reportPath)) fail("authoritative tenant-isolation report is missing");
if (!incremental && fs.existsSync(checkpointPath)) fail("tenant-isolation audit checkpoint still exists");

let report: any;
try {
  if (!fs.lstatSync(reportPath).isFile() || fs.realpathSync(reportPath) !== reportPath)
    fail("authoritative tenant-isolation report is not a regular evidence file");
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch {
  fail("tenant-isolation report is not valid JSON");
}

const coverage = report?.coverage;
if (
  report?.degraded !== false ||
  !coverage ||
  !Number.isInteger(coverage.scanned) ||
  !Number.isInteger(coverage.chunksAttempted) ||
  coverage.chunksSucceeded !== coverage.chunksAttempted ||
  (coverage.chunksFailed || 0) !== 0 ||
  (coverage.chunksPending || 0) !== 0 ||
  coverage.filesAudited < coverage.scanned ||
  coverage.sourceChangedDuringRun !== false ||
  !Array.isArray(coverage.failures) ||
  coverage.failures.length !== 0 ||
  !Array.isArray(coverage.unreadableFiles) ||
  coverage.unreadableFiles.length !== 0
) {
  fail("audit coverage is incomplete, degraded, or has failures");
}

if (!Array.isArray(report.findings) || !Array.isArray(report.suppressed) || !Array.isArray(report.severeDispositions)) {
  fail("audit report shape is incomplete");
}

const currentEvidenceHash = incremental ? undefined : computeTenantAuditEvidenceHash(root);
if (
  !incremental && (
  typeof report.evidenceHash !== "string" ||
  report.evidenceHash.length !== 64 ||
  report.evidenceHash !== currentEvidenceHash
  )
) {
  fail("audit report does not match the current server/audit inputs");
}

const findingKey = (f: any) => JSON.stringify([f?.file, f?.line ?? null, f?.severity, f?.issue]);
const rawSevere = report.findings.filter((f: any) => f?.severity === "CRITICAL" || f?.severity === "HIGH");
const rawKeys = new Set(rawSevere.map(findingKey));
const dispositionKeys = new Set<string>();
const validDispositions = new Set([
  "kept",
  "precision-false-positive",
  "allowlist-false-positive",
  "deferred-real-risk",
]);
for (const item of report.severeDispositions) {
  const key = findingKey(item);
  if (!rawKeys.has(key) || !validDispositions.has(item?.disposition) || dispositionKeys.has(key)) {
    fail("severe finding disposition partition is invalid");
  }
  dispositionKeys.add(key);
}
if (dispositionKeys.size !== rawKeys.size || report.severeDispositions.length !== rawSevere.length) {
  fail("severe finding disposition partition is incomplete");
}

const kept = report.severeDispositions.filter((f: any) => f.disposition === "kept");
const deferred = report.severeDispositions.filter((f: any) => f.disposition === "deferred-real-risk");
if (incremental) {
  try {
    verifyIncrementalReadiness(root, report, fs.readFileSync(reportPath));
  } catch (error) {
    fail(`baseline-plus-review rejected: ${error instanceof Error ? error.message : "invalid evidence"}`);
  }
  if (fs.existsSync(checkpointPath))
    console.log("[republish-readiness] Separate audit checkpoint preserved; not completion evidence");
  console.log(`[republish-readiness] READY: verified audit baseline + independent delta/disposition review; ` +
    `${kept.length + deferred.length} retained allegations accounted for; no publish authority`);
  process.exit(0);
}
if (kept.length > 0 || deferred.length > 0) {
  fail(`${kept.length} kept CRITICAL/HIGH finding(s) and ${deferred.length} deferred real-risk finding(s) remain`);
}

console.log(
  `[republish-readiness] READY: ${coverage.scanned} files, ` +
  `${coverage.chunksSucceeded}/${coverage.chunksAttempted} chunks, ` +
  `${report.suppressed.length} suppressed finding(s), zero unresolved severe findings`,
);