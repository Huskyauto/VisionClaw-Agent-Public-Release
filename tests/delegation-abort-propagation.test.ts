import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const heartbeatSource = readFileSync(
  new URL("../server/heartbeat.ts", import.meta.url),
  "utf8",
);
const chatEngineSource = readFileSync(
  new URL("../server/chat-engine.ts", import.meta.url),
  "utf8",
);
const toolsSource = readFileSync(
  new URL("../server/tools.ts", import.meta.url),
  "utf8",
);

test("delegate_task threads its authoritative timeout signal into chat execution", () => {
  assert.match(heartbeatSource, /getCurrentToolAbortSignal\(\)/);
  assert.match(heartbeatSource, /processMessage\([\s\S]*?abortSignal:\s*delegationAbortSignal/);
});

test("delegated chat stops at execution boundaries after its parent timeout", () => {
  assert.match(chatEngineSource, /abortSignal\?:\s*AbortSignal/);
  assert.match(chatEngineSource, /opts\?\.abortSignal\?\.throwIfAborted\(\)/);
});

test("an aborted delegation is never retried", () => {
  assert.match(toolsSource, /if\s*\(delegationAbortSignal\?\.aborted\)[\s\S]*?return\s*\{/);
});