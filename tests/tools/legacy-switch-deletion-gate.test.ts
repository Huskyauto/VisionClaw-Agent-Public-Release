/**
 * Tools-layer-split — deletion-safety gate.
 *
 * This is the guardrail for the S25 moment when server/tools.ts's legacy switch
 * (`_legacySwitchExec`) is finally deleted. It encodes three PERMANENT invariants
 * that together make that deletion provably safe — and, just as importantly, make
 * it IMPOSSIBLE to delete the switch too early:
 *
 *   A. NO ORPHAN — every canonical tool (tool-inventory-baseline.txt) is served
 *      by exactly one path: a migrated handler OR a legacy case arm. A future
 *      slice that removes a legacy arm without registering a handler turns RED
 *      here instead of shipping a tool that runtime-fails with unknownToolError.
 *
 *   B. NO DIVERGENCE — no tool is served by BOTH paths. (The registry wins at
 *      dispatch, so a leftover arm would be dead code that can silently drift
 *      from the migrated handler.) This complements migrated-surface-guard's
 *      per-name check with a whole-inventory reconciliation.
 *
 *   C. SELF-ACTIVATING DELETION GATE — once (and only once) EVERY baseline tool
 *      is migrated, this asserts ZERO legacy arms remain for baseline tools.
 *      Until then it merely records migration progress and passes (the expected
 *      mid-refactor state). The day the last tool migrates, this flips to
 *      ENFORCING "the switch must be empty before you delete it" — you cannot
 *      delete early (orphans caught by A), and you cannot forget a leftover arm.
 *
 * Static-only reads of server/tools.ts (never imported — pg-pool hang). The
 * dispatcher import is acyclic (domains dynamic-import app deps at call time),
 * so it registers handlers without opening the DB pool.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// Importing the dispatcher registers every migrated domain handler (side-effect).
import "../../server/tools/dispatcher";
import { getMigratedToolNames } from "../../server/tools/registry";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "data/feature-contracts/tools-layer-split/tool-inventory-baseline.txt");
const TOOLS_TS = path.join(ROOT, "server/tools.ts");

function readBaseline(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Case labels inside `_legacySwitchExec` ONLY — bounded to that function so we
 * don't pick up unrelated switches elsewhere in the file. The switch region runs
 * from the function declaration to the next top-level function
 * (`getAllToolDefinitions`).
 */
function legacyArmNames(): Set<string> {
  const src = readFileSync(TOOLS_TS, "utf8");
  const start = src.indexOf("async function _legacySwitchExec");
  assert.ok(start >= 0, "could not locate _legacySwitchExec in server/tools.ts");
  const end = src.indexOf("export async function getAllToolDefinitions", start);
  assert.ok(end > start, "could not bound the legacy switch region in server/tools.ts");
  const region = src.slice(start, end);
  return new Set([...region.matchAll(/case\s+"([a-z0-9_]+)"\s*:/g)].map((m) => m[1]));
}

test("A. NO ORPHAN — every baseline tool is served by a migrated handler OR a legacy arm", () => {
  const baseline = readBaseline();
  const migrated = new Set(getMigratedToolNames());
  const legacy = legacyArmNames();
  const orphans = baseline.filter((n) => !migrated.has(n) && !legacy.has(n));
  assert.deepEqual(
    orphans,
    [],
    `orphaned tool(s) — defined in baseline but served by NEITHER a migrated handler NOR a legacy arm (would runtime-fail with unknownToolError): ${orphans.join(", ")}`,
  );
});

test("B. NO DIVERGENCE — no baseline tool is served by BOTH a handler AND a legacy arm", () => {
  const baseline = new Set(readBaseline());
  const migrated = getMigratedToolNames().filter((n) => baseline.has(n));
  const legacy = legacyArmNames();
  const both = migrated.filter((n) => legacy.has(n));
  assert.deepEqual(
    both,
    [],
    `tool(s) served by BOTH paths — the legacy arm is dead + drift-prone, remove it: ${both.join(", ")}`,
  );
});

test("C. SELF-ACTIVATING DELETION GATE — at 100% migration, zero legacy arms may remain", () => {
  const baseline = readBaseline();
  const migrated = new Set(getMigratedToolNames());
  const legacy = legacyArmNames();
  const stillLegacy = baseline.filter((n) => !migrated.has(n));
  const pct = ((migrated.size / baseline.length) * 100).toFixed(1);
  // Progress breadcrumb — visible in the suite output on every run.
  console.log(
    `[deletion-gate] migrated ${migrated.size}/${baseline.length} (${pct}%) — ${stillLegacy.length} tool(s) still legacy-only; legacy switch NOT yet safe to delete`,
  );
  if (stillLegacy.length === 0) {
    // Migration is complete: the switch MUST be empty of baseline arms before
    // _legacySwitchExec is deleted.
    const leftover = baseline.filter((n) => legacy.has(n));
    assert.deepEqual(
      leftover,
      [],
      `100% migrated but legacy arm(s) still present — remove them, THEN delete _legacySwitchExec: ${leftover.join(", ")}`,
    );
  } else {
    // Expected mid-refactor state — passing here is correct. The gate flips to
    // enforcing the leftover-arm check the moment the final tool migrates.
    assert.ok(stillLegacy.length > 0);
  }
});
