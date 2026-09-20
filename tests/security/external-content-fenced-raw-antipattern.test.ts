/**
 * external-content-fenced-raw-antipattern.test.ts — R125+4+sec
 *
 * Lock-in regression for the prompt-injection containment bypass closed in
 * R125+4 (academic_search handlers) and again in R125+4+sec (monid_*
 * handlers).
 *
 * THE ANTIPATTERN (do NOT do this):
 *
 *   const { wrapped } = wrapExternalContent(JSON.stringify(r), "web_fetch", {...});
 *   return { ok: true, fenced: wrapped, raw: r };
 *                                       ^^^^^^
 *   The chat-engine serializes the entire return value into the model
 *   channel via JSON.stringify(). Returning `raw` alongside `fenced`
 *   defeats wrapExternalContent's whole purpose — the model now sees the
 *   un-fenced untrusted payload AND the fenced one, and the un-fenced one
 *   can carry tool-call-shaped strings, VERDICT lines, or other channel-
 *   impersonation attacks. The fenced version becomes window-dressing.
 *
 * THE CORRECT SHAPE:
 *
 *   return {
 *     ok: true,
 *     source: "tool_name",
 *     result_count: arr.length,   // safe metadata only
 *     fenced: wrapped,             // the ONLY view of the external payload
 *   };
 *
 * Architect history that earned this regression test:
 *   - R125+4 closure pass: academic_search handlers had {fenced, raw}.
 *     Fix removed raw. Test caught it manually.
 *   - R125+4+sec review: monid_discover/inspect/run/catalog_browse had
 *     the EXACT same antipattern. Fix removed raw. Atrophy alarm —
 *     same class-of-bug twice in 24h means we need a CI gate.
 *
 * Pattern mirrors `tests/security/upload-direct-callsites.test.ts` and
 * `tests/security/sql-raw-callsite-allowlist.test.ts`: regex-based
 * static-source scan with a baseline of intentional exceptions (none today;
 * any future intentional exception must be documented inline).
 *
 * Files scanned: server/**\/*.ts (the tool-handler layer).
 *
 * If this test goes red:
 *   1. You added a tool handler that returns BOTH `fenced:` and `raw:` on
 *      the same return line, or in close proximity.
 *   2. Remove `raw` from the return value. Add safe metadata fields
 *      (counts, ids, source names) if the caller needs anything beyond
 *      the fenced payload.
 *   3. If you have a GENUINELY non-external use case for both — extremely
 *      rare; this should not happen — document the carve-out inline and
 *      add it to ALLOWED_FENCED_RAW_BASELINE with attribution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Hit = { file: string; line: number; text: string };

const EXCLUDED_DIR_PREFIXES = [
  "tests/",
  "scripts/",
  "node_modules/",
  ".local/",
  "client/",
  "attached_assets/",
  "public-mirror/",
  "uploads/",
  "dist/",
];

// Single-line antipattern: both `fenced:` and `raw:` in the same return-shape line.
// This catches the exact form architect flagged twice:
//   return { ok: true, fenced: wrapped, raw: r };
const SINGLE_LINE_RE = /\bfenced\s*:[^,}]*,\s*raw\s*:/;

// Multi-line antipattern: a return-object whose body contains BOTH `fenced:`
// and `raw:` keys within ~8 lines of each other. Catches reformatted variants.
function hasMultiLineAntipattern(lines: string[], startIdx: number): boolean {
  // Walk forward up to 12 lines looking for a closing brace, tracking
  // whether we've seen both `fenced:` and `raw:` keys at the top level.
  let sawFenced = false;
  let sawRaw = false;
  let depth = 0;
  for (let i = startIdx; i < Math.min(startIdx + 12, lines.length); i++) {
    const l = lines[i];
    for (const ch of l) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (/^\s*fenced\s*:/.test(l)) sawFenced = true;
    if (/^\s*raw\s*:/.test(l)) sawRaw = true;
    if (sawFenced && sawRaw) return true;
    if (depth <= 0 && i > startIdx) return false;
  }
  return false;
}

function shouldSkip(relPath: string): boolean {
  for (const prefix of EXCLUDED_DIR_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  return false;
}

function walkTsFiles(dir: string, repoRoot: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      walkTsFiles(full, repoRoot, acc);
    } else if (st.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
      const rel = full.startsWith(repoRoot + "/") ? full.slice(repoRoot.length + 1) : full;
      if (!shouldSkip(rel)) acc.push(rel);
    }
  }
}

function scan(repoRoot: string): Hit[] {
  const files: string[] = [];
  walkTsFiles(join(repoRoot, "server"), repoRoot, files);
  files.sort();
  const hits: Hit[] = [];
  for (const rel of files) {
    let text: string;
    try { text = readFileSync(join(repoRoot, rel), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      // Skip comment-only lines that happen to mention the words.
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      if (SINGLE_LINE_RE.test(line)) {
        hits.push({ file: rel, line: i + 1, text: line.trim() });
        continue;
      }
      // Multi-line: only kick the deeper scan when we see a return-object
      // start that mentions `fenced:` to keep this cheap.
      if (/\breturn\s*\{/.test(line) && hasMultiLineAntipattern(lines, i)) {
        hits.push({ file: rel, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

// Empty by design. As of R125+4+sec, ZERO legitimate uses of
// {fenced, raw} dual return exist in the tool-handler layer. Any future
// exception requires inline justification and an entry here with date +
// architect-review note.
const ALLOWED_FENCED_RAW_BASELINE: Hit[] = [];

test("no tool handler returns both `fenced:` and `raw:` (prompt-injection containment lock-in)", () => {
  const repoRoot = process.cwd();
  const hits = scan(repoRoot);
  const unexpected = hits.filter(
    (h) => !ALLOWED_FENCED_RAW_BASELINE.some(
      (b) => b.file === h.file && b.line === h.line && b.text === h.text,
    ),
  );
  assert.deepStrictEqual(
    unexpected,
    [],
    "External-content fencing-bypass antipattern detected.\n\n" +
      "A tool handler returns BOTH `fenced:` (the safe, wrapped payload) AND `raw:`\n" +
      "(the untrusted source). The chat-engine JSON.stringifies the entire return\n" +
      "value into the model channel, so returning raw alongside fenced makes the\n" +
      "wrapExternalContent() call useless — the model still sees the un-fenced\n" +
      "payload, which can carry prompt-injection attacks (tool-call impersonation,\n" +
      "fake VERDICT lines, channel hijacks).\n\n" +
      "FIX: remove the `raw:` field. If the caller needs anything beyond the\n" +
      "fenced payload, return safe metadata only (counts, ids, source name).\n\n" +
      "Reference closures: R125+4 (academic_search), R125+4+sec (monid_*).\n" +
      "See replit.md release-log for the full rationale.\n\n" +
      "Detected hits:\n" + unexpected.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n"),
  );
});
