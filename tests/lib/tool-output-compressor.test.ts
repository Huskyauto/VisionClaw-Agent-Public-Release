import { test } from "node:test";
import assert from "node:assert/strict";
import { compressToolOutput, getToolCompressionStats, __internals } from "../../server/lib/tool-output-compressor";

test("passthrough when under cap", () => {
  const raw = JSON.stringify({ ok: true, n: 1 });
  const r = compressToolOutput({ toolName: "x", raw, maxChars: 6000 });
  assert.equal(r.strategy, "passthrough");
  assert.equal(r.text, raw);
  assert.equal(r.lossy, false);
});

test("JSON: large array is head+tail sampled with omitted marker and stays valid JSON under cap", () => {
  const big = { results: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item-${i}`, blob: "z".repeat(80) })) };
  const raw = JSON.stringify(big);
  assert.ok(raw.length > 6000);
  const r = compressToolOutput({ toolName: "code_search", raw, maxChars: 6000 });
  assert.equal(r.strategy, "json");
  assert.ok(r.outputChars <= 6000, "must honor budget cap");
  assert.ok(r.outputChars < r.originalChars, "must shrink");
  const parsed = JSON.parse(r.text);
  assert.ok(Array.isArray(parsed.results));
  const marker = parsed.results.find((x: any) => x && x.__omitted_items);
  assert.ok(marker, "should contain an __omitted_items marker");
  assert.equal(marker.__array_len, 200);
});

test("JSON: very long strings are trimmed head+tail", () => {
  const r = __internals.compressJsonValue({ log: "A".repeat(5000) }, 0);
  assert.ok(r.log.length < 5000);
  assert.match(r.log, /chars omitted/);
  assert.ok(r.log.startsWith("AAAA"));
  assert.ok(r.log.endsWith("AAAA"));
});

test("text/logs: repeated consecutive lines are deduped", () => {
  const raw = ["start", ...Array(50).fill("DEBUG heartbeat ok"), "end"].join("\n");
  const out = __internals.compressText(raw);
  assert.match(out, /repeated 49× more/);
  assert.ok(out.length < raw.length);
  assert.ok(out.includes("start") && out.includes("end"));
});

test("end-of-payload signal survives the cap (FATAL on last line)", () => {
  const noise = Array.from({ length: 4000 }, (_, i) => `line ${i} ................................`).join("\n");
  const raw = noise + "\nFATAL: disk full on /dev/sda1";
  const r = compressToolOutput({ toolName: "run_command", raw, maxChars: 2000 });
  assert.ok(r.outputChars <= 2000, "honors cap");
  assert.match(r.text, /FATAL: disk full/, "trailing signal must survive head+tail cap");
});

test("headTailCap keeps both ends", () => {
  const s = "HEAD" + "x".repeat(5000) + "TAIL";
  const capped = __internals.headTailCap(s, 1000);
  assert.ok(capped.length <= 1000);
  assert.ok(capped.startsWith("HEAD"));
  assert.ok(capped.endsWith("TAIL"));
  assert.match(capped, /chars omitted/);
});

test("disabled mode falls back to simple cap and never exceeds budget", () => {
  const raw = "y".repeat(10000);
  const r = compressToolOutput({ toolName: "x", raw, maxChars: 3000, enabled: false });
  assert.equal(r.strategy, "passthrough");
  assert.ok(r.text.length <= 3000, "disabled-mode output must not exceed cap");
  assert.equal(r.outputChars, r.text.length);
});

test("headTailCap stays bounded even when maxChars < marker length", () => {
  const capped = __internals.headTailCap("x".repeat(1000), 5);
  assert.ok(capped.length <= 5, "degenerate tiny cap must still be bounded");
});

test("tiny maxChars stays within budget across all paths (degenerate)", () => {
  for (const enabled of [true, false]) {
    const raw = JSON.stringify({ a: Array.from({ length: 100 }, (_, i) => i) });
    const r = compressToolOutput({ toolName: "x", raw, maxChars: 8, enabled });
    assert.ok(r.outputChars <= 8, `cap must hold (enabled=${enabled})`);
    assert.ok(r.text.length <= 8);
  }
});

test("invalid JSON falls to text path and never exceeds cap", () => {
  const raw = "{ this is not valid json " + "Z".repeat(8000);
  const r = compressToolOutput({ toolName: "x", raw, maxChars: 2500 });
  assert.ok(r.outputChars <= 2500);
  assert.ok(["text", "headtail-cap"].includes(r.strategy));
});

test("reports positive token savings and accumulates stats", () => {
  const before = getToolCompressionStats().compressedCalls;
  const raw = JSON.stringify({ rows: Array.from({ length: 300 }, (_, i) => ({ i, v: "q".repeat(50) })) });
  const r = compressToolOutput({ toolName: "db_query", raw, maxChars: 4000 });
  assert.ok(r.tokensSaved > 0);
  const stats = getToolCompressionStats();
  assert.ok(stats.compressedCalls > before);
  assert.ok(stats.savingsRatio > 0 && stats.savingsRatio <= 1);
});
