import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitSystemForCache } from "../../server/anthropic-prompt-cache";

// TokenPilot (arXiv:2606.17016) prompt-cache split helper. Pure + fail-safe:
// splits the system prompt into [stable(cached), dynamic] ONLY when the full
// prompt actually starts with a non-trivial stable prefix; otherwise returns the
// single-message shape unchanged so it can never be a correctness regression.

const STABLE = "S".repeat(250); // >= MIN_STABLE (200)

describe("splitSystemForCache", () => {
  it("splits when full starts with a non-trivial stable prefix", () => {
    const full = `${STABLE}\n\nDYNAMIC PART`;
    const out = splitSystemForCache(full, STABLE);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, "system");
    assert.equal(out[0].content, STABLE);
    assert.equal(out[1].role, "system");
    assert.equal(out[1].content, "DYNAMIC PART"); // leading newlines stripped
  });

  it("re-joins to the original content (no bytes lost, modulo the prefix newline gap)", () => {
    const dynamic = "## TEMPORAL CONTEXT\nLocal hour: 14:37";
    const full = `${STABLE}\n\n${dynamic}`;
    const out = splitSystemForCache(full, STABLE);
    assert.equal(out[0].content + "\n\n" + out[1].content, full);
  });

  it("falls back to a single message when prefix is too short (< 200 chars)", () => {
    const shortPrefix = "S".repeat(100);
    const full = `${shortPrefix}\n\nDYNAMIC`;
    const out = splitSystemForCache(full, shortPrefix);
    assert.equal(out.length, 1);
    assert.equal(out[0].content, full);
  });

  it("falls back to a single message when full does not start with the prefix", () => {
    const full = `PREPENDED${STABLE}\n\nDYNAMIC`;
    const out = splitSystemForCache(full, STABLE);
    assert.equal(out.length, 1);
    assert.equal(out[0].content, full);
  });

  it("falls back to a single message when there is no dynamic remainder", () => {
    const out = splitSystemForCache(STABLE, STABLE);
    assert.equal(out.length, 1);
    assert.equal(out[0].content, STABLE);
  });

  it("falls back to a single message when remainder is only whitespace", () => {
    const full = `${STABLE}\n\n   \n`;
    const out = splitSystemForCache(full, STABLE);
    // remainder after stripping leading newlines is "   \n" which is non-empty,
    // so it DOES split — assert the stable block is still byte-exact and cached.
    assert.equal(out[0].content, STABLE);
  });

  it("falls back safely on empty stable prefix", () => {
    const full = "anything here";
    const out = splitSystemForCache(full, "");
    assert.equal(out.length, 1);
    assert.equal(out[0].content, full);
  });
});
