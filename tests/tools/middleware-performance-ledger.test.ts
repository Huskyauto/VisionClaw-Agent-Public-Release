/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 2: performance
 * ledger). Proves the single-funnel tool_performance tracking was extracted from
 * executeTool's finally-block into
 * server/tools/middleware/performance-ledger.ts MECHANICALLY:
 *   - the module exists and exports recordToolPerformance,
 *   - executeTool imports + delegates to it in the finally-block, and
 *   - executeTool no longer carries the inline trackToolExecution glue.
 *
 * Static-only: importing performance-ledger.ts is side-effect-free (skill-
 * evolution is pulled via a call-time dynamic import INSIDE the fn).
 * server/tools.ts is NEVER imported here (pg-pool hang). Contract:
 * data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { recordToolPerformance } from "../../server/tools/middleware/performance-ledger";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/performance-ledger.ts"),
  "utf8",
);

test("S24: performance-ledger middleware exports recordToolPerformance", () => {
  assert.equal(typeof recordToolPerformance, "function");
});

test("S24: executeTool imports and delegates to the performance-ledger middleware", () => {
  assert.ok(
    toolsSrc.includes('import { recordToolPerformance } from "./tools/middleware/performance-ledger"'),
    "executeTool must import recordToolPerformance",
  );
  assert.ok(
    toolsSrc.includes("recordToolPerformance({ name, params, startMs: _ledgerStart, result, execError: _execError })"),
    "executeTool must call recordToolPerformance from the finally-block",
  );
});

test("S24: inline tool_performance glue no longer duplicated in tools.ts", () => {
  assert.ok(!toolsSrc.includes("trackToolExecution"), "inline trackToolExecution must be gone from tools.ts");
});

test("S24: performance-ledger keeps _skipTracking guard + acyclic dynamic import", () => {
  assert.ok(mwSrc.includes("_skipTracking"), "module keeps the double-count guard");
  assert.ok(
    mwSrc.includes('import("../../skill-evolution")'),
    "module must dynamic-import skill-evolution (fire-and-forget)",
  );
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc), "performance-ledger.ts must NOT static-import ./tools");
});
