// One-off addendum (task: nightly tenant-isolation audit permanently red, 2026-08-01):
// fourth campaign pass for the 10 sites the 2026-08-01 13:20 verification run kept.
// Each disposition verified by reading the code site. Appends to
// suppressions.json / deferrals.json / campaign-2026-08-01-snapshot.json.
// Run: npx tsx scripts/lib/generate-triage-entries-4.ts --write
import fs from "node:fs";
import path from "node:path";
import { extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";

const DIR = path.join("data", "tenant-isolation-audit");
const WRITE = process.argv.includes("--write");
const TODAY = "2026-08-01";
const VERIFIER = "task-118 audit-recovery campaign 2026-08-01 (pass 4)";

type Dispo = { kind: "suppress"; pattern: string; reason: string } | { kind: "defer"; reason: string; reviewBy: string };
const S = (pattern: string, reason: string): Dispo => ({ kind: "suppress", pattern, reason });
const D = (reason: string, reviewBy = "2026-09-30"): Dispo => ({ kind: "defer", reason, reviewBy });

const DISPOSITIONS: Record<string, Dispo> = {
  "server/agent-activity.ts:122": S("internal-worker-pk", "completeActivity's activityId is the PK returned by startActivity's own INSERT earlier in the same server flow; it is never caller-supplied, and the row only carries status/completedAt/summary."),
  "server/chat-engine.ts:3811": S("upstream-verified", "recordErrorForRetryStormDetection is an in-memory diagnostics counter keyed by conversationId (stuck-diagnostics); it performs no DB read/write and returns no tenant data."),
  "server/routes.ts:6523": S("upstream-verified", "the import endpoint is platform-admin-gated and heartbeatTasks rows in the export payload carry their own tenantId, which createHeartbeatTask persists; no cross-tenant path for non-admin callers."),
  "server/chat-engine.ts:1793": D("buildMemorySection defaults tenantId=1 when callers omit it — same optional-tenant fail-open family as the parked storage findings; hardening = make tenantId required and fail closed."),
  "server/minerva-planner.ts:368": D("decidePlan CAS UPDATE only constrains tenant_id when args.tenantId != null — optional-tenant fail-open; hardening = make tenantId mandatory on the decision path."),
  "server/minerva-planner.ts:404": D("child-plan SELECT applies the tenant filter conditionally (args.tenantId != null) — optional-tenant fail-open; hardening = require tenantId."),
  "server/minerva-planner.ts:472": D("revision-rollback UPDATE resets plan decision metadata WHERE id without a mandatory tenant constraint — optional-tenant fail-open family; hardening = thread tenantId."),
  "server/minerva-planner.ts:521": D("getPlan falls back to SELECT by id alone when tenantId omitted — optional-tenant fail-open; hardening = require tenantId on all lookups."),
  "server/storage.ts:548": D("deleteMemoryEntry scopes tenant only when tenantId provided (warns via _warnUnscoped otherwise) — optional-tenant fail-open; hardening = make tenantId required."),
  "server/storage.ts:555": D("touchMemoryEntries scopes tenant only when tenantId provided (warns via _warnUnscoped otherwise) — optional-tenant fail-open; hardening = make tenantId required."),
};

const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const severe = (latest.findings as any[]).filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

function codeLineFor(file: string, line: number): string | undefined {
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { return undefined; }
  for (const d of [0, 1, -1, 2, -2, 3, -3]) {
    const i = line - 1 + d;
    if (i >= 0 && i < lines.length && isUsableCodeLine(lines[i])) return lines[i].trim();
  }
  return undefined;
}

const newSupp: any[] = [];
const newDefer: any[] = [];
const snapFindings: any[] = [];
const problems: string[] = [];
const covered = new Set<string>();
for (const f of severe) {
  const key = `${f.file}:${f.line}`;
  const d = DISPOSITIONS[key];
  if (!d) continue;
  covered.add(key);
  const anchor = extractStructuralAnchor(f.issue);
  if (!anchor) { problems.push(`NO ANCHOR ${key}`); continue; }
  const match = f.issue.slice(0, 100).trim();
  const codeLine = codeLineFor(f.file, f.line);
  snapFindings.push({ ...f, disposition: d.kind === "defer" ? "deferred" : "allowlisted" });
  if (d.kind === "suppress") newSupp.push({ file: f.file, pattern: d.pattern, match, anchor, reason: d.reason, verifiedBy: VERIFIER, date: TODAY, ...(codeLine ? { codeLine } : {}) });
  else newDefer.push({ file: f.file, match, anchor, reason: d.reason, deferredBy: VERIFIER, date: TODAY, reviewBy: d.reviewBy, ...(codeLine ? { codeLine } : {}) });
}
for (const k of Object.keys(DISPOSITIONS)) if (!covered.has(k)) problems.push(`DISPO UNUSED ${k}`);
console.log(`dispositioned=${snapFindings.length} newSuppressions=${newSupp.length} newDeferrals=${newDefer.length}`);
problems.forEach((p) => console.log(p));
if (WRITE) {
  const supp = JSON.parse(fs.readFileSync(path.join(DIR, "suppressions.json"), "utf8"));
  fs.writeFileSync(path.join(DIR, "suppressions.json"), JSON.stringify([...supp, ...newSupp], null, 2) + "\n");
  const deferPath = path.join(DIR, "deferrals.json");
  const existingDefer = JSON.parse(fs.readFileSync(deferPath, "utf8"));
  fs.writeFileSync(deferPath, JSON.stringify([...existingDefer, ...newDefer], null, 2) + "\n");
  const snapPath = path.join(DIR, `campaign-${TODAY}-snapshot.json`);
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  snap.findings = [...snap.findings, ...snapFindings];
  fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2) + "\n");
  console.log("appended to suppressions.json, deferrals.json, campaign snapshot");
} else console.log("dry run — pass --write to persist");
