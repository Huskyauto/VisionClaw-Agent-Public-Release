import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { isValidCoinbaseWebhookEventId } from "../../server/coinbase-commerce";

const source = readFileSync("server/coinbase-commerce.ts", "utf8");

test("Coinbase webhook validates a bounded provider event UUID before claiming", () => {
  const verifiedAt = source.indexOf("if (!verified)");
  const parseAt = source.indexOf("event = JSON.parse");
  const idGuardAt = source.indexOf("if (!isValidCoinbaseWebhookEventId(eventId))");
  const claimAt = source.indexOf("const claim = await claimWebhookEvent('coinbase', eventId)");
  assert.ok(verifiedAt >= 0 && parseAt > verifiedAt, "raw signature must be verified before parsing");
  assert.ok(idGuardAt > parseAt && claimAt > idGuardAt, "event id must be validated before durable claim");
  assert.match(source, /eventId\.length === 36/);
  assert.match(source, /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]/);
  assert.equal(isValidCoinbaseWebhookEventId(undefined), false, "missing IDs must not reach the claim");
  assert.equal(isValidCoinbaseWebhookEventId("x".repeat(37)), false, "oversized IDs must not reach the claim");
  assert.equal(isValidCoinbaseWebhookEventId("not-a-provider-event-id"), false);
  assert.equal(isValidCoinbaseWebhookEventId("550e8400-e29b-41d4-a716-446655440000"), true);
});

test("Coinbase webhook candidate verification is bounded, cached, and non-short-circuiting", () => {
  assert.match(source, /const TENANT_WEBHOOK_SECRET_CACHE_TTL_MS = 60_000/);
  assert.match(source, /const MAX_TENANT_WEBHOOK_SECRET_CANDIDATES = 100/);
  assert.match(source, /LIMIT \$\{MAX_TENANT_WEBHOOK_SECRET_CANDIDATES \+ 1\}/);
  assert.match(source, /rows\.length > MAX_TENANT_WEBHOOK_SECRET_CANDIDATES/);
  assert.match(source, /tenantWebhookSecretsCache/);
  assert.match(source, /const candidateMatches = candidateSecrets\.map/);
  assert.match(source, /candidateMatches\.reduce/);
  assert.doesNotMatch(source, /tenantWebhookSecrets\.some\(/);
});

test("Coinbase webhook retains global/per-tenant candidates and claim retry semantics", () => {
  assert.match(source, /globalWebhookSecret \? \[globalWebhookSecret\] : \[\]/);
  assert.match(source, /\.\.\.tenantWebhookSecrets/);
  assert.match(source, /if \(claim === 'completed'\)/);
  assert.match(source, /if \(claim === 'retry'\)/);
  assert.match(source, /await markWebhookEventCompleted\('coinbase', eventId\)/);
});