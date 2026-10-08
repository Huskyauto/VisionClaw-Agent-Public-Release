import assert from "node:assert/strict";
import test from "node:test";
import { getScraplingStatus, scraplingScrape } from "../server/scrapling-client";
import { reportDomainCooldown, collectFromMultipleSources } from "../server/multi-source-collector";

test("scrapling client fails closed on unsafe URL before service configuration", async () => {
  const result = await scraplingScrape("https://127.0.0.1/private");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /URL rejected/i);
});

test("scrapling client reports disabled configuration explicitly", async () => {
  if (getScraplingStatus().configured) return;
  const result = await scraplingScrape("https://example.com");
  assert.equal(result.ok, false);
  assert.match(result.error || "", /disabled or not configured/i);
});

test("multi-source collection honors an existing shared domain cooldown", async () => {
  await reportDomainCooldown(1, "https://example.com/a", 30_000);
  const result = await collectFromMultipleSources("https://example.com/b", 1);
  assert.equal(result.success, false);
  assert.equal(result.domainCooldown, true);
  assert.ok(Number(result.retryAfterMs) > 0);
  const replay = await collectFromMultipleSources("https://example.com/b", 1);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.domainCooldown, true);
});