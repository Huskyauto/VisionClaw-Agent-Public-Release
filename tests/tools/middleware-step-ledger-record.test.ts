/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 3: step
 * ledger). Proves the R68 step-ledger auto-record was extracted from executeTool
 * into server/tools/middleware/step-ledger-record.ts MECHANICALLY:
 *   - the module exists and exports recordStepLedger,
 *   - executeTool imports + delegates to it, and
 *   - executeTool no longer carries the inline autoRecordToolCall glue.
 *
 * Static-only: importing step-ledger-record.ts is side-effect-free (step-ledger
 * is pulled via a call-time dynamic import INSIDE the fn). server/tools.ts is
 * NEVER imported here (pg-pool hang). Contract:
 * data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { recordStepLedger } from "../../server/tools/middleware/step-ledger-record";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/step-ledger-record.ts"),
  "utf8",
);

test("S24: step-ledger middleware exports recordStepLedger", () => {
  assert.equal(typeof recordStepLedger, "function");
});

test("S24: executeTool imports and delegates to the step-ledger middleware", () => {
  assert.ok(
    toolsSrc.includes('import { recordStepLedger } from "./tools/middleware/step-ledger-record"'),
    "executeTool must import recordStepLedger",
  );
  assert.ok(
    toolsSrc.includes("recordStepLedger({ name, params, finalResult, startMs: _ledgerStart })"),
    "executeTool must call recordStepLedger with the finalResult",
  );
});

test("S24: inline step-ledger glue no longer duplicated in tools.ts", () => {
  assert.ok(!toolsSrc.includes("autoRecordToolCall"), "inline autoRecordToolCall must be gone from tools.ts");
});

test("S24: step-ledger module keeps ambient-run pickup + acyclic dynamic import", () => {
  assert.ok(mwSrc.includes("currentRun()"), "module keeps the ambient-run context pickup");
  assert.ok(
    mwSrc.includes('await import("../../step-ledger")'),
    "module must dynamic-import step-ledger at call time",
  );
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc), "step-ledger-record.ts must NOT static-import ./tools");
});
