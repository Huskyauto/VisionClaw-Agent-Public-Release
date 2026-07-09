/**
 * Tools-layer-split S24 seam guard (middleware extraction, phase 1: tracing).
 * Proves the tool-span glue was extracted from executeTool into the new
 * server/tools/middleware/tracing.ts module MECHANICALLY:
 *   - the middleware module exists and exports runWithToolSpan,
 *   - executeTool imports + calls it (delegation wired), and
 *   - executeTool no longer carries the inline withSpanOrRoot glue (no
 *     duplicate/divergent copy left behind).
 *
 * Static-only: importing tracing.ts is side-effect-free (agent-trace is pulled
 * via a call-time dynamic import INSIDE runWithToolSpan, so no db/pg-pool is
 * opened at import). server/tools.ts itself is NEVER imported here (pg-pool
 * hang — see node-test-db-pool-hang). Contract:
 * data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runWithToolSpan } from "../../server/tools/middleware/tracing";

const toolsSrc = readFileSync(
  path.join(process.cwd(), "server/tools.ts"),
  "utf8",
);
const tracingSrc = readFileSync(
  path.join(process.cwd(), "server/tools/middleware/tracing.ts"),
  "utf8",
);

test("S24: tracing middleware module exports runWithToolSpan", () => {
  assert.equal(typeof runWithToolSpan, "function");
  // helper arity: (name, params, inner)
  assert.equal(runWithToolSpan.length, 3);
});

test("S24: executeTool imports and delegates to the tracing middleware", () => {
  assert.ok(
    toolsSrc.includes(
      'import { runWithToolSpan } from "./tools/middleware/tracing"',
    ),
    "executeTool must import runWithToolSpan from the middleware module",
  );
  assert.ok(
    toolsSrc.includes(
      "runWithToolSpan(name, params, () => _executeToolInner(name, params))",
    ),
    "executeTool must call runWithToolSpan wrapping _executeToolInner",
  );
});

test("S24: inline span glue no longer duplicated in tools.ts", () => {
  // The withSpanOrRoot wrap + the _spanMeta builder used to live inline in
  // executeTool; after extraction they exist ONLY in the middleware module.
  // (Note: an UNRELATED agent-trace import — fetchTraceTree for the get_trace
  // tool handler — legitimately remains in tools.ts, so we assert on the span
  // glue specifically, not on any agent-trace import.)
  assert.ok(
    !toolsSrc.includes("withSpanOrRoot("),
    "the inline withSpanOrRoot(...) wrap must be gone from tools.ts",
  );
  assert.ok(
    !toolsSrc.includes("const _spanMeta: Record<string, unknown> = {"),
    "the inline _spanMeta builder must be gone from tools.ts",
  );
});

test("S24: tracing module keeps the acyclic call-time agent-trace import", () => {
  // Acyclicity invariant: the middleware pulls the span impl at call time, not
  // via a static top-level import that would edge back into the app graph.
  assert.ok(
    tracingSrc.includes('await import("../../lib/agent-trace")'),
    "runWithToolSpan must dynamic-import agent-trace at call time",
  );
  assert.ok(
    !/^import\s+.*agent-trace/m.test(tracingSrc),
    "tracing.ts must NOT statically import agent-trace",
  );
});
