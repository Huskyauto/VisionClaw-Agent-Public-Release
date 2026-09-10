/**
 * tests/unit/claude-model-mapping.test.ts — Claude Runner bridge model-id mapping
 *
 * Guards mapModelId() in server/claude-runner.ts. The Claude Code CLI 404s on certain
 * dated-suffix model ids ("model may not exist"); the original table remapped the
 * platform's WORKING bare ids onto those 404 ids, so every Claude bridge call failed
 * once the CLI was actually installed. These assertions pin the verified-good behavior:
 *   - known-bad dated ids are remapped onto a working equivalent (never returned as-is)
 *   - the platform's bare Claude version ids pass through unchanged
 * Pure function — no DB / pg pool (node:test DB-pool-hang lesson).
 *
 * Run: node --import tsx --test tests/unit/claude-model-mapping.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mapModelId } from "../../server/claude-runner";

// CLI-verified-404 ids (v2.1.169) must NEVER be the output of mapModelId.
const FORBIDDEN_404_IDS = new Set([
  "claude-sonnet-4-20250514",
  "claude-opus-4-5-20250115",
  "claude-haiku-4-5-20250115",
]);

test("known-bad dated ids are remapped onto a working equivalent", () => {
  assert.equal(mapModelId("claude-sonnet-4-20250514"), "claude-sonnet-4-5");
  assert.equal(mapModelId("claude-opus-4-5-20250115"), "claude-opus-4-5");
  assert.equal(mapModelId("claude-haiku-4-5-20250115"), "claude-haiku-4-5");
  assert.equal(mapModelId("claude-sonnet-4"), "claude-sonnet-4-5");
});

test("platform bare Claude version ids pass through unchanged", () => {
  for (const id of [
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-opus-4-20250514",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
  ]) {
    assert.equal(mapModelId(id), id, `${id} should pass through`);
  }
});

test("no mapping output is a CLI-404 model id", () => {
  const inputs = [
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-opus-4-5-20250115",
    "claude-opus-4-20250514",
    "claude-sonnet-4",
    "claude-sonnet-4-6",
    "claude-sonnet-4-5",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5",
    "claude-haiku-4-5-20250115",
  ];
  for (const id of inputs) {
    assert.equal(
      FORBIDDEN_404_IDS.has(mapModelId(id)),
      false,
      `${id} mapped to a CLI-404 id`,
    );
  }
});

test("unknown ids pass through (family aliases / future ids untouched)", () => {
  for (const id of ["opus", "sonnet", "haiku", "claude-future-9-9"]) {
    assert.equal(mapModelId(id), id);
  }
});
