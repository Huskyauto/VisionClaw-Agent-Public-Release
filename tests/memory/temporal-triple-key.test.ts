import assert from "node:assert/strict";
import { test } from "node:test";
import { temporalTripleKey } from "../../server/memory/temporal-triple-key";

test("the same source fact has one key, while a later source can reassert it", () => {
  const original = temporalTripleKey(" Alice ", "works at", "Acme", 100);
  assert.equal(original, temporalTripleKey("alice", "WORKS  AT", " acme ", 100));
  assert.notEqual(original, temporalTripleKey("alice", "works at", "acme", 101));
  assert.notEqual(original, temporalTripleKey("alice", "works at", "Other", 100));
});

test("unlinked extractions have distinct version keys", () => {
  assert.notEqual(
    temporalTripleKey("Alice", "works at", "Acme", null),
    temporalTripleKey("Alice", "works at", "Acme", null),
  );
});