#!/usr/bin/env tsx
/**
 * preflight-locator-refs.ts (R125+137.x, Harness Handbook borrow — arXiv:2607.13285)
 *
 * Locator revalidation: docs that cite concrete repo paths are making a claim
 * that those paths exist NOW. This scans the operational doc surfaces
 * (.agents/skills, .agents/memory, docs/architecture-notes.md, threat_model.md,
 * replit.md) for backtick-quoted repo paths and reports any that no longer
 * resolve against the tree ("dangling locators").
 *
 * ADVISORY posture (quality gate, fails open): dangling locators exit 1 so the
 * weekly sweep can surface them YELLOW, but this is never a CI blocker — stale
 * doc pointers are drift, not danger. Safety fails closed; quality fails open.
 *
 * Exit codes:
 *   0 = clean (all locators resolve)
 *   1 = dangling locators found (advisory)
 *   2 = runtime error (scan itself failed)
 *
 * Usage:
 *   npx tsx scripts/preflight-locator-refs.ts
 *   npx tsx scripts/preflight-locator-refs.ts --json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";

const ROOT = process.cwd();
const asJson = process.argv.includes("--json");

// Doc surfaces whose path citations we revalidate.
const DOC_GLOBS = [
  ".agents/skills/**/SKILL.md",
  ".agents/memory/*.md",
  "docs/architecture-notes.md",
  "threat_model.md",
  "replit.md",
];

// A candidate is treated as a repo locator only if it starts with one of
// these top-level anchors — keeps URLs, prose fragments, and shell snippets out.
const TOP_DIRS = [
  "server/", "client/", "shared/", "scripts/", "docs/", "data/", "tests/",
  ".agents/", ".github/", "public/", "drizzle/",
];

// Never flag these (intentionally-ephemeral, generated, or example paths).
const IGNORE_PATTERNS: RegExp[] = [
  /^\.local\//,            // transient sidecars by design
  /[*?{<>$]/,              // globs / placeholders / template vars
  /\bexample\b/i,
  /<[^>]*>/,               // <domain>, <x> placeholders
  /\.\.\./,                // elided paths
  /XX/,                    // build-video-XX.ts style placeholders
];

// Deliberate example/illustrative paths cited in docs that are NOT claims of
// existence. Keep this list short — every entry is a locator we choose not to check.
const ALLOWLIST = new Set<string>([
  "scripts/helper.ts",             // write-a-skill generic example
  "server/lib/x",                  // illustrative import path in tsc-vs-esbuild memory
  "data/exploration-circuit.json", // runtime-created breaker file (may not exist at rest)
  "data/public/",                  // SIA-paper analogy (external system), not VC paths
  "data/private/",                 // SIA-paper analogy (external system), not VC paths
  "scripts/import-agentskill.ts",  // proposed-not-built (architecture-notes future item)
]);

interface Dangling {
  doc: string;
  line: number;
  locator: string;
}

function extractLocators(text: string): Array<{ line: number; locator: string }> {
  const out: Array<{ line: number; locator: string }> = [];
  const lines = text.split("\n");
  const backtick = /`([^`\n]+)`/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    while ((m = backtick.exec(lines[i])) !== null) {
      let cand = m[1].trim();
      // strip a trailing section anchor (docs/x.md § Foo) or punctuation
      cand = cand.replace(/\s+§.*$/, "").replace(/[,.;)]+$/, "");
      // strip #symbol anchors: file.ts#runFoo(
      cand = cand.replace(/#.*$/, "");
      // strip trailing :anchors — line numbers (:123, :123,456, :3256/3388,
      // :~1500) AND symbol names (:buildSafeEnv, :PATTERNS[])
      cand = cand.replace(/:[~0-9][0-9,~/–-]*$/, "");
      cand = cand.replace(/:[^/]*$/, (s) => (s.includes(".") ? s : ""));
      if (!cand.includes("/")) continue;
      if (!TOP_DIRS.some((d) => cand === d.slice(0, -1) || cand.startsWith(d))) continue;
      if (IGNORE_PATTERNS.some((re) => re.test(cand))) continue;
      if (ALLOWLIST.has(cand)) continue;
      // multi-token backticks are commands/prose, not a single locator
      if (/\s/.test(cand)) continue;
      out.push({ line: i + 1, locator: cand });
    }
  }
  return out;
}

async function main() {
  const docs = (
    await Promise.all(DOC_GLOBS.map((g) => glob(g, { cwd: ROOT, nodir: true })))
  ).flat().sort();

  if (docs.length === 0) {
    console.error("[locator-refs] no doc surfaces matched — scan misconfigured");
    process.exit(2);
  }

  const dangling: Dangling[] = [];
  let totalLocators = 0;
  const existsCache = new Map<string, boolean>();
  const resolves = (p: string): boolean => {
    let hit = existsCache.get(p);
    if (hit === undefined) {
      // Direct hit, or import-style module ref (server/db → server/db.ts /
      // server/db/index.ts), or a directory cited with a trailing slash.
      hit =
        fs.existsSync(path.join(ROOT, p)) ||
        (!path.extname(p) &&
          (fs.existsSync(path.join(ROOT, `${p}.ts`)) ||
            fs.existsSync(path.join(ROOT, `${p}.tsx`)) ||
            fs.existsSync(path.join(ROOT, p, "index.ts"))));
      existsCache.set(p, hit);
    }
    return hit;
  };

  for (const doc of docs) {
    const text = fs.readFileSync(path.join(ROOT, doc), "utf8");
    for (const { line, locator } of extractLocators(text)) {
      totalLocators++;
      if (!resolves(locator)) dangling.push({ doc, line, locator });
    }
  }

  const summary = {
    ok: dangling.length === 0,
    docsScanned: docs.length,
    locatorsChecked: totalLocators,
    dangling,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[locator-refs] scanned ${docs.length} docs, ${totalLocators} locators`);
    for (const d of dangling) {
      console.log(`  ✗ ${d.doc}:${d.line} → ${d.locator} (does not resolve)`);
    }
    console.log(
      dangling.length === 0
        ? "[locator-refs] ✓ all locators resolve"
        : `[locator-refs] ${dangling.length} dangling locator(s) — advisory: refresh or mark historical`
    );
  }
  process.exit(dangling.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`[locator-refs] scan failed: ${e?.message ?? e}`);
  process.exit(2);
});
