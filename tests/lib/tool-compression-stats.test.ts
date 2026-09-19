import { test } from "node:test";
import assert from "node:assert/strict";
import { compressionEventDeltas, summarizeToolCompression } from "../../server/lib/tool-compression-stats";

// tok() in the module is ceil(chars / 3.5) — lockstep with the compressor.
const tok = (c: number) => Math.ceil(c / 3.5);

test("passthrough call counts toward calls only, no savings", () => {
  const d = compressionEventDeltas({ originalChars: 500, outputChars: 500, maxChars: 6000, compressed: false });
  assert.equal(d.calls, 1);
  assert.equal(d.compressedCalls, 0);
  assert.equal(d.originalChars, 0);
  assert.equal(d.tokensVsBaseline, 0);
  assert.equal(d.tokensVsRaw, 0);
});

test("baseline = min(original, maxChars): when original exceeds the cap, baseline is the cap", () => {
  // original 30000 chars, cap 6000, compressor got it down to 4000.
  const d = compressionEventDeltas({ originalChars: 30000, outputChars: 4000, maxChars: 6000, compressed: true });
  assert.equal(d.compressedCalls, 1);
  assert.equal(d.baselineChars, 6000, "baseline caps at maxChars, not the raw size");
  assert.equal(d.originalChars, 30000);
  assert.equal(d.outputChars, 4000);
});

test("vs-baseline uses the cap; vs-raw uses the full payload", () => {
  const d = compressionEventDeltas({ originalChars: 30000, outputChars: 4000, maxChars: 6000, compressed: true });
  assert.equal(d.tokensVsBaseline, Math.max(0, tok(6000) - tok(4000)));
  assert.equal(d.tokensVsRaw, Math.max(0, tok(30000) - tok(4000)));
  assert.ok(d.tokensVsRaw > d.tokensVsBaseline, "vs-raw is the larger gross figure");
});

test("when original is under the cap, baseline equals original (head-slice would not have trimmed)", () => {
  // structured payload 5000 chars under the 6000 cap, compressed to 4050.
  const d = compressionEventDeltas({ originalChars: 5000, outputChars: 4050, maxChars: 6000, compressed: true });
  assert.equal(d.baselineChars, 5000);
  assert.equal(d.tokensVsBaseline, Math.max(0, tok(5000) - tok(4050)));
});

test("never reports negative savings (output larger than baseline clamps to 0)", () => {
  const d = compressionEventDeltas({ originalChars: 100, outputChars: 4000, maxChars: 6000, compressed: true });
  assert.equal(d.tokensVsBaseline, 0);
  assert.equal(d.tokensVsRaw, 0);
});

test("summarize rejects non-positive tenant without a DB call", async () => {
  const s0 = await summarizeToolCompression(0);
  assert.equal(s0.calls, 0);
  assert.equal(s0.degraded, false);
  const sNeg = await summarizeToolCompression(-5);
  assert.equal(sNeg.tokensSavedVsBaseline, 0);
  assert.equal(sNeg.degraded, false);
});
