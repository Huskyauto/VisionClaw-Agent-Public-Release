/**
 * tests/unit/observation-masking.test.ts
 *
 * Covers the observation-masking helper (server/lib/observation-masking.ts)
 * wired into the chat-engine round loop. It shrinks STALE tool-output bodies
 * from rounds older than `keepRecentRounds` while keeping the tool-call record
 * (role:"tool" + tool_call_id) intact, so the API message pairing stays valid
 * and the model still knows the call happened.
 *
 * Pure logic, no DB / no network — node:test never hangs.
 *
 * Run: node --import tsx --test tests/unit/observation-masking.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  maskStaleObservations,
  buildMaskStub,
  STUB_PREFIX,
} from "../../server/lib/observation-masking";

const BIG = "x".repeat(5000);

/** Build a conversation: each "round" = an assistant-with-tool_calls boundary
 *  followed by one tool result message. */
function convo(rounds: number, body = BIG): any[] {
  const msgs: any[] = [{ role: "system", content: "sys" }, { role: "user", content: "hi" }];
  for (let r = 0; r < rounds; r++) {
    msgs.push({ role: "assistant", content: null, tool_calls: [{ id: `tc${r}`, function: { name: "read_file" } }] });
    msgs.push({ role: "tool", tool_call_id: `tc${r}`, content: body });
  }
  return msgs;
}

test("returns zero and mutates nothing when not enough completed rounds", () => {
  const msgs = convo(2); // boundaries(2) <= keepRecentRounds(2)
  const before = JSON.stringify(msgs);
  const res = maskStaleObservations(msgs, { keepRecentRounds: 2 });
  assert.equal(res.maskedCount, 0);
  assert.equal(res.charsSaved, 0);
  assert.equal(JSON.stringify(msgs), before);
});

test("masks tool outputs older than the last keepRecentRounds rounds", () => {
  const msgs = convo(5); // 5 boundaries, keep last 2 → mask rounds 0,1,2
  const res = maskStaleObservations(msgs, { keepRecentRounds: 2 });
  assert.equal(res.maskedCount, 3);
  assert.ok(res.charsSaved > 0);
  // tool results for rounds 0,1,2 masked; 3,4 intact
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  assert.ok(toolMsgs[0].content.startsWith(STUB_PREFIX));
  assert.ok(toolMsgs[1].content.startsWith(STUB_PREFIX));
  assert.ok(toolMsgs[2].content.startsWith(STUB_PREFIX));
  assert.equal(toolMsgs[3].content, BIG);
  assert.equal(toolMsgs[4].content, BIG);
});

test("preserves tool_call_id pairing on masked messages", () => {
  const msgs = convo(4);
  maskStaleObservations(msgs, { keepRecentRounds: 1 });
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  toolMsgs.forEach((m, i) => {
    assert.equal(m.role, "tool");
    assert.equal(m.tool_call_id, `tc${i}`);
  });
});

test("is idempotent across rounds — already-masked bodies are skipped", () => {
  const msgs = convo(5);
  const first = maskStaleObservations(msgs, { keepRecentRounds: 2 });
  assert.equal(first.maskedCount, 3);
  const second = maskStaleObservations(msgs, { keepRecentRounds: 2 });
  assert.equal(second.maskedCount, 0);
  assert.equal(second.charsSaved, 0);
});

test("does not mask small bodies under minBodyChars", () => {
  const msgs = convo(5, "tiny");
  const res = maskStaleObservations(msgs, { keepRecentRounds: 2, minBodyChars: 600 });
  assert.equal(res.maskedCount, 0);
});

test("masks vision/array content and drops the image", () => {
  const msgs: any[] = [{ role: "user", content: "hi" }];
  for (let r = 0; r < 4; r++) {
    msgs.push({ role: "assistant", content: null, tool_calls: [{ id: `tc${r}`, function: { name: "browse_url" } }] });
    msgs.push({
      role: "tool",
      tool_call_id: `tc${r}`,
      content: [
        { type: "text", text: "short text" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    });
  }
  const res = maskStaleObservations(msgs, { keepRecentRounds: 1 });
  assert.equal(res.maskedCount, 3); // rounds 0,1,2 masked, 3 kept
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  // masked ones became a string stub mentioning the dropped image
  assert.equal(typeof toolMsgs[0].content, "string");
  assert.ok(toolMsgs[0].content.includes("image observation was also dropped"));
  // the most recent one keeps its array (with the image)
  assert.ok(Array.isArray(toolMsgs[3].content));
});

test("disabled flag returns zero and mutates nothing", () => {
  const msgs = convo(5);
  const before = JSON.stringify(msgs);
  const res = maskStaleObservations(msgs, { keepRecentRounds: 2, enabled: false });
  assert.equal(res.maskedCount, 0);
  assert.equal(JSON.stringify(msgs), before);
});

test("handles empty / non-array input safely", () => {
  assert.deepEqual(maskStaleObservations([]), { maskedCount: 0, charsSaved: 0 });
  assert.deepEqual(maskStaleObservations(null as any), { maskedCount: 0, charsSaved: 0 });
  assert.deepEqual(maskStaleObservations(undefined as any), { maskedCount: 0, charsSaved: 0 });
});

test("never replaces a body with a longer stub", () => {
  // a body just over minBody but shorter than the stub should be skipped
  const stubLen = buildMaskStub(620, false).length;
  const body = "y".repeat(Math.min(620, stubLen - 1));
  const msgs = convo(5, body);
  const res = maskStaleObservations(msgs, { keepRecentRounds: 2, minBodyChars: 1 });
  // bodies shorter than the stub are not grown
  for (const m of msgs.filter((x) => x.role === "tool")) {
    assert.ok(!(typeof m.content === "string" && m.content.startsWith(STUB_PREFIX) && m.content.length > body.length));
  }
  assert.ok(res.charsSaved >= 0);
});

test("keepRecentRounds is clamped to a minimum of 1", () => {
  const msgs = convo(4);
  const res = maskStaleObservations(msgs, { keepRecentRounds: 0 });
  // clamped to 1 → keep last round, mask the first 3
  assert.equal(res.maskedCount, 3);
});
