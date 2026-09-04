import fs from "node:fs";
import path from "node:path";
import { loadSuppressions, matchSuppression, extractStructuralAnchor } from "../../server/lib/audit-suppressions";
const DIR = path.join("data", "tenant-isolation-audit");
const PAT = new Set(["fk-transitive","internal-worker-pk","global-table","signed-url","upstream-verified","system-sweep"]);
const entries = loadSuppressions(path.join(DIR, "suppressions.json"), PAT, () => {});
const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const severe = (latest.findings as any[]).filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");
const out: string[] = [];
for (const f of severe) {
  if (matchSuppression(f, entries)) continue;
  const anchor = extractStructuralAnchor(f.issue);
  const sibs = entries.filter((e) => e.file === f.file && e.anchor === anchor);
  let ctx = "(file unreadable)";
  try {
    const lines = fs.readFileSync(f.file, "utf8").split("\n");
    const lo = Math.max(0, (f.line || 1) - 4), hi = Math.min(lines.length, (f.line || 1) + 4);
    ctx = lines.slice(lo, hi).map((l, i) => `${lo + i + 1}${lo + i + 1 === f.line ? ">" : ":"} ${l}`).join("\n");
  } catch {}
  out.push(`### ${f.file}:${f.line} [${f.severity}] anchor=${anchor} sibEntries=${sibs.length}\nISSUE: ${f.issue}\n${ctx}\n`);
}
fs.writeFileSync("/tmp/triage-dump.md", out.join("\n"));
console.log("wrote", out.length, "items to /tmp/triage-dump.md");
