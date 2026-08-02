/**
 * Static wiring guard (task: degraded-telemetry CI assertion).
 *
 * The outbound quality gate fails OPEN when the scanner crashes — content
 * ships UNSCANNED. That is only acceptable because every outbound surface
 * files an `outbound_quality_gate_degraded` self-repair incident when
 * scanCustomerFacingText returns degraded:true. This test statically asserts
 * that wiring exists at all three call sites:
 *
 *   1. server/email.ts        — send path   (metadata kind: "send")
 *   2. server/email.ts        — reply path  (metadata kind: "reply")
 *   3. server/lib/scheduled-post-runner.ts — scheduled-post publish
 *
 * If a refactor drops any of these, this test fails immediately instead of
 * the telemetry silently disappearing. Sources are parsed statically (never
 * imported) so no DB pool / side effects are touched (pg-pool hang rule).
 * Comments are stripped before matching (static-guard-comment-trip rule) so
 * a leftover comment mentioning the signature can't fake a pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function stripComments(src: string): string {
  // Remove /* ... */ block comments and // line comments. Good enough for a
  // static guard: string literals containing "//" (URLs) may lose a tail, but
  // none of the anchors below live after a URL on the same line.
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readStripped(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), "utf8"));
}

const SIGNATURE = `"outbound_quality_gate_degraded"`;

/**
 * Find every `<x>.degraded` conditional and assert that at least `expected`
 * of them are followed (within the same block, approximated by a char
 * window) by a reportQualityIncident call carrying the degraded signature.
 * Returns the windows that matched so callers can make per-site assertions.
 */
function degradedIncidentWindows(src: string): string[] {
  const windows: string[] = [];
  const re = /if\s*\(\s*\w+\.degraded\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const window = src.slice(m.index, m.index + 1200);
    if (window.includes("reportQualityIncident") && window.includes(SIGNATURE)) {
      windows.push(window);
    }
  }
  return windows;
}

test("email send + reply paths file the degraded incident (server/email.ts)", () => {
  const src = readStripped("server/email.ts");
  const wins = degradedIncidentWindows(src);
  assert.ok(
    wins.length >= 2,
    `expected >=2 degraded→reportQualityIncident sites in server/email.ts, found ${wins.length} — a refactor dropped the fail-open telemetry wiring`,
  );
  // Distinguish the two surfaces: send path stamps kind "send", reply "reply".
  assert.ok(
    wins.some((w) => /kind:\s*"send"/.test(w)),
    'send path missing degraded incident (metadata kind: "send")',
  );
  assert.ok(
    wins.some((w) => /kind:\s*"reply"/.test(w)),
    'reply path missing degraded incident (metadata kind: "reply")',
  );
});

test("scheduled-post publish path files the degraded incident (scheduled-post-runner.ts)", () => {
  const src = readStripped("server/lib/scheduled-post-runner.ts");
  const wins = degradedIncidentWindows(src);
  assert.ok(
    wins.length >= 1,
    "scheduled-post runner no longer files outbound_quality_gate_degraded when the scanner crashes (fail-open telemetry dropped)",
  );
  assert.ok(
    wins.some((w) => /stage:\s*"scheduled-post"/.test(w)),
    'scheduled-post degraded incident missing stage: "scheduled-post"',
  );
});

test("the degraded flag itself still exists on the scanner contract", () => {
  // If the scanner stops emitting `degraded`, every call-site check above
  // becomes dead code that would still pass. Anchor the producer side too.
  const src = readStripped("server/lib/outbound-quality-gate.ts");
  assert.ok(/degraded\?:\s*boolean/.test(src), "OutboundScanResult.degraded field removed from the contract");
  assert.ok(/degraded:\s*true/.test(src), "scanner catch branch no longer marks the fail-open result degraded:true");
});
