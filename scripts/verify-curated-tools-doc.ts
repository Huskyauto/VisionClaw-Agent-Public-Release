#!/usr/bin/env tsx
/**
 * Curated tools_doc staleness gate — fail-closed mirror-build check (Task 116).
 *
 * Verifies that every snake_case token in the documentation-only
 * PERSONA_DOCS[*].tools_doc / tools_doc_addendum literals
 * (server/seed-persona-prompts.ts) is either a live tool definition or an
 * allowlisted non-tool term. Runs FULLY STATICALLY (no DB, no server imports)
 * so it can gate scripts/build-public-mirror.sh even when the DB is down —
 * these literals feed docs/personas.md on the public mirror, and a stale tool
 * name here would be published.
 *
 * Exit codes:
 *   0   clean
 *   16  stale token(s) found (same bit as verify-agent-wiring.ts Check 7)
 *   5   gate itself could not run (missing sources / zero extraction) — fail closed
 */
import * as fs from "fs";
import * as path from "path";
import { getToolSourceFiles } from "./lib/tool-source-files";
import {
  extractCuratedDocLiterals,
  extractStaticToolNames,
  scanCuratedDocText,
} from "./lib/curated-doc-staleness";

const SEED = path.join(process.cwd(), "server/seed-persona-prompts.ts");

function main(): void {
  const seedSrc = fs.readFileSync(SEED, "utf8");
  const literals = extractCuratedDocLiterals(seedSrc);
  const toolNames = extractStaticToolNames(
    getToolSourceFiles().map((f) => fs.readFileSync(f, "utf8")),
  );
  // Fail closed on degenerate extraction — an empty set means the parser
  // broke, not that the platform has no tools/docs.
  if (literals.length === 0 || toolNames.size === 0) {
    console.error(
      `✗ curated-doc gate could not run: literals=${literals.length}, staticToolDefs=${toolNames.size} — extraction broke; failing closed.`,
    );
    process.exit(5);
  }
  const findings: Array<{ personaId: number; field: string; token: string }> = [];
  for (const lit of literals) {
    for (const token of scanCuratedDocText(lit.text, toolNames)) {
      findings.push({ personaId: lit.personaId, field: lit.field, token });
    }
  }
  if (findings.length > 0) {
    console.error("✗ STALE CURATED DOCS — doc-only PERSONA_DOCS literals mention unknown tool-like tokens:");
    for (const f of findings) console.error(`   - persona #${f.personaId} ${f.field}: \`${f.token}\``);
    console.error("  FIX: if the tool was renamed/removed, update server/seed-persona-prompts.ts;");
    console.error("       if it's a legitimate non-tool term, add it to CURATED_DOC_NON_TOOL_TOKENS");
    console.error("       in scripts/lib/curated-doc-staleness.ts (with the audit date).");
    process.exit(16);
  }
  console.log(`✓ curated tools_doc literals clean (${literals.length} literals scanned against ${toolNames.size} static tool defs)`);
}

try {
  main();
} catch (err) {
  // Any operational failure (missing/unreadable source files, unexpected
  // throw) is a gate failure — normalize to the documented exit 5 so
  // operators get one deterministic "gate could not run" code.
  console.error(`✗ curated-doc gate could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(5);
}
