/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 7: rate-limit —
 * the LAST middleware, fail-CLOSED + `_rateLimitChecked` handshake). Proves the
 * expensive-tool rate-limit gate was extracted from executeTool into
 * server/tools/middleware/rate-limit.ts MECHANICALLY:
 *   - the module exists and exports enforceRateLimitGate,
 *   - executeTool imports + delegates to it, and
 *   - executeTool no longer carries the inline limiter glue (no divergent copy).
 *
 * Static-only: importing rate-limit.ts is side-effect-free (tool-rate-limiter is
 * pulled via a call-time dynamic import INSIDE the gate, so no db/pg-pool opens
 * at import). server/tools.ts is NEVER imported here (pg-pool hang — see
 * node-test-db-pool-hang). Contract:
 * data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { enforceRateLimitGate } from "../../server/tools/middleware/rate-limit";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/rate-limit.ts"),
  "utf8",
);

test("S24: rate-limit middleware exports enforceRateLimitGate", () => {
  assert.equal(typeof enforceRateLimitGate, "function");
  assert.equal(enforceRateLimitGate.length, 2); // (name, params)
});

test("S24: executeTool imports and delegates to the rate-limit middleware", () => {
  assert.ok(
    toolsSrc.includes('import { enforceRateLimitGate } from "./tools/middleware/rate-limit"'),
    "executeTool must import enforceRateLimitGate",
  );
  assert.ok(
    toolsSrc.includes("enforceRateLimitGate(name, params)"),
    "executeTool must call enforceRateLimitGate(name, params)",
  );
});

test("S24: inline rate-limit glue no longer duplicated in tools.ts", () => {
  assert.ok(!toolsSrc.includes("checkToolRateLimit"), "inline checkToolRateLimit must be gone from tools.ts");
  assert.ok(!toolsSrc.includes("HARDCODED_EXPENSIVE"), "inline fail-closed backstop list must be gone from tools.ts");
});

test("S24: rate-limit fail-CLOSED behavior + handshake preserved in the module", () => {
  // The fail-CLOSED backstop (expensive tools blocked when the limiter is
  // unloadable) and the _rateLimitChecked handshake both live in the module now.
  assert.ok(mwSrc.includes("HARDCODED_EXPENSIVE"), "module keeps the fail-closed backstop list");
  assert.ok(mwSrc.includes("_rateLimitChecked"), "module keeps the _rateLimitChecked handshake");
});

test("S24: rate-limit module keeps the acyclic call-time limiter import", () => {
  assert.ok(
    mwSrc.includes('await import("../../tool-rate-limiter")'),
    "gate must dynamic-import tool-rate-limiter at call time",
  );
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc), "rate-limit.ts must NOT static-import ./tools");
});
