/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 5: product
 * verification). Proves attachProductVerification was extracted from executeTool
 * into server/tools/middleware/product-verification.ts MECHANICALLY:
 *   - the module exists and exports attachProductVerification,
 *   - executeTool imports + delegates to it behind the PRODUCT_OUTPUT_TOOLS gate
 *     (which stays at the callsite), and
 *   - executeTool no longer carries the inline verification builder.
 *
 * Static-only: product-verification.ts imports only `fs` (no db). It is safe to
 * exercise the pure function directly here. server/tools.ts is NEVER imported
 * (pg-pool hang). Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { attachProductVerification } from "../../server/tools/middleware/product-verification";

const toolsSrc = readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
const mwSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/product-verification.ts"),
  "utf8",
);

test("S24: product-verification middleware exports attachProductVerification", () => {
  assert.equal(typeof attachProductVerification, "function");
});

test("S24: executeTool imports and delegates behind the PRODUCT_OUTPUT_TOOLS gate", () => {
  assert.ok(
    toolsSrc.includes('import { attachProductVerification } from "./tools/middleware/product-verification"'),
    "executeTool must import attachProductVerification",
  );
  assert.ok(
    toolsSrc.includes("PRODUCT_OUTPUT_TOOLS.has(name) ? attachProductVerification(name, result)"),
    "executeTool must call attachProductVerification behind the PRODUCT_OUTPUT_TOOLS gate",
  );
});

test("S24: inline product-verification builder no longer in tools.ts", () => {
  assert.ok(!toolsSrc.includes("function attachProductVerification"), "the fn definition must be gone from tools.ts");
  assert.ok(!toolsSrc.includes("_productVerification"), "the inline report builder must be gone from tools.ts");
});

test("S24: pure fail-closed behavior preserved (no checks => REVIEW_NEEDED)", () => {
  // A result with no verifiable fields must fail-closed to REVIEW_NEEDED.
  const out = attachProductVerification("some_tool", { ok: true });
  assert.equal(out._productVerification.overallStatus, "REVIEW_NEEDED");
  assert.equal(out._productVerification.checks.length, 0);
  // Error results pass through untouched.
  const err = attachProductVerification("some_tool", { error: "boom" });
  assert.equal(err._productVerification, undefined);
});

test("S24: product-verification module has no static ./tools edge", () => {
  assert.ok(!/from ['"].*\/tools['"]/.test(mwSrc), "product-verification.ts must NOT static-import ./tools");
});
