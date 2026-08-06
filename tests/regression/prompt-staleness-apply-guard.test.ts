/**
 * Prompt Staleness Audit — auto-apply guard pins (Bob directive 2026-08-01).
 *
 * The audit script may auto-apply DELETE verdicts, but ONLY in full mode.
 * These tests pin the no-mutation contract of the preview modes
 * (--heuristics-only, --report-only is LLM-bound so not run here) and the
 * presence of the applied/skippedApply accounting fields.
 * No LLM, no DB — safe for the suite.
 */
import { test } from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("heuristics-only mode never mutates audited surfaces and reports empty applied[]", () => {
  const before = {
    replit: readFileSync("replit.md", "utf-8"),
    memory: readFileSync(".agents/memory/MEMORY.md", "utf-8"),
  };
  execFileSync("npx", ["tsx", "scripts/prompt-staleness-audit.ts", "--heuristics-only"], {
    encoding: "utf-8",
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Read the JSON report FILE the script writes — child stdout truncates
  // at ~100KB in this sandbox (see subprocess-stdout-truncation), so the
  // temp-file handoff is the reliable channel.
  const date = new Date().toISOString().slice(0, 10);
  const parsed = JSON.parse(readFileSync(`/tmp/prompt-staleness-audit-${date}-heuristics.json`, "utf-8"));
  assert.deepEqual(parsed.applied, [], "heuristics-only must apply nothing");
  assert.ok(Array.isArray(parsed.skippedApply), "skippedApply accounting field present");
  assert.ok(parsed.itemCount > 100, "gathers the always-loaded surfaces");
  assert.equal(readFileSync("replit.md", "utf-8"), before.replit, "replit.md untouched");
  assert.equal(readFileSync(".agents/memory/MEMORY.md", "utf-8"), before.memory, "MEMORY.md untouched");
});

test("apply comparison is byte-exact: source pins the raw-line contract", () => {
  const src = readFileSync("scripts/prompt-staleness-audit.ts", "utf-8");
  // byte-for-byte comparison against the untruncated raw line, never the
  // LLM-truncated display text, never startsWith/fuzzy.
  assert.match(src, /current === r\.raw/, "must compare against full raw audit-time line");
  assert.ok(!/current\.startsWith\(/.test(src), "no prefix/fuzzy matching in apply path");
  assert.match(src, /APPLY_SURFACES = new Set\(\["replit\.md", "MEMORY\.md"\]\)/, "apply surfaces locked to markdown files");
  assert.match(src, /r\.verdict !== "DELETE"\) continue/, "only DELETE verdicts enter apply");
});
