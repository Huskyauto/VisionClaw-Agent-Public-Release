import fs from "node:fs";
import path from "node:path";
import { loadSuppressions, matchSuppression, extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";
const DIR = path.join("data", "tenant-isolation-audit");
const PAT = new Set(["fk-transitive","internal-worker-pk","global-table","signed-url","upstream-verified","system-sweep"]);
const entries = loadSuppressions(path.join(DIR, "suppressions.json"), PAT, () => {});
const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const severe = (latest.findings as any[]).filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
let sup = 0; const anchorHitNoCode: any[] = []; const noEntry: any[] = [];
for (const f of severe) {
  if (matchSuppression(f, entries)) { sup++; continue; }
  const anchor = extractStructuralAnchor(f.issue);
  const sibs = entries.filter((e) => e.file === f.file && e.anchor === anchor);
  if (sibs.length) anchorHitNoCode.push({ f, sibs });
  else noEntry.push(f);
}
console.log(`severe=${severe.length} suppressed=${sup} anchorHitButNoMatch=${anchorHitNoCode.length} noEntry=${noEntry.length}`);
for (const { f, sibs } of anchorHitNoCode) {
  const why = sibs.map((e: any) => isUsableCodeLine(e.codeLine) ? `codeLine present ("${e.codeLine.slice(0,50)}")` : "NO codeLine").join(" | ");
  console.log(`MISS ${f.file}:${f.line} [${extractStructuralAnchor(f.issue)}] ${why}`);
}
console.log("--- no entry at all:");
for (const f of noEntry) console.log(`NEW ${f.file}:${f.line} [${f.severity}] ${f.issue.slice(0, 100)}`);
