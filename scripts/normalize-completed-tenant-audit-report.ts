#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { computeTenantAuditEvidenceHash } from "./lib/tenant-audit-evidence-hash";

const reportPath = path.resolve("data/tenant-isolation-audit/latest.json");
const markdownPath = path.resolve("docs/tenant-isolation-audit-report.md");
const checkpointPath = path.resolve("data/tenant-isolation-audit/checkpoint.json");

function fail(message: string): never {
  console.error(`[tenant-audit-normalize] REFUSED: ${message}`);
  process.exit(1);
}

if (fs.existsSync(checkpointPath)) fail("checkpoint exists; audit is not final");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const currentEvidenceHash = computeTenantAuditEvidenceHash(path.resolve("."));
if (
  typeof report.evidenceHash !== "string" ||
  report.evidenceHash.length !== 64 ||
  report.evidenceHash !== currentEvidenceHash
) fail("report evidence hash is stale; a report-only migration cannot refresh audit evidence");
const coverage = report.coverage;
if (
  report.degraded !== false ||
  !coverage ||
  coverage.chunksSucceeded !== coverage.chunksAttempted ||
  coverage.chunksFailed !== 0 ||
  (coverage.chunksPending || 0) !== 0 ||
  coverage.filesAudited !== coverage.scanned ||
  coverage.failures?.length !== 0 ||
  coverage.unreadableFiles?.length !== 0 ||
  coverage.sourceChangedDuringRun !== false
) fail("report is not an authoritative completed audit");
if (!Array.isArray(report.findings) || !Array.isArray(report.suppressed)) fail("report arrays are missing");

const key = (f: any) => JSON.stringify([f.file, f.line ?? null, f.severity, f.issue]);
const rawSevere = report.findings.filter((f: any) => f.severity === "CRITICAL" || f.severity === "HIGH");
const suppressedByKey = new Map(report.suppressed.map((f: any) => [key(f), f]));
if (suppressedByKey.size !== report.suppressed.length) fail("duplicate suppressed finding identity");

const severeDispositions = rawSevere.map((finding: any) => {
  const resolved: any = suppressedByKey.get(key(finding));
  if (!resolved) return { ...finding, disposition: "kept" };
  if (resolved.pattern === "deferred") {
    return { ...finding, disposition: "deferred-real-risk", pattern: resolved.pattern, reason: resolved.reason };
  }
  const disposition = String(resolved.reason || "").startsWith("allowlist (")
    ? "allowlist-false-positive"
    : "precision-false-positive";
  return { ...finding, disposition, pattern: resolved.pattern, reason: resolved.reason };
});
if (severeDispositions.length !== rawSevere.length) fail("disposition partition is incomplete");

const counts = {
  kept: severeDispositions.filter((f: any) => f.disposition === "kept").length,
  precision: severeDispositions.filter((f: any) => f.disposition === "precision-false-positive").length,
  allowlist: severeDispositions.filter((f: any) => f.disposition === "allowlist-false-positive").length,
  deferred: severeDispositions.filter((f: any) => f.disposition === "deferred-real-risk").length,
};
if (counts.kept + counts.precision + counts.allowlist + counts.deferred !== rawSevere.length) {
  fail("disposition counts do not partition raw severe findings");
}

report.severeDispositions = severeDispositions;
report.normalizedAt = new Date().toISOString();
report.normalization = "report-only disposition migration; findings, verdicts, coverage, and generatedAt preserved";

let markdown = fs.readFileSync(markdownPath, "utf8");
markdown = markdown.replace(
  /^- Precision second-pass .*$/m,
  `- Severe dispositions: **${counts.kept} kept** · ${counts.precision} precision false-positive · ` +
    `${counts.allowlist} allowlist false-positive · ${counts.deferred} deferred real risk`,
);
const heading = `### Suppressed — confirmed false positives (${report.suppressed.length})`;
const headingAt = markdown.indexOf(heading);
if (headingAt < 0) fail("legacy suppression section heading not found");
const prefix = markdown.slice(0, headingAt);
const legacy = markdown.slice(headingAt + heading.length);
const blocks = legacy.split(/\n(?=- \*\*)/).filter((block) => block.trim().startsWith("- **"));
const deferredBlocks = blocks.filter((block) => block.includes("_(deferred)_"));
const falseBlocks = blocks.filter((block) => !block.includes("_(deferred)_"));
if (deferredBlocks.length !== counts.deferred || falseBlocks.length !== counts.precision + counts.allowlist) {
  fail("Markdown suppression blocks do not match disposition counts");
}
const falseSection =
  `### Resolved — confirmed false positives (${falseBlocks.length})\n\n` +
  `_Cleared by precision triage or the human-verified allowlist; shown for the audit trail, not counted toward pass/fail._\n\n` +
  falseBlocks.join("\n");
const deferredSection =
  `\n\n### Deferred — accepted real risks (${deferredBlocks.length})\n\n` +
  `_These are genuine findings under dated deferral. They still block republish readiness._\n\n` +
  deferredBlocks
    .map((block) => block.replace("_(deferred)_ — ", "— ").replace("_Why false positive:_", "_Deferral:_"))
    .join("\n");
const normalizedMarkdown = `${prefix}${falseSection}${deferredSection}\n`;
fs.writeFileSync(markdownPath, normalizedMarkdown);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(
  `[tenant-audit-normalize] complete: ${counts.kept} kept, ${counts.precision} precision false-positive, ` +
  `${counts.allowlist} allowlist false-positive, ${counts.deferred} deferred real risk`,
);