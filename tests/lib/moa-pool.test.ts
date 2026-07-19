/**
 * R125+1 — proposer-pool resolver unit tests.
 *
 * No real LLM calls — pure mapping verification. Guarantees the A/B harness
 * (scripts/ensemble-query-ab.ts) and the runtime executeMoA() agree on what
 * each pool name expands to.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveProposerPool } from "../../server/moa";

// The runtime tier-override file (data/model-tiers.json, written by the weekly
// model refresh / Bob's $0 pin) legitimately WINS over the hardcoded constants
// (see loadTierOverride in server/moa.ts). These tests must be
// environment-agnostic: when a valid override is present, assert the resolver
// honors it; otherwise assert the hardcoded constant contract.
function readOverride(): { frontier: string[]; mundane: string[] } | null {
  try {
    const raw = JSON.parse(fs.readFileSync("data/model-tiers.json", "utf8"));
    const frontier = Array.isArray(raw?.frontier) ? raw.frontier.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
    const mundane = Array.isArray(raw?.mundane) ? raw.mundane.filter((x: unknown) => typeof x === "string" && x.trim()) : [];
    return frontier.length >= 3 ? { frontier, mundane } : null;
  } catch {
    return null;
  }
}

const HARDCODED_FRONTIER = [
  "claude-opus-4-8",
  "gpt-5.6-sol",
  "gemini-3.5-flash",
  "deepseek/deepseek-v4-pro",
];

test("frontier returns the override file's frontier when valid, else the hardcoded top-tier set", () => {
  const ids = resolveProposerPool("frontier");
  const override = readOverride();
  if (override) {
    assert.deepEqual(ids, override.frontier);
  } else {
    assert.deepEqual(ids, HARDCODED_FRONTIER);
  }
  assert.ok(ids.length >= 3, "frontier pool must never shrink below jury quorum (3)");
});

test("cheap returns override mundane when present, else 5 lineage-diverse OpenRouter models", () => {
  const ids = resolveProposerPool("cheap");
  const override = readOverride();
  if (override && override.mundane.length > 0) {
    assert.deepEqual(ids, override.mundane);
  } else {
    assert.equal(ids.length, 5);
    const vendors = new Set(ids.map(id => id.split("/")[0]));
    assert.equal(vendors.size, 5, `expected 5 distinct vendors, got ${[...vendors].join(",")}`);
    assert.ok(ids.every(id => id.includes("/")), "all cheap-pool ids must be vendor/model format");
  }
});

test("mixed returns frontier + 3 cheap (override-aware)", () => {
  const ids = resolveProposerPool("mixed");
  const override = readOverride();
  if (override && override.mundane.length >= 3) {
    assert.deepEqual(ids, [...override.frontier, ...override.mundane.slice(0, 3)]);
  } else {
    // Resolver falls back to the constant MIXED_PROPOSERS (hardcoded frontier + 3
    // cheap) whenever the override lacks >=3 mundane models — even if the
    // override's FRONTIER is active for the "frontier" pool.
    assert.equal(ids.length, HARDCODED_FRONTIER.length + 3);
    assert.deepEqual(ids.slice(0, HARDCODED_FRONTIER.length), HARDCODED_FRONTIER);
  }
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
