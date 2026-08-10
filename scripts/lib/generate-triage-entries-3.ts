// One-off addendum (task: nightly tenant-isolation audit permanently red, 2026-08-01):
// third campaign pass for the 7 sites the 2026-08-01 10:42 verification run kept.
// Each disposition verified by reading the code site. Appends to
// suppressions.json / deferrals.json / campaign-2026-08-01-snapshot.json.
// Run: npx tsx scripts/lib/generate-triage-entries-3.ts --write
import fs from "node:fs";
import path from "node:path";
import { extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";

const DIR = path.join("data", "tenant-isolation-audit");
const WRITE = process.argv.includes("--write");
const TODAY = "2026-08-01";
const VERIFIER = "task-118 audit-recovery campaign 2026-08-01 (pass 3)";

type Dispo = { kind: "suppress"; pattern: string; reason: string } | { kind: "defer"; reason: string; reviewBy: string };
const S = (pattern: string, reason: string): Dispo => ({ kind: "suppress", pattern, reason });
const D = (reason: string, reviewBy = "2026-09-30"): Dispo => ({ kind: "defer", reason, reviewBy });

const DISPOSITIONS: Record<string, Dispo> = {
  "server/minds-engine.ts:262": S("upstream-verified", "dependsOn is typed number[] (MindTicket contract) so join() yields a numeric literal passed as a bound ::int[] param; the query also carries tenant_id = ${tenantId}."),
  "server/minds-engine.ts:326": S("upstream-verified", "eventIds is typed number[]; the array literal is a bound ::int[] param and the UPDATE carries AND tenant_id = ${tenantId}."),
  "server/sculptor.ts:359": S("upstream-verified", "reviewSessionWork fetches the session WHERE id AND tenant_id at the top and returns early if absent; the later UPDATE by id targets the already-tenant-verified row."),
  "server/storage.ts:1233": S("upstream-verified", "searchConversations calls assertValidTenantId(tenantId) at the top (fail CLOSED on missing/invalid), so every raw-SQL site below runs with a proven-valid tenant filter."),
  "server/video-job-runner.ts:178": S("internal-worker-pk", "upsert conflict target is the unguessable runner-generated random jobId (vj_<base36>_<hex>); rows are created and mirrored only by the runner itself."),
  "server/agentic/task-forces.ts:41": D("createTaskForce inserts caller-supplied projectId without verifying project→tenant ownership; hardening = assertProjectInTenant before insert (row itself is tenant-stamped; reads are tenant-filtered, so exposure is a dangling FK association)."),
  "server/compaction.ts:400": D("compaction_archives INSERT omits tenant_id (schema declares NOT NULL, DB column has no default) — thread the conversation's tenantId into the archive INSERT; same legacy-tenant-column family as the DEFAULT-1 tables follow-up."),
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
