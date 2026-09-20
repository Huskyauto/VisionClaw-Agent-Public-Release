import assert from "node:assert/strict";
import test from "node:test";
import { embeddingCacheKey } from "../../server/embeddings";

test("embedding cache keys cover the complete normalized model input", () => {
  const sharedPrefix = "x".repeat(250);
  assert.notEqual(
    embeddingCacheKey(`${sharedPrefix} trusted-runbook-a`),
    embeddingCacheKey(`${sharedPrefix} trusted-runbook-b`),
  );
});

test("embedding cache keys normalize only the same way as model input", () => {
  assert.equal(
    embeddingCacheKey("  trusted\n\nrunbook  "),
    embeddingCacheKey("trusted runbook"),
  );
});