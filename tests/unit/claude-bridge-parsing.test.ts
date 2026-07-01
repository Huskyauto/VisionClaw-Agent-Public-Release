/**
 * tests/unit/claude-bridge-parsing.test.ts — Claude Runner bridge arg + NDJSON parsing
 *
 * Guards two latent bugs that surfaced once the Claude CLI was actually installed:
 *   - buildCliArgs() must NOT pass --verbose on the plain `json` path (it corrupts the
 *     output into a stream-json event array), but MUST pass it on `stream-json`.
 *   - processNdjsonEvent() must extract assistant text from event.message.content[] text
 *     blocks (skipping thinking blocks) — the real CLI schema — and read token usage from
 *     event.usage.{input,output}_tokens. The original code matched a schema the CLI never
 *     produces, so streaming emitted zero text.
 * Pure functions + a tiny fake ServerResponse — no DB / pg pool (node:test DB-pool-hang).
 *
 * Run: node --import tsx --test tests/unit/claude-bridge-parsing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildCliArgs, processNdjsonEvent } from "../../server/claude-runner";

// ── buildCliArgs ────────────────────────────────────────────────────────────
test("json (non-streaming) path omits --verbose", () => {
  const args = buildCliArgs("hi", "claude-haiku-4-5", undefined, "json");
  assert.equal(args.includes("--verbose"), false);
  const i = args.indexOf("--output-format");
  assert.equal(args[i + 1], "json");
});

test("stream-json path includes --verbose (CLI requires it)", () => {
  const args = buildCliArgs("hi", "claude-haiku-4-5", undefined, "stream-json");
  assert.equal(args.includes("--verbose"), true);
});

test("system prompt is appended when provided", () => {
  const withSys = buildCliArgs("hi", "claude-opus-4-8", "be terse", "json");
  assert.equal(withSys.includes("--system-prompt"), true);
  const without = buildCliArgs("hi", "claude-opus-4-8", undefined, "json");
  assert.equal(without.includes("--system-prompt"), false);
});

// ── processNdjsonEvent ──────────────────────────────────────────────────────
function fakeRes() {
  const writes: string[] = [];
  return {
    writes,
    write: (s: string) => { writes.push(s); return true; },
  } as any;
}

function parseChunk(line: string) {
  return JSON.parse(line.replace(/^data: /, "").trim());
}

test("thinking-only assistant event emits nothing and returns false", () => {
  const res = fakeRes();
  const emitted = processNdjsonEvent(
    { type: "assistant", message: { content: [{ type: "thinking", thinking: "hmm" }] } },
    res, () => {}, "req1",
  );
  assert.equal(emitted, false);
  assert.equal(res.writes.length, 0);
});

test("assistant text blocks are concatenated into a content delta", () => {
  const res = fakeRes();
  const emitted = processNdjsonEvent(
    { type: "assistant", message: { content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: "po" },
      { type: "text", text: "ng" },
    ] } },
    res, () => {}, "req2",
  );
  assert.equal(emitted, true);
  const chunk = parseChunk(res.writes[0]);
  assert.equal(chunk.choices[0].delta.content, "pong");
  assert.equal(chunk.choices[0].finish_reason, null);
});

test("defensive top-level event.text fallback still works", () => {
  const res = fakeRes();
  const emitted = processNdjsonEvent(
    { type: "assistant", text: "pong" }, res, () => {}, "req3",
  );
  assert.equal(emitted, true);
  assert.equal(parseChunk(res.writes[0]).choices[0].delta.content, "pong");
});

test("result event finishes the stream with usage from event.usage", () => {
  const res = fakeRes();
  const emitted = processNdjsonEvent(
    { type: "result", result: "pong", usage: { input_tokens: 10, output_tokens: 44 } },
    res, () => {}, "req4",
  );
  assert.equal(emitted, true);
  const chunk = parseChunk(res.writes[0]);
  assert.equal(chunk.choices[0].finish_reason, "stop");
  assert.equal(chunk.usage.prompt_tokens, 10);
  assert.equal(chunk.usage.completion_tokens, 44);
  assert.equal(chunk.usage.total_tokens, 54);
});

test("result usage falls back to prompt_tokens/completion_tokens naming", () => {
  const res = fakeRes();
  processNdjsonEvent(
    { type: "result", usage: { prompt_tokens: 3, completion_tokens: 5 } },
    res, () => {}, "req5",
  );
  const chunk = parseChunk(res.writes[0]);
  assert.equal(chunk.usage.prompt_tokens, 3);
  assert.equal(chunk.usage.completion_tokens, 5);
});

test("unrelated event types are ignored", () => {
  const res = fakeRes();
  const emitted = processNdjsonEvent(
    { type: "system", subtype: "init" }, res, () => {}, "req6",
  );
  assert.equal(emitted, false);
  assert.equal(res.writes.length, 0);
});
