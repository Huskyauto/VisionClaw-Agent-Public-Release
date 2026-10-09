/**
 * R125+52.39 — explicit proposerIds sanitization boundary.
 *
 * No real LLM calls — pure resolver verification. Guards the silent-failure
 * fix: when caller-supplied proposerIds dedupe/blank-strip down to an empty
 * set, resolveProposerSpecs must FAIL OPEN to the named pool / default
 * constants (and log loud) instead of returning [] — an empty proposer set
 * runs zero proposers and then surfaces the misleading "all proposers errored"
 * message even though none executed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProposerSpecs, resolveProposerPool } from "../../server/moa";

test("blank + duplicate explicit ids dedupe to the single real id", () => {
  const specs = resolveProposerSpecs(undefined, [" ", "GPT-5.5", "gpt-5.5"]);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].modelId, "GPT-5.5");
});

test("all-blank explicit ids fall back to default pool, never empty", () => {
  const specs = resolveProposerSpecs(undefined, ["", "   ", "\t"]);
  assert.ok(specs.length > 0, "must not return an empty proposer set");
});

test("all-duplicate explicit ids fall back rather than collapse to one-vote", () => {
  // A single id is a legitimate explicit choice; this case is about an empty
  // result AFTER sanitization. Provide only blanks so unique===0.
  const specs = resolveProposerSpecs("frontier", ["  ", "  "]);
  assert.ok(specs.length > 0, "must fall back to the named pool, not []");
  // fell back to the frontier pool
  const frontier = resolveProposerPool("frontier");
  assert.deepEqual(specs.map(s => s.modelId), frontier);
});

test("non-empty explicit ids are still honored verbatim (order-preserving)", () => {
  const specs = resolveProposerSpecs(undefined, ["claude-opus-4-8", "gpt-5.5"]);
  assert.deepEqual(specs.map(s => s.modelId), ["claude-opus-4-8", "gpt-5.5"]);
});
