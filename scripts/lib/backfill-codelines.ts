// One-off maintenance tool (task: nightly tenant-isolation audit permanently
// red, 2026-08-01): backfill a paraphrase-immune `codeLine` into every
// suppressions.json entry that lacks one.
//
// Why: matchSuppression's verbatim `issue.includes(match)` almost never
// re-fires because the first-pass model re-words its issue text nightly. The
// stable identity of a verified false positive is the CODE SITE, so each entry
// gains the exact (trimmed) source line of that site, resolved from the
// campaign snapshot that produced the entry.
//
// Resolution ladder (per entry, fail closed — no guess is ever written):
//  1. Find the snapshot finding the entry was generated from (same rule the
//     generation-contract test uses: file + issue.includes(match) + anchor).
//  2. Take the CURRENT source line at the snapshot finding's line number; if
//     it plausibly belongs to the entry (shares the anchor table or a
//     multi-char identifier from the match/issue), use it.
//  3. Else scan the current file for lines containing the anchor's table
//     identifier; if EXACTLY ONE candidate line qualifies, use it.
//  4. Else leave the entry codeLine-less (verbatim-only, logged).
//
// Run: npx tsx scripts/lib/backfill-codelines.ts [--write]
import fs from "node:fs";
import path from "node:path";
import { extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";

const DIR = path.join("data", "tenant-isolation-audit");
const SUPP = path.join(DIR, "suppressions.json");
const WRITE = process.argv.includes("--write");

const snapshots = fs
  .readdirSync(DIR)
  .filter((f) => /^campaign-.*-snapshot\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).findings as Array<{ file: string; line?: number; issue: string }>);

const entries: any[] = JSON.parse(fs.readFileSync(SUPP, "utf8"));

// Latest nightly run: its findings carry CURRENT line numbers for the same
// code sites (the run that motivated this backfill).
const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const latestFindings: Array<{ file: string; line?: number; issue: string }> = [
  ...latest.findings,
  ...latest.suppressed,
];

function identTokens(text: string): string[] {
  return (text.match(/\b(?:[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]{2,}|[a-z][a-z0-9]+[A-Z][A-Za-z0-9]{2,})\b/g) || []).map((t) => t.toLowerCase());
}

let filled = 0, already = 0, unresolved = 0;
for (const e of entries) {
  if (isUsableCodeLine(e.codeLine)) { already++; continue; }
  let lines: string[];
  try {
    lines = fs.readFileSync(e.file, "utf8").split("\n");
  } catch {
    console.log(`UNRESOLVED (file unreadable): ${e.file} [${e.anchor}]`);
    unresolved++;
    continue;
  }
  const table = e.anchor.split(":")[1];
  const wanted = [table, ...identTokens(e.match)].filter((t) => t && t.length >= 4);
  // A line is plausible for this entry when its ±3-line NEIGHBORHOOD carries
  // one of the entry's identifier tokens (the flagged line itself is often a
  // bare `WHERE id = ${row.id}` with the table named a line or two above).
  const neighborhoodHasToken = (i: number) => {
    const lo = Math.max(0, i - 3);
    const hi = Math.min(lines.length - 1, i + 3);
    const hood = lines.slice(lo, hi + 1).join("\n").toLowerCase();
    return wanted.some((t) => hood.includes(t));
  };
  const usable = (i: number) => i >= 0 && i < lines.length && isUsableCodeLine(lines[i]) && neighborhoodHasToken(i);
  // Nearest usable line to an anchor index (the exact flagged line can be a
  // brace/blank; walk outward a couple of lines).
  const pickNear = (i0: number): string | undefined => {
    for (const d of [0, 1, -1, 2, -2, 3, -3]) {
      const i = i0 + d;
      if (usable(i)) return lines[i].trim();
    }
    return undefined;
  };

  let code: string | undefined;
  // Step 1: snapshot finding's line → nearest usable current line.
  const src = snapshots.find(
    (f) => f.file === e.file && f.issue.includes(e.match) && extractStructuralAnchor(f.issue) === e.anchor && typeof f.line === "number",
  );
  if (src) code = pickNear(src.line! - 1);
  // Step 2: latest-run finding with same file+anchor → its CURRENT line. Only
  // when the file+anchor pair is unambiguous (one entry, one distinct site).
  if (!code) {
    const sibs = entries.filter((x) => x.file === e.file && x.anchor === e.anchor);
    const cand = latestFindings.filter(
      (f) => f.file === e.file && typeof f.line === "number" && extractStructuralAnchor(f.issue) === e.anchor,
    );
    const distinctLines = [...new Set(cand.map((f) => f.line as number))].filter((l, _, arr) => arr.every((o) => Math.abs(o - l) <= 10 || o === l) || true);
    const clusters = [...new Set(cand.map((f) => Math.round((f.line as number) / 15)))];
    if (sibs.length === 1 && cand.length > 0 && clusters.length === 1) {
      code = pickNear((cand[0].line as number) - 1);
    }
  }
  // Step 3: unique table-bearing usable line in the current file.
  if (!code && table && table.length >= 4) {
    const cand: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(table) && usable(i)) cand.push(i);
    }
    if (cand.length === 1) code = lines[cand[0]].trim();
  }
  if (code) {
    e.codeLine = code;
    filled++;
  } else {
    console.log(`UNRESOLVED: ${e.file} [${e.anchor}] match="${String(e.match).slice(0, 60)}"`);
    unresolved++;
  }
}
console.log(`entries=${entries.length} filled=${filled} already=${already} unresolved=${unresolved} (verbatim-only)`);
if (WRITE) {
  fs.writeFileSync(SUPP, JSON.stringify(entries, null, 2) + "\n");
  console.log(`wrote ${SUPP}`);
} else {
  console.log("dry run — pass --write to persist");
}
