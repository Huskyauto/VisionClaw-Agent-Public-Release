import test from "node:test";
import assert from "node:assert/strict";
import { resolveOwnerGmailReadToken } from "../../server/lib/owner-gmail-read-token";

test("daily Gmail reads prefer the renewable managed connection over a revoked legacy grant", async () => {
  let legacyCalls = 0;
  const token = await resolveOwnerGmailReadToken({
    owner: "owner@example.test",
    managed: async () => "managed-fixture",
    profile: async () => ({ emailAddress: "owner@example.test" }),
    legacy: async () => { legacyCalls++; return null; },
  });
  assert.equal(token, "managed-fixture");
  assert.equal(legacyCalls, 0);
});

test("an unrelated connected mailbox is rejected, not silently used or replaced", async () => {
  let legacyCalls = 0;
  await assert.rejects(resolveOwnerGmailReadToken({
    owner: "owner@example.test",
    managed: async () => "other-fixture",
    profile: async () => ({ emailAddress: "other@example.test" }),
    legacy: async () => { legacyCalls++; return "legacy-fixture"; },
  }), /configured owner/);
  assert.equal(legacyCalls, 0);
});

test("a missing managed connection retains the explicitly authorized legacy fallback", async () => {
  assert.equal(await resolveOwnerGmailReadToken({
    owner: "owner@example.test",
    managed: async () => null,
    profile: async () => { throw Error("must not read profile"); },
    legacy: async () => "legacy-fixture",
  }), "legacy-fixture");
});
