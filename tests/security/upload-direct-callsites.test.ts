/**
 * upload-direct-callsites.test.ts — lock-in for the R125+1.1 architect HIGH finding
 * "Direct-upload callsites bypass deliverDigitalProduct()".
 *
 * Pattern mirrors `tests/security/sql-raw-callsite-allowlist.test.ts`:
 *  1. Walk every TypeScript file under `server/` (and `client/` for paranoia).
 *  2. Regex-match `\b(uploadAndShare|uploadToDrive)\s*\(` — i.e. an actual call,
 *     not a comment / string literal mention.
 *  3. Compare against UPLOAD_DIRECT_BASELINE below (audited 2026-05-23 R125+3.5).
 *
 * If this test goes red:
 *   - You added a NEW direct uploadAndShare()/uploadToDrive() callsite.
 *   - For ANY human-facing deliverable: route through `deliverDigitalProduct()`
 *     in `server/delivery-pipeline.ts` instead. This is the replit.md HARD RULE.
 *   - If the new callsite is internal/scratch (Felix intermediate, research-engine
 *     temp upload), audit it for human visibility and — only if truly internal —
 *     add it to UPLOAD_DIRECT_BASELINE with an attribution comment explaining why
 *     it can stay on direct upload.
 *
 * Why text-snapshot and not just count? Counts let you swap a safe site for a
 * dangerous one with zero signal. Text-snapshot pins the EXACT line that was
 * audited; any drift requires human re-audit just like sql-raw drift does.
 *
 * Excluded by design:
 *   - server/delivery-pipeline.ts — IS the pipeline, calls upload internally
 *   - server/google-drive.ts      — the upload primitive itself
 *   - server/lib/google-drive-helper.ts — helper wrappers
 *   - tests/**, scripts/**         — not production hot path
 *   - run-product-stress-test.ts   — root-level one-off stress harness
 *   - client/**                    — release-log JSX strings, not callsites
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type CallsiteHit = { file: string; line: number; text: string };
type CallsiteMap = Record<string, { line: number; text: string }[]>;

// Files / dirs we DELIBERATELY exclude from the scan.
const EXCLUDED_FILES = new Set<string>([
  "server/delivery-pipeline.ts",
  "server/google-drive.ts",
  "server/lib/google-drive-helper.ts",
  // Prompt-definitions file: persona `operating_loop` strings MENTION
  // `uploadToDrive()` / `uploadAndShare()` in instruction prose ("never raw
  // uploadToDrive()"), they never CALL them. The mentions live inside
  // multi-line template literals, which `isInsideStringLiteral` (single-line
  // only) can't detect, so they'd be misread as callsites. This file contains
  // no real upload callsites by construction — same rationale as the
  // pipeline/primitive exclusions above.
  "server/seed-persona-prompts.ts",
]);

const EXCLUDED_DIR_PREFIXES = [
  "tests/",
  "scripts/",
  "node_modules/",
  ".local/",
  "client/", // release-log JSX strings, not real calls
  "attached_assets/",
  "public-mirror/",
  "uploads/",
  "dist/",
];

const ROOT_EXCLUDED = new Set<string>([
  "run-product-stress-test.ts", // root-level one-off
]);

const UPLOAD_CALL_RE = /\b(uploadAndShare|uploadToDrive)\s*\(/;

// Returns true when `matchIndex` on `line` sits INSIDE a string literal
// (single-quote, double-quote, or backtick). Used to ignore mentions in
// doc-strings / SLA copy / error messages that name the function but don't
// actually call it — e.g. webhookHandlers.ts: "NEVER uploadAndShare() directly".
function isInsideStringLiteral(line: string, matchIndex: number): boolean {
  let backticks = 0, dquotes = 0, squotes = 0;
  for (let i = 0; i < matchIndex; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; } // skip escaped char
    if (c === "`") backticks++;
    else if (c === '"') dquotes++;
    else if (c === "'") squotes++;
  }
  return (backticks % 2 === 1) || (dquotes % 2 === 1) || (squotes % 2 === 1);
}

function shouldSkip(relPath: string): boolean {
  if (EXCLUDED_FILES.has(relPath)) return true;
  if (ROOT_EXCLUDED.has(relPath)) return true;
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
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, repoRoot, acc);
    } else if (st.isFile() && (entry.endsWith(".ts") || entry.endsWith(".tsx"))) {
      const rel = full.startsWith(repoRoot + "/") ? full.slice(repoRoot.length + 1) : full;
      if (!shouldSkip(rel)) acc.push(rel);
    }
  }
}

function scanForCallsites(repoRoot: string): CallsiteHit[] {
  const files: string[] = [];
  walkTsFiles(join(repoRoot, "server"), repoRoot, files);
  files.sort();
  const hits: CallsiteHit[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines that happen to mention the function names.
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const m = UPLOAD_CALL_RE.exec(line);
      if (m && !isInsideStringLiteral(line, m.index)) {
        hits.push({ file: rel, line: i + 1, text: line.trim() });
      }
    }
  }
  return hits;
}

function groupByFile(hits: CallsiteHit[]): CallsiteMap {
  const map: CallsiteMap = {};
  for (const h of hits) {
    (map[h.file] ||= []).push({ line: h.line, text: h.text });
  }
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => a.line - b.line);
  }
  return map;
}

function textsOnly(m: CallsiteMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(m).sort()) {
    out[k] = m[k].map((e) => e.text).sort();
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// BASELINE — audited 2026-05-23 R125+3.5.
// Architect R125+1.1 flagged ~42 sites; precise executable count after the
// comment-line filter above is 29. Each entry is INTENTIONALLY on direct
// upload today because:
//   - It is an internal/scratch write NOT consumed by a human, OR
//   - It is a pre-existing customer path queued for migration in a dedicated
//     R-round (per the architect's proposed shape — top customer-facing sites
//     first, then this regression test prevents new sites from accumulating).
// The MIGRATION of these 29 sites is still DEFERRED (HIGH, single-user blast
// radius LOW). The PURPOSE of this test is to stop the bleeding so no new
// site gets added blind.
//
// To remove an entry from this baseline: migrate the call to
// `deliverDigitalProduct()` and delete the entry.
// To add an entry: audit the new site for human visibility and document why
// direct upload is correct (e.g. internal scratch, system-only metadata).
// ──────────────────────────────────────────────────────────────────────────
const UPLOAD_DIRECT_BASELINE: CallsiteMap = {
  "server/browser-tool.ts": [
    { line: 1153, text: "const result = await uploadAndShare({" },
  ],
  "server/data-protection.ts": [
    { line: 206, text: "const result = await uploadToDrive({" },
    { line: 253, text: "const r = await uploadToDrive({" },
    { line: 284, text: "const r = await uploadToDrive({" },
    { line: 337, text: "const r = await uploadToDrive({" },
  ],
  "server/doc-create.ts": [
    { line: 185, text: "const driveResult = await uploadAndShare({" },
    { line: 329, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/generate-feature-pdf.ts": [
    { line: 727, text: "const result = await uploadToDrive({" },
  ],
  "server/google-workspace.ts": [
    { line: 2135, text: "const pdfUpload = await uploadToDrive({" },
    { line: 2166, text: "const pptxUpload = await uploadToDrive({" },
  ],
  "server/mpeg-engine.ts": [
    { line: 937, text: "const driveResult = await uploadAndShare({" },
    { line: 1257, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/pdf-create.ts": [
    { line: 448, text: "const driveResult = await uploadAndShare({" },
    { line: 722, text: "const driveResult = await uploadAndShare({ filePath, fileName: `${title}.pdf`, mimeType: \"application/pdf\", folderLabel, share: true });" },
    { line: 972, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/research-engine.ts": [
    { line: 1865, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/routes.ts": [
    { line: 1844, text: "const result = await uploadAndShare({ fileData, fileName, mimeType: safeMime, folderLabel: folderLabel || \"deliverables\" });" },
    { line: 2658, text: "const driveResult = await uploadAndShare({ filePath, fileName, mimeType, folderLabel, description: `User upload: ${fileName}`, share: true });" },
    { line: 2725, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/routes/projects.ts": [
    { line: 217, text: "const driveResult = await uploadAndShare({ filePath: diskPath, fileName: f.fileName, mimeType: f.mimeType, folderLabel: `Projects/${projectName}`, description: `Project file: ${f.fileName}`, parentFolderId: projectDriveFolderId || undefined, share: true });" },
    { line: 274, text: "const driveResult = await uploadAndShare({" },
  ],
  "server/tools.ts": [
    { line: 8508, text: "const driveResult = await uploadAndShare({" },
    { line: 9429, text: "driveResult = await uploadAndShare({ filePath, fileName: filename, mimeType: \"image/png\", folderLabel, parentFolderId: params._projectDriveFolderId || undefined });" },
    { line: 11265, text: "const shareResult = await uploadAndShare({" },
    { line: 12764, text: "const driveResult = await uploadAndShare({" },
    { line: 14128, text: "const driveResult = await uploadAndShare({" },
    { line: 14366, text: "const driveResult = await uploadAndShare({ filePath: localPath, fileName, mimeType, folderLabel, parentFolderId: params._projectDriveFolderId || undefined });" },
  ],
  "server/video-editor.ts": [
    { line: 424, text: "const r = await uploadAndShare({" },
  ],
  "server/video-job-runner.ts": [
    { line: 679, text: "const ur = await uploadAndShare({" },
  ],
};

test("direct uploadAndShare/uploadToDrive callsites match the audited baseline (delivery-pipeline lock-in)", () => {
  const repoRoot = process.cwd();
  const hits = scanForCallsites(repoRoot);
  const actual = groupByFile(hits);
  assert.deepStrictEqual(
    textsOnly(actual),
    textsOnly(UPLOAD_DIRECT_BASELINE),
    "Direct-upload callsite drift detected — REVIEW REQUIRED.\n" +
      "For any human-facing deliverable, route through deliverDigitalProduct() in server/delivery-pipeline.ts.\n" +
      "If the new site is genuinely internal/scratch, audit it then update UPLOAD_DIRECT_BASELINE in this test file.\n" +
      "See replit.md HARD RULE: All human-facing file deliveries MUST go through deliverDigitalProduct().",
  );
});
