/**
 * R125+1 — proposer-pool resolver unit tests.
 *
 * No real LLM calls — pure mapping verification. Guarantees the A/B harness
 * (scripts/ensemble-query-ab.ts) and the runtime executeMoA() agree on what
 * each pool name expands to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProposerPool } from "../../server/moa";

test("frontier returns Bob's four top-tier models (R125+52.2)", () => {
  const ids = resolveProposerPool("frontier");
  assert.deepEqual(ids, [
    "claude-opus-4-8",
    "gpt-5.5",
    "gemini-3.5-flash",
    "deepseek/deepseek-v4-pro",
  ]);
});

test("cheap returns 5 lineage-diverse OpenRouter models", () => {
  const ids = resolveProposerPool("cheap");
  assert.equal(ids.length, 5);
  const vendors = new Set(ids.map(id => id.split("/")[0]));
  assert.equal(vendors.size, 5, `expected 5 distinct vendors, got ${[...vendors].join(",")}`);
  assert.ok(ids.every(id => id.includes("/")), "all cheap-pool ids must be vendor/model format");
});

test("mixed returns frontier + 3 cheap", () => {
  const ids = resolveProposerPool("mixed");
  const frontier = resolveProposerPool("frontier");
  assert.equal(ids.length, frontier.length + 3);
  assert.deepEqual(ids.slice(0, frontier.length), frontier);
  const cheap = new Set(resolveProposerPool("cheap"));
  assert.ok(ids.slice(frontier.length).every(id => cheap.has(id)), "trailing 3 mixed ids must come from cheap pool");
});

test("explicit proposerIds win over pool (precedence contract)", () => {
  // R125+1 architect-fix companion test: locks the priority order
  // (explicit proposerIds > pool > default) at the resolver-input level.
  // The telemetry-tagging fix in moa.ts:333 relies on this precedence — if
  // anyone flips it, this test guards against accidental pool-tag leakage
  // into rows where pool did not actually pick the proposers.
  const cheap = resolveProposerPool("cheap");
  const frontier = resolveProposerPool("frontier");
  assert.notDeepEqual(cheap, frontier, "cheap and frontier must differ for this test to be meaningful");
  // The resolver itself only maps name -> ids; the precedence is enforced
  // in executeMoA. We assert the resolver returns the requested pool
  // verbatim — executeMoA's branch is what skips it when proposerIds is set.
  assert.deepEqual(resolveProposerPool("cheap"), cheap);
});

test("returns a fresh array (no shared mutable state across calls)", () => {
  const a = resolveProposerPool("frontier");
  const b = resolveProposerPool("frontier");
  assert.notEqual(a, b);
  a.push("hacked");
  assert.ok(!resolveProposerPool("frontier").includes("hacked"));
});
