import { test } from "node:test";
import assert from "node:assert/strict";
import { isForbiddenCmmcFallbackDelegation } from "../../server/lib/tool-routing-context.js";

test("blocks browser delegation around the authoritative CMMC source", () => {
  assert.equal(
    isForbiddenCmmcFallbackDelegation("sam-gov-browser-attempt-il-wi-cmmc-level1"),
    true,
  );
});

test("blocks USAspending and alternate-source CMMC fallback delegation", () => {
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Find CAGE codes through a USAspending fallback"),
    true,
  );
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Scrape an alternative source for federal contractors"),
    true,
  );
});

test("blocks implicit CMMC source research without explicit fallback wording", () => {
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Continue the CMMC roster research and find the remaining contractors"),
    true,
  );
});

test("handles punctuation without treating a person's name as SAM.gov", () => {
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Verify the CAGE-code roster through an alternate-source"),
    true,
  );
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Ask Sam to browse the design examples"),
    false,
  );
});

test("does not block ordinary delegation or formatting already-verified CMMC rows", () => {
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Delegate a normal code review to Forge"),
    false,
  );
  assert.equal(
    isForbiddenCmmcFallbackDelegation("Format the already-supplied CMMC rows into Markdown"),
    false,
  );
});