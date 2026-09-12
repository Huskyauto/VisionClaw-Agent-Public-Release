/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 6: autonomy).
 * Proves the autonomy enforcement gate was extracted from executeTool into
 * server/tools/middleware/autonomy-gate.ts MECHANICALLY:
 *   - the module exists and exports enforceAutonomyGate,
 *   - executeTool imports + delegates to it, and
 *   - executeTool no longer carries the inline autonomy glue.
 *
 * Static-only: importing autonomy-gate.ts is side-effect-free (./autonomy is
 * pulled via a call-time dynamic import INSIDE the gate). server/tools.ts is
 * NEVER imported here (pg-pool hang — see node-test-db-pool-hang). Contract:
 * data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { enforceAutonomyGate } from "../../server/tools/middleware/autonomy-gate";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/autonomy-gate.ts"),
  "utf8",
);

test("S24: autonomy middleware exports enforceAutonomyGate", () => {
  assert.equal(typeof enforceAutonomyGate, "function");
  assert.equal(enforceAutonomyGate.length, 2); // (name, params)
});

test("S24: executeTool imports and delegates to the autonomy middleware", () => {
  assert.ok(
    toolsSrc.includes('import { enforceAutonomyGate } from "./tools/middleware/autonomy-gate"'),
    "executeTool must import enforceAutonomyGate",
  );
  assert.ok(
    toolsSrc.includes("enforceAutonomyGate(name, params)"),
    "executeTool must call enforceAutonomyGate(name, params)",
  );
});

test("S24: inline autonomy glue no longer duplicated in tools.ts", () => {
  assert.ok(!toolsSrc.includes("mapToolToActionType"), "inline mapToolToActionType must be gone from tools.ts");
});

test("S24: autonomy module keeps the acyclic call-time autonomy import", () => {
  assert.ok(
    mwSrc.includes('await import("../../autonomy")'),
    "gate must dynamic-import ./autonomy at call time",
  );
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc), "autonomy-gate.ts must NOT static-import ./tools");
});
