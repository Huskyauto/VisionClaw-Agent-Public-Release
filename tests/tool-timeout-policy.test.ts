import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_TOOL_TIMEOUT_MS,
  VERY_SLOW_TOOL_TIMEOUT_MS,
  getToolWatchdogHardCapMs,
  getToolTimeoutMs,
} from "../server/lib/tool-timeout-policy";

test("plan watchdogs can use the same authoritative timeout as tool dispatch", () => {
  assert.equal(getToolTimeoutMs("delegate_task"), VERY_SLOW_TOOL_TIMEOUT_MS);
  assert.equal(getToolTimeoutMs("__ordinary_tool__"), DEFAULT_TOOL_TIMEOUT_MS);
});

test("watchdog cap covers reconciliation and the one permitted timeout retry", () => {
  assert.equal(
    getToolWatchdogHardCapMs("delegate_task"),
    (2 * VERY_SLOW_TOOL_TIMEOUT_MS) + 60_000,
  );
});

test("plan tool steps register the shared total dispatch watchdog cap", () => {
  const source = readFileSync(
    new URL("../server/plan-executor.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getToolWatchdogHardCapMs\(toolName\)/);
  assert.match(source, /hardCapMs:\s*toolWatchdogHardCapMs/);
});