import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTurnEvents,
  encodeAguiSse,
  parseAguiThreadId,
  makeAguiThreadId,
  AGUI_TEXT_CHUNK,
  AGUI_TOOL_RESULT_CAP,
} from "../../server/lib/agui-events";

test("encodeAguiSse emits a well-formed SSE frame", () => {
  const frame = encodeAguiSse({ type: "RUN_STARTED", threadId: "vc-conv-1", runId: "r1" });
  assert.ok(frame.startsWith("data: "));
  assert.ok(frame.endsWith("\n\n"));
  const parsed = JSON.parse(frame.slice(6));
  assert.equal(parsed.type, "RUN_STARTED");
});

test("buildTurnEvents emits protocol-ordered sequence with tools", () => {
  const events = buildTurnEvents({
    threadId: "vc-conv-7",
    runId: "r1",
    messageId: "m1",
    response: "hello world",
    toolsUsed: [{ name: "web_search", input: { q: "x" }, output: { hits: 3 } }],
  });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, [
    "RUN_STARTED",
    "TOOL_CALL_START",
    "TOOL_CALL_ARGS",
    "TOOL_CALL_END",
    "TOOL_CALL_RESULT",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "RUN_FINISHED",
  ]);
  const toolStart = events[1] as any;
  assert.equal(toolStart.toolCallName, "web_search");
  const result = events[4] as any;
  assert.equal(result.role, "tool");
  assert.ok(result.content.includes("hits"));
});

test("buildTurnEvents chunks long responses and reassembles losslessly", () => {
  const text = "x".repeat(AGUI_TEXT_CHUNK * 2 + 5);
  const events = buildTurnEvents({ threadId: "t", runId: "r", messageId: "m", response: text });
  const chunks = events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT") as any[];
  assert.equal(chunks.length, 3);
  assert.equal(chunks.map((c) => c.delta).join(""), text);
});

test("buildTurnEvents caps oversized tool outputs", () => {
  const events = buildTurnEvents({
    threadId: "t",
    runId: "r",
    messageId: "m",
    response: "ok",
    toolsUsed: [{ name: "big", input: {}, output: "y".repeat(AGUI_TOOL_RESULT_CAP + 500) }],
  });
  const result = events.find((e) => e.type === "TOOL_CALL_RESULT") as any;
  assert.ok(result.content.length < AGUI_TOOL_RESULT_CAP + 100);
  assert.ok(result.content.includes("[truncated"));
});

test("buildTurnEvents handles empty response and null toolsUsed", () => {
  const events = buildTurnEvents({ threadId: "t", runId: "r", messageId: "m", response: "", toolsUsed: null });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "RUN_FINISHED"]);
});

test("parseAguiThreadId maps only the exact vc-conv-<int> shape", () => {
  assert.equal(parseAguiThreadId("vc-conv-42"), 42);
  assert.equal(parseAguiThreadId(makeAguiThreadId(7)), 7);
  assert.equal(parseAguiThreadId("vc-conv-0"), null);
  assert.equal(parseAguiThreadId("vc-conv--1"), null);
  assert.equal(parseAguiThreadId("vc-conv-1e3"), null);
  assert.equal(parseAguiThreadId("conv-42"), null);
  assert.equal(parseAguiThreadId("vc-conv-42x"), null);
  assert.equal(parseAguiThreadId(42 as any), null);
  assert.equal(parseAguiThreadId(undefined), null);
  assert.equal(parseAguiThreadId("vc-conv-9999999999999"), null);
});
