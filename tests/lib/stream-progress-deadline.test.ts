import assert from "node:assert/strict";
import test from "node:test";
import { hasModelProgress, streamWithProgressDeadline } from "../../server/lib/stream-progress-deadline";

test("empty keepalives cannot keep a stalled stream alive", async () => {
  let aborted = 0;
  async function* empty() {
    while (true) {
      await new Promise(r => setTimeout(r, 2));
      yield { choices: [] };
    }
  }
  await assert.rejects(async () => {
    for await (const _ of streamWithProgressDeadline(empty(), {
      timeoutMs: 25, onTimeout: () => { aborted++; },
    })) { /* consume */ }
  }, /model progress/i);
  assert.equal(aborted, 1);
});

test("role-only/usage-only frames are not progress; reasoning and tool bytes are", () => {
  assert.equal(hasModelProgress({ choices: [{ delta: { role: "assistant" } }] }), false);
  assert.equal(hasModelProgress({ choices: [], usage: { completion_tokens: 1 } }), false);
  for (const delta of [
    { content: " " }, { reasoning_content: "thinking" }, { reasoning: "thinking" },
    { reasoning_details: [{ text: "thinking" }] },
    { tool_calls: [{ function: { arguments: "{" } }] },
    { tool_calls: [{ function: { name: "read_file" } }] },
  ]) assert.equal(hasModelProgress({ choices: [{ delta }] }), true);
});

test("a stalled next() terminates even when the provider ignores cancellation", async () => {
  const hanging = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<unknown>>(() => {}) }; } };
  await assert.rejects(async () => {
    for await (const _ of streamWithProgressDeadline(hanging, { timeoutMs: 15 })) { /* consume */ }
  }, /model progress/i);
});

test("valid progress resets the idle window and completion clears the timer", async () => {
  let aborted = 0;
  async function* active() {
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 8));
      yield { choices: [{ delta: { reasoning_content: "work" } }] };
    }
  }
  let count = 0;
  for await (const _ of streamWithProgressDeadline(active(), { timeoutMs: 35, onTimeout: () => { aborted++; } })) count++;
  await new Promise(r => setTimeout(r, 40));
  assert.equal(count, 6);
  assert.equal(aborted, 0);
});

test("parent cancellation promptly stops a stalled next without calling timeout", async () => {
  const controller = new AbortController();
  const hanging = { [Symbol.asyncIterator]() { return { next: () => new Promise<IteratorResult<unknown>>(() => {}) }; } };
  const timer = setTimeout(() => controller.abort(), 5);
  try {
    await assert.rejects(async () => {
      for await (const _ of streamWithProgressDeadline(hanging, { timeoutMs: 100, signal: controller.signal, onTimeout: () => assert.fail("not timeout") })) { /* consume */ }
    }, /aborted/);
  } finally { clearTimeout(timer); }
});

test("synchronous empty-frame floods yield to parent cancellation", async () => {
  const controller = new AbortController();
  async function* flood() { while (true) yield { choices: [] }; }
  const timer = setTimeout(() => controller.abort(), 5);
  try {
    await assert.rejects(async () => {
      for await (const _ of streamWithProgressDeadline(flood(), { timeoutMs: 200, signal: controller.signal })) { /* consume */ }
    }, /aborted/);
  } finally { clearTimeout(timer); }
});

test("provider abort completing next() cannot turn a progress timeout into success", async () => {
  let settle: ((result: IteratorResult<unknown>) => void) | undefined;
  const stream = { [Symbol.asyncIterator]() {
    return { next: () => new Promise<IteratorResult<unknown>>(resolve => { settle = resolve; }) };
  } };
  await assert.rejects(async () => {
    for await (const _ of streamWithProgressDeadline(stream, {
      timeoutMs: 15, onTimeout: () => settle?.({ done: true, value: undefined }),
    })) { /* consume */ }
  }, /model progress/);
});
