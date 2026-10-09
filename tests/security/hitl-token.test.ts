import { test } from "node:test";
import assert from "node:assert/strict";

process.env.HITL_TOKEN_SECRET = "test-secret-do-not-use-in-prod-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const { signHitlToken, verifyHitlToken, buildHitlLinks } = await import("../../server/hitl-tokens.ts");

test("signHitlToken + verifyHitlToken roundtrip", () => {
  const payload = { cid: "confirm_abc", decision: "approve" as const, tid: 1, exp: Date.now() + 60_000 };
  const tok = signHitlToken(payload);
  const out = verifyHitlToken(tok);
  assert.deepEqual(out, payload);
});

test("verifyHitlToken rejects tampered payload", () => {
  const payload = { cid: "confirm_abc", decision: "approve" as const, tid: 1, exp: Date.now() + 60_000 };
  const tok = signHitlToken(payload);
  const [b64, sig] = tok.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...payload, decision: "deny" }), "utf8").toString("base64url") + "." + sig;
  assert.equal(verifyHitlToken(tampered), null, "swapping decision but keeping signature must fail");
});

test("verifyHitlToken rejects tampered signature", () => {
  const payload = { cid: "confirm_abc", decision: "approve" as const, tid: 1, exp: Date.now() + 60_000 };
  const tok = signHitlToken(payload);
  const [b64] = tok.split(".");
  assert.equal(verifyHitlToken(b64 + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), null);
});

test("verifyHitlToken rejects expired tokens", () => {
  const tok = signHitlToken({ cid: "x", decision: "approve", tid: 1, exp: Date.now() - 1000 });
  assert.equal(verifyHitlToken(tok), null);
});

test("verifyHitlToken rejects malformed input", () => {
  assert.equal(verifyHitlToken(""), null);
  assert.equal(verifyHitlToken("not.a.valid.token"), null);
  assert.equal(verifyHitlToken("nopart"), null);
  assert.equal(verifyHitlToken(null as any), null);
  assert.equal(verifyHitlToken(undefined as any), null);
  assert.equal(verifyHitlToken(123 as any), null);
});

test("verifyHitlToken rejects bad decision values", () => {
  // Forge a payload with an invalid decision and sign it correctly — must still be rejected
  const evil = { cid: "x", decision: "yolo" as any, tid: 1, exp: Date.now() + 60_000 };
  const tok = signHitlToken(evil);
  // signHitlToken doesn't validate decision (it's a serializer), but verify must
  assert.equal(verifyHitlToken(tok), null);
});

test("buildHitlLinks produces approve+deny URLs that verify", () => {
  const { approveUrl, denyUrl } = buildHitlLinks("confirm_xyz", 1);
  const approveTok = decodeURIComponent(new URL(approveUrl).searchParams.get("token") || "");
  const denyTok = decodeURIComponent(new URL(denyUrl).searchParams.get("token") || "");
  const aPayload = verifyHitlToken(approveTok);
  const dPayload = verifyHitlToken(denyTok);
  assert.ok(aPayload && aPayload.decision === "approve");
  assert.ok(dPayload && dPayload.decision === "deny");
  assert.equal(aPayload!.cid, "confirm_xyz");
  assert.equal(aPayload!.tid, 1);
});
