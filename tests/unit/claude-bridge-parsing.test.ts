/**
 * tests/unit/claude-bridge-parsing.test.ts — Claude Runner bridge options + event parsing
 *
 * The bridge runs on the official @anthropic-ai/claude-agent-sdk `query()` (same
 * `claude` CLI subprocess underneath). Pins two contracts:
 *   - buildQueryOptions() must keep the bridge TEXT-ONLY (`tools: []` disables every
 *     built-in agent tool), apply the model remap, bound turns, and cap/omit the
 *     system prompt.
 *   - processNdjsonEvent() must extract assistant text from event.message.content[] text
 *     blocks (skipping thinking blocks) — the SDK/CLI message schema — and read token
 *     usage from event.usage.{input,output}_tokens.
 * Pure functions + a tiny fake ServerResponse — no DB / pg pool (node:test DB-pool-hang).
 *
 * Run: node --import tsx --test tests/unit/claude-bridge-parsing.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildQueryOptions, buildSafeEnv, processNdjsonEvent } from "../../server/claude-runner";

// ── buildQueryOptions ───────────────────────────────────────────────────────
test("bridge is text-only: tools is an empty array (disables ALL built-in agent tools)", () => {
  const opts = buildQueryOptions("claude-haiku-4-5", undefined);
  assert.deepEqual(opts.tools, []);
});

test("known-bad dated model ids are remapped; bare ids pass through", () => {
  assert.equal(buildQueryOptions("claude-sonnet-4-20250514", undefined).model, "claude-sonnet-4-5");
  assert.equal(buildQueryOptions("claude-opus-4-8", undefined).model, "claude-opus-4-8");
});

test("maxTurns is bounded", () => {
  const opts = buildQueryOptions("claude-haiku-4-5", undefined);
  assert.equal(typeof opts.maxTurns, "number");
  assert.ok(opts.maxTurns > 0 && opts.maxTurns <= 10);
});

test("system prompt is included when provided, capped at 20k, omitted when absent", () => {
  const withSys = buildQueryOptions("claude-opus-4-8", "be terse");
  assert.equal(withSys.systemPrompt, "be terse");
  const long = buildQueryOptions("claude-opus-4-8", "x".repeat(30_000));
  assert.equal(long.systemPrompt?.length, 20_000);
  const without = buildQueryOptions("claude-opus-4-8", undefined);
  assert.equal("systemPrompt" in without, false);
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

// ── buildSafeEnv ────────────────────────────────────────────────────────────
// The SDK `env` option REPLACES the child env entirely, so buildSafeEnv() is the
// full subprocess environment. Contract: allowlist-only + OAuth-over-API-key.
function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) {
    saved[k] = process.env[k];
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  try { fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("buildSafeEnv is allowlist-only: non-allowlisted secrets never reach the child env", () => {
  withEnv({ DATABASE_URL: "postgres://fake", SESSION_SECRET: "fake", OPENAI_API_KEY: "fake" }, () => {
    const env = buildSafeEnv();
    assert.equal("DATABASE_URL" in env, false);
    assert.equal("SESSION_SECRET" in env, false);
    assert.equal("OPENAI_API_KEY" in env, false);
  });
});

test("buildSafeEnv drops ANTHROPIC_API_KEY when the OAuth subscription token is set", () => {
  withEnv({ ANTHROPIC_API_KEY: "sk-fake", CLAUDE_CODE_OAUTH_TOKEN: "oauth-fake" }, () => {
    const env = buildSafeEnv();
    assert.equal("ANTHROPIC_API_KEY" in env, false);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "oauth-fake");
  });
});

test("buildSafeEnv keeps ANTHROPIC_API_KEY as the metered fallback when no OAuth token", () => {
  withEnv({ ANTHROPIC_API_KEY: "sk-fake", CLAUDE_CODE_OAUTH_TOKEN: undefined }, () => {
    const env = buildSafeEnv();
    assert.equal(env.ANTHROPIC_API_KEY, "sk-fake");
  });
});

test("buildSafeEnv always provides XDG dirs derived from HOME", () => {
  const env = buildSafeEnv();
  for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
    assert.equal(typeof env[k], "string");
    assert.ok(env[k].length > 0);
  }
});
