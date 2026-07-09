/**
 * Tools-layer-split S4 — dispatcher contract tests.
 *
 * Pure package-level tests: import ONLY server/tools/** (+ node builtins).
 * Never import server/tools.ts (keeps the pg pool closed — node:test hangs
 * otherwise) — the executeTool-level invariants are asserted STATICALLY
 * against the monolith source instead.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md (S4)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { dispatchTool } from "../../server/tools/dispatcher";
import { registerTools } from "../../server/tools/registry";
import { getLegacyExecutor, setLegacyExecutor } from "../../server/tools/legacy-switch";
import { defineTool } from "../../server/tools/define-tool";
import type { ToolContext } from "../../server/tools/types";
import { getUsageAnalyticsHandler } from "../../server/tools/domains/system/handlers";

const TOOLS_TS = path.resolve(process.cwd(), "server/tools.ts");

test("migrated handler gets STRIPPED params + trusted ctx from stamped trust signals", async () => {
  let seenParams: Record<string, any> | undefined;
  let seenCtx: ToolContext | undefined;
  registerTools([
    defineTool(
      {
        type: "function",
        function: {
          name: "s4_dispatch_probe_tool",
          description: "test-only probe (never shipped: not in TOOL_DEFINITIONS)",
          parameters: { type: "object", properties: {} },
        },
      },
      async (params, ctx) => {
        seenParams = params;
        seenCtx = ctx;
        return { ok: true };
      },
    ),
  ]);

  const result = await dispatchTool("s4_dispatch_probe_tool", {
    foo: "bar",
    _tenantId: 42,
    _personaId: 7,
    _conversationId: 99,
    _rateLimitChecked: true,
    _approvedByGate: true,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(seenParams, { foo: "bar" }, "trust signals must be stripped from handler params");
  assert.equal(seenCtx?.tenantId, 42);
  assert.equal(seenCtx?.personaId, 7);
  assert.equal(seenCtx?.conversationId, 99);
  assert.equal(seenCtx?.rateLimitChecked, true);
});

test("unmigrated tool with NO legacy executor returns the structured unknown-tool error", async () => {
  assert.equal(getLegacyExecutor(), undefined, "slot must start empty in a pure package test");
  const result: any = await dispatchTool("definitely_not_a_real_tool_s4", { _tenantId: 1 });
  assert.ok(typeof result.error === "string" && result.error.includes("Unknown tool"));
});

test("unmigrated tool falls back to legacy executor with ORIGINAL (unstripped) params", async () => {
  let seenName: string | undefined;
  let seenParams: Record<string, any> | undefined;
  setLegacyExecutor(async (name, params) => {
    seenName = name;
    seenParams = params;
    return { legacy: true };
  });
  try {
    const original = { x: 1, _tenantId: 5, _rateLimitChecked: true };
    const result = await dispatchTool("some_unmigrated_tool", original);
    assert.deepEqual(result, { legacy: true });
    assert.equal(seenName, "some_unmigrated_tool");
    assert.equal(seenParams, original, "legacy path must receive the SAME params object — zero behavior change");
  } finally {
    setLegacyExecutor(undefined as any);
  }
});

test("get_usage_analytics handler fails CLOSED without tenant ctx (before any app import)", async () => {
  const result: any = await getUsageAnalyticsHandler({ days: 7 }, {});
  assert.equal(result.error, "Tenant context required for get_usage_analytics");
});

test("executeTool rate-limit gate + handshake are delegated to the S24 middleware, upstream of dispatch", () => {
  const src = readFileSync(TOOLS_TS, "utf8");
  // S24: the rate-limit gate (fail-CLOSED backstop + `_rateLimitChecked`
  // handshake stamp) was extracted into server/tools/middleware/rate-limit.ts.
  // executeTool now DELEGATES to it, and must still do so BEFORE inner dispatch.
  const gateIdx = src.indexOf("enforceRateLimitGate(name, params)");
  assert.ok(gateIdx > -1, "executeTool must delegate to the S24 rate-limit middleware");
  const innerCallIdx = src.indexOf("_executeToolInner(name, params)");
  assert.ok(innerCallIdx > -1, "executeTool must still dispatch via _executeToolInner");
  assert.ok(gateIdx < innerCallIdx, "rate-limit gate must run before inner dispatch");
  assert.ok(/rate.?limit/i.test(src.slice(0, innerCallIdx)), "rate-limit gate must remain upstream of dispatch");
  // The handshake stamp + fail-CLOSED backstop now live in the middleware module.
  const rlMw = readFileSync(
    path.resolve(process.cwd(), "server/tools/middleware/rate-limit.ts"),
    "utf8",
  );
  assert.ok(rlMw.includes("._rateLimitChecked = true"), "handshake stamp must live in the rate-limit middleware");
  assert.ok(rlMw.includes("HARDCODED_EXPENSIVE"), "fail-CLOSED expensive-tool backstop must live in the rate-limit middleware");
  // The seam delegates to the package dispatcher and injects the legacy switch.
  assert.ok(src.includes("return dispatchTool(name, params);"));
  assert.ok(src.includes("setLegacyExecutor(_legacySwitchExec);"));
});
