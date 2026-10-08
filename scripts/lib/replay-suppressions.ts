// Offline replay: apply the (new) matcher to last night's kept severe findings
// and to the Jul-31 campaign snapshot to check for over-suppression.
import fs from "node:fs";
import path from "node:path";
import { loadSuppressions, matchSuppression, loadDeferrals, matchDeferral } from "../../server/lib/audit-suppressions";
const DIR = path.join("data", "tenant-isolation-audit");
const entries = loadSuppressions(path.join(DIR, "suppressions.json"), new Set(["fk-transitive","internal-worker-pk","global-table","signed-url","upstream-verified","system-sweep"]), (m) => console.log("[load]", m));
const deferrals = loadDeferrals(path.join(DIR, "deferrals.json"), (m) => console.log("[defer]", m));
const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const kept = latest.findings as Array<{ file: string; line?: number; issue: string; severity: string }>;
let sup = 0, def = 0;
const still: string[] = [];
for (const f of kept) {
  const s = matchSuppression(f, entries);
  const d = s ? undefined : matchDeferral(f, deferrals);
  if (s) sup++;
  else if (d) def++;
  else still.push(`${f.file}:${f.line} [${f.severity}] ${f.issue.slice(0, 110)}`);
}
console.log(`\nlast-night kept=${kept.length} → now suppressed=${sup} deferred=${def} stillRed=${still.length}`);
for (const s of still) console.log("STILL:", s);
// Over-suppression check: campaign snapshot findings that were FIXED or DEFERRED
// must NOT be swallowed by the allowlist. (Deferred may match deferrals.json — that's by design.)
const snap = JSON.parse(fs.readFileSync(path.join(DIR, "campaign-2026-07-31-snapshot.json"), "utf8"));
const dispositions: Record<string, string> = {};
for (const f of snap.findings as any[]) {
  const key = `${f.file}:${f.line}`;
  if (f.disposition) dispositions[key] = f.disposition;
}
let overs = 0;
for (const f of snap.findings as any[]) {
  if (f.disposition === "fixed" || f.disposition === "deferred") {
    if (matchSuppression(f, entries)) { overs++; console.log(`OVER-SUPPRESS (${f.disposition}): ${f.file}:${f.line} ${String(f.issue).slice(0, 100)}`); }
  }
}
console.log(`over-suppressions of fixed/deferred snapshot findings: ${overs}`);
