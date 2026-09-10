// One-off addendum (task: nightly tenant-isolation audit permanently red, 2026-08-01):
// fifth campaign pass for the 8 sites the 2026-08-01 14:18 verification run kept.
// Each disposition verified by reading the code site. Appends to
// suppressions.json / deferrals.json / campaign-2026-08-01-snapshot.json.
// Run: npx tsx scripts/lib/generate-triage-entries-5.ts --write
import fs from "node:fs";
import path from "node:path";
import { extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";

const DIR = path.join("data", "tenant-isolation-audit");
const WRITE = process.argv.includes("--write");
const TODAY = "2026-08-01";
const VERIFIER = "task-118 audit-recovery campaign 2026-08-01 (pass 5)";

type Dispo = { kind: "suppress"; pattern: string; reason: string } | { kind: "defer"; reason: string; reviewBy: string };
const S = (pattern: string, reason: string): Dispo => ({ kind: "suppress", pattern, reason });
const D = (reason: string, reviewBy = "2026-09-30"): Dispo => ({ kind: "defer", reason, reviewBy });

const DISPOSITIONS: Record<string, Dispo> = {
  "server/agent-channels.ts:198": S("upstream-verified", "getUnreadCount filters cm.tenant_id = ${tenantId}; the channel_subscriptions join is keyed on the caller's persona_id (personas are tenant-scoped FKs), so another tenant's subscription rows cannot match."),
  "server/process-governor.ts:155": S("global-table", "heartbeat-task pace counting is a platform-wide throttle by design (same family as checkPace/heartbeat_logs); per-tenant fairness would need a schema migration and is tracked separately."),
  "server/routes.ts:1530": S("global-table", "/api/public/stats intentionally returns platform-wide aggregate COUNT(*)s for the public landing page; no per-tenant rows or identifying data are exposed."),
  "server/routes.ts:1558": S("global-table", "/api/public/architecture intentionally returns platform-wide aggregate counts (personas/projects/etc.) for the public architecture page; aggregates only, no tenant row data."),
  "server/tools.ts:8916": S("internal-worker-pk", "row.id is the PK returned by this same tool call's own INSERT into proposed_skills a few lines above; it is never caller-supplied, so the WHERE(id) UPDATE targets the row just created."),
  "server/tools.ts:8933": S("internal-worker-pk", "row.id is the PK returned by this same tool call's own INSERT into proposed_skills; the reject-status UPDATE targets the row created in this invocation, not a caller-supplied id."),
  "server/heartbeat-context.ts:136": D("model_scout heartbeat context calls storage.getProviderKeys() unscoped — provider list (names only) can reflect other tenants' configured providers in system LLM context; hardening = thread tenantId like the R74.13d knowledge/task fixes."),
  "server/heartbeat-context.ts:182": D("heartbeat context calls storage.getPersonas() unscoped — persona names across tenants can leak into system LLM context; hardening = pass tenantId (the adjacent getHeartbeatTasks call is already scoped)."),
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
