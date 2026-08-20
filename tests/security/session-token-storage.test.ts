import test from "node:test";
import assert from "node:assert/strict";
import { hashSessionToken } from "../../server/auth";

test("stored session value is a keyed one-way digest, never the bearer token", () => {
  const bearer = "a".repeat(64);
  const stored = hashSessionToken(bearer);

  assert.notEqual(stored, bearer);
  assert.match(stored, /^v2:[a-f0-9]{64}$/);
  assert.equal(stored, hashSessionToken(bearer), "session lookup must derive the same digest");
});