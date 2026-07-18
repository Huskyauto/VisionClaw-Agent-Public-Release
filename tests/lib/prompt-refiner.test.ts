import { test } from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeRefinementInquiry,
  parseForceRefine,
  isRefinerEnabled,
  setLastRefinement,
  getLastRefinement,
  shouldAdoptRefinement,
  refinerMinConcordance,
  type RefineResult,
} from "../../server/lib/prompt-refiner.ts";

test("looksLikeRefinementInquiry matches clean retrieval questions", () => {
  const positives = [
    "show refined prompt",
    "show me the refined prompt",
    "can I see the refined prompt?",
    "what was the refined prompt?",
    "what prompt did you run?",
    "what prompt did you send?",
    "what prompt did you use?",
    "how did you rewrite my prompt?",
    "how did you refine it?",
    // Noun qualifiers (research/plan/design) are NOT appended tasks.
    "show me the refined prompt for my research notes",
    "what prompt did you run for research?",
    "show the refined prompt for the project plan",
    "what prompt did you use for design review?",
  ];
  for (const p of positives) {
    assert.equal(looksLikeRefinementInquiry(p), true, `should match: ${p}`);
  }
});

test("looksLikeRefinementInquiry vetoes mixed-intent messages", () => {
  const negatives = [
    "show the refined prompt and then build a dashboard",
    "show refined prompt then implement the API",
    "reveal the refined prompt and also run the tests",
    "build me a dashboard, what prompt did you use?",
    "what prompt did you use to generate this report?",
    "create a landing page and show the refined prompt",
    // Punctuation- / sentence-separated tails (no conjunction).
    "show refined prompt, run tests",
    "what prompt did you run? run tests",
    "show refined prompt; send this to the team",
    "show the refined prompt. update the README",
    "what's the refined prompt, then build X?",
    // Soft-filler-led imperative tails (no punctuation/conjunction separator).
    "show me the refined prompt please run tests",
    "show refined prompt now build the dashboard",
    "show me the refined prompt go ahead and deploy it",
    // Modal/auxiliary scaffolding before the imperative verb.
    "show me the refined prompt then you can run tests",
    "show me the refined prompt and you can run tests",
    "show me the refined prompt then go run tests",
    "show me the refined prompt, and you can run tests",
  ];
  for (const n of negatives) {
    assert.equal(looksLikeRefinementInquiry(n), false, `should veto: ${n}`);
  }
});

test("looksLikeRefinementInquiry rejects non-inquiries and long text", () => {
  assert.equal(looksLikeRefinementInquiry(""), false);
  assert.equal(looksLikeRefinementInquiry("just a normal question about weather"), false);
  // Over the 200-char bound, even if it mentions the phrase.
  assert.equal(looksLikeRefinementInquiry("show refined prompt " + "x".repeat(300)), false);
});

test("parseForceRefine detects refine: and /refine prefixes and strips them", () => {
  const a = parseForceRefine("refine: build me a CRM");
  assert.equal(a.forced, true);
  assert.equal(a.stripped, "build me a CRM");

  const b = parseForceRefine("/refine make a plan");
  assert.equal(b.forced, true);
  assert.equal(b.stripped, "make a plan");

  const c = parseForceRefine("just a normal prompt");
  assert.equal(c.forced, false);
  assert.equal(c.stripped, "just a normal prompt");
});

test("isRefinerEnabled honors the PROMPT_REFINER_DISABLED kill switch", () => {
  const prev = process.env.PROMPT_REFINER_DISABLED;
  try {
    delete process.env.PROMPT_REFINER_DISABLED;
    assert.equal(isRefinerEnabled(), true);
    process.env.PROMPT_REFINER_DISABLED = "true";
    assert.equal(isRefinerEnabled(), false);
    process.env.PROMPT_REFINER_DISABLED = "1";
    assert.equal(isRefinerEnabled(), false);
    process.env.PROMPT_REFINER_DISABLED = "no";
    assert.equal(isRefinerEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.PROMPT_REFINER_DISABLED;
    else process.env.PROMPT_REFINER_DISABLED = prev;
  }
});

test("last-refinement LRU stores and retrieves per tenant:conversation", () => {
  const r: RefineResult = {
    refined: true,
    refinedPrompt: "an optimized prompt",
    originalPrompt: "raw prompt",
    strategy: "do X then Y",
    reason: "ok",
    modelsUsed: ["m1", "m2"],
    concordance: 0.8,
    latencyMs: 1234,
  };
  setLastRefinement(42, 7, r);
  const got = getLastRefinement(42, 7);
  assert.equal(got?.refinedPrompt, "an optimized prompt");
  // Different key is isolated.
  assert.equal(getLastRefinement(42, 8), null);
  assert.equal(getLastRefinement(99, 7), null);
});

test("shouldAdoptRefinement: low κ keeps original, high κ adopts, fail-open edges", () => {
  const floor = 0.5;
  // Below the floor → keep original (do NOT adopt).
  assert.equal(shouldAdoptRefinement(0.31, floor), false);
  assert.equal(shouldAdoptRefinement(0.0, floor), false);
  // At / above the floor → adopt.
  assert.equal(shouldAdoptRefinement(0.5, floor), true);
  assert.equal(shouldAdoptRefinement(0.88, floor), true);
  // Single-proposer / unavailable κ (null) → fail-open, adopt.
  assert.equal(shouldAdoptRefinement(null, floor), true);
  // Disabled gate (floor <= 0, the FORCE path) → always adopt, even at low κ.
  assert.equal(shouldAdoptRefinement(0.05, 0), true);
  assert.equal(shouldAdoptRefinement(null, 0), true);
  assert.equal(shouldAdoptRefinement(0.05, -1), true);
});

test("refinerMinConcordance: env override with clamp + safe fallback to 0.5", () => {
  const prev = process.env.PROMPT_REFINER_MIN_CONCORDANCE;
  try {
    delete process.env.PROMPT_REFINER_MIN_CONCORDANCE;
    assert.equal(refinerMinConcordance(), 0.5); // default
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "0.7";
    assert.equal(refinerMinConcordance(), 0.7);
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "0";
    assert.equal(refinerMinConcordance(), 0); // valid: disables the gate
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "  "; // blank → default
    assert.equal(refinerMinConcordance(), 0.5);
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "abc"; // NaN → default
    assert.equal(refinerMinConcordance(), 0.5);
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "1.5"; // out of range → default
    assert.equal(refinerMinConcordance(), 0.5);
    process.env.PROMPT_REFINER_MIN_CONCORDANCE = "-0.2"; // out of range → default
    assert.equal(refinerMinConcordance(), 0.5);
  } finally {
    if (prev === undefined) delete process.env.PROMPT_REFINER_MIN_CONCORDANCE;
    else process.env.PROMPT_REFINER_MIN_CONCORDANCE = prev;
  }
});
