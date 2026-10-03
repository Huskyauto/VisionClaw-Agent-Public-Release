import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const landing = () => readFileSync("client/src/pages/landing.tsx", "utf8");
const pricing = () => readFileSync("client/src/pages/pricing.tsx", "utf8");

test("current homepage copy does not tell visitors the live storefront is closed", () => {
  assert.equal(/the storefront is not live/i.test(landing()), false);
  assert.equal(/the store is open/i.test(landing()), true);
});

test("public pricing does not offer credit packs that the store cannot fulfill", () => {
  assert.equal(/Buy Credit Pack|Credit packs from \$10/i.test(pricing()), false, "pricing page cannot send a credit buyer to unrelated products");
  assert.equal(/Credit Packs — Volume Discounts|Buy Credits|Credits never expire/i.test(landing()), false, "homepage cannot advertise an unsold credit product");
  assert.equal(/credit packs are not available for purchase yet/i.test(pricing()), true);
  assert.equal(/credit packs are not available for purchase yet/i.test(landing()), true);
});

test("technical landing shows current buying options, not subscription plans without checkout", () => {
  assert.equal(/name: "(Starter|Pro|Enterprise)"/.test(landing()), false, "unavailable monthly plans must not appear as live cards");
  assert.equal(/subscribe monthly|up to 5x more usage on any paid plan/i.test(landing()), false);
  assert.equal(/One predictable monthly tier/i.test(landing()), false, "business copy must not promise an unavailable subscription");
  assert.equal(/Browse Store/.test(landing()), true);
});