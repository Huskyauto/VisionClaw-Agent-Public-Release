#!/usr/bin/env npx tsx
/**
 * verify-counts.ts — fail-closed drift gate for public platform totals.
 *
 * docs/CURRENT_PLATFORM_TOTALS.md is the single source of truth (SoT). This
 * script scans the other public-facing docs for headline metric phrases
 * (e.g. "393 tools", "16 personas", "616 indexes") and fails if any of them
 * disagrees with the SoT. It deliberately does NOT need a database — any
 * contributor can run it.
 *
 *   npx tsx scripts/verify-counts.ts
 *
 * Exit 0 = all scanned docs agree with the SoT. Exit 1 = drift found.
 * Exit 2 = could not parse the SoT (setup error).
 *
 * Historical/archive docs (docs/EVIDENCE.md) are intentionally NOT scanned —
 * their numbers are frozen point-in-time records.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SOT = "docs/CURRENT_PLATFORM_TOTALS.md";

/**
 * Metrics with a single canonical public value. Each entry maps the SoT table
 * label (matched loosely) to the regex that finds the metric in prose. Metrics
 * that legitimately carry more than one value in the docs (e.g. tables, where
 * "169 declared" and "210 live" both appear) are handled via `allowed` below.
 */
type Metric = {
  key: string;
  sotLabel: RegExp; // matches the SoT table row to read the canonical value
  prose: RegExp;    // capture group 1 = the number written in a scanned doc
  allowed?: number[]; // extra acceptable values beyond the SoT canonical one
};

const METRICS: Metric[] = [
  { key: "tools", sotLabel: /Built-in tools/i, prose: /(\d[\d,]*)\s+(?:built-in\s+|production\s+)?tools\b/gi },
  { key: "personas", sotLabel: /AI agent personas \(active\)/i, prose: /(\d[\d,]*)\s+(?:AI\s+)?(?:agent\s+)?personas\b/gi },
  { key: "indexes (all)", sotLabel: /Production indexes \(all\)/i, prose: /(\d[\d,]*)\s+(?:production\s+)?indexes\b/gi, allowed: [406] },
  { key: "governance rules", sotLabel: /Governance rules/i, prose: /(\d[\d,]*)\s+governance\s+rules\b/gi },
  { key: "tables (live)", sotLabel: /Database tables \(live/i, prose: /(\d[\d,]*)\s+(?:database\s+)?tables\b/gi, allowed: [169] },
  { key: "skills (total)", sotLabel: /Skills \(total/i, prose: /(\d[\d,]*)\s+skills\b/gi, allowed: [62, 33, 38] },
  { key: "capabilities", sotLabel: /Capabilities \(active\)/i, prose: /(\d[\d,]*)\s+(?:active\s+)?capabilities\b/gi },
  { key: "providers", sotLabel: /AI providers/i, prose: /(\d[\d,]*)\s+(?:AI\s+)?providers\b/gi },
];

// Public-facing docs to scan. EVIDENCE.md (historical archive) is excluded.
const SCAN = [
  "README-PUBLIC.md",
  "ROADMAP.md",
  "FORK-SETUP.md",
  "CONTRIBUTING.md",
  "docs/TRUST-RECEIPTS.md",
  "docs/PRODUCTION-SAFETY.md",
  "QUICKSTART_DOCKER.md",
];

function parseSot(): Map<string, number> {
  const path = join(ROOT, SOT);
  if (!existsSync(path)) {
    console.error(`❌ SoT not found: ${SOT}`);
    process.exit(2);
  }
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const out = new Map<string, number>();
  for (const m of METRICS) {
    const row = lines.find((l) => m.sotLabel.test(l));
    if (!row) continue;
    // table cell value is the first bolded **N** after the label
    const val = row.match(/\*\*\s*(\d[\d,]*)\s*\*\*/);
    if (val) out.set(m.key, Number(val[1].replace(/,/g, "")));
  }
  return out;
}

function main() {
  const sot = parseSot();
  if (sot.size === 0) {
    console.error("❌ Could not parse any canonical values from the SoT.");
    process.exit(2);
  }

  let drift = 0;
  let checked = 0;

  // Fail-closed: a scan target going missing (renamed/deleted) silently shrinks
  // coverage and would hide drift. Treat a missing expected doc as an error.
  const missing = SCAN.filter((rel) => !existsSync(join(ROOT, rel)));
  if (missing.length > 0) {
    console.error(`❌ verify-counts: expected scan target(s) missing: ${missing.join(", ")}`);
    console.error("   Update the SCAN list in scripts/verify-counts.ts if a doc was intentionally renamed/removed.");
    process.exit(1);
  }

  for (const rel of SCAN) {
    const path = join(ROOT, rel);
    // Release-log table rows (| **R125+68** | ...) are frozen point-in-time
    // records — their embedded counts (e.g. "tools 393→394", "Wiring audit
    // CLEAN (393 tools)") are historical facts, not current-state claims.
    // Blank them out (preserving line numbers) so only live prose is gated,
    // consistent with the EVIDENCE.md exclusion above. Scoped to
    // README-PUBLIC.md only — the sole scanned doc with a release-history
    // table — so a future doc can't accidentally exempt live claims by
    // formatting them as | **R...** | rows.
    const raw = readFileSync(path, "utf8");
    const text =
      rel === "README-PUBLIC.md"
        ? raw
            .split("\n")
            .map((l) => (/^\|\s*\*\*R\d/.test(l) ? "" : l))
            .join("\n")
        : raw;
    for (const m of METRICS) {
      const canonical = sot.get(m.key);
      if (canonical == null) continue;
      const ok = new Set<number>([canonical, ...(m.allowed ?? [])]);
      const re = new RegExp(m.prose.source, m.prose.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        checked++;
        const found = Number(match[1].replace(/,/g, ""));
        if (!ok.has(found)) {
          drift++;
          const line = text.slice(0, match.index).split("\n").length;
          console.error(
            `❌ ${rel}:${line} — "${match[0].trim()}" but SoT says ${m.key}=${canonical}` +
              (m.allowed ? ` (also allowed: ${m.allowed.join(", ")})` : ""),
          );
        }
      }
    }
  }

  if (drift > 0) {
    console.error(`\n❌ verify-counts: ${drift} count mismatch(es) vs ${SOT}. Fix the doc, not the SoT.`);
    process.exit(1);
  }
  console.log(`✓ verify-counts: ${checked} metric mentions across ${SCAN.length} docs all agree with ${SOT}.`);
}

main();
