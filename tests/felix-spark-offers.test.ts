import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FELIX_SPARK_OFFERS } from "../client/src/data/felix-spark-offers";

test("five distinct proposed offers each state a product, input, output, boundary, hold, and proof", () => {
  assert.equal(FELIX_SPARK_OFFERS.length, 5);
  assert.equal(new Set(FELIX_SPARK_OFFERS.map((offer) => offer.slug)).size, 5);
  for (const offer of FELIX_SPARK_OFFERS) {
    for (const field of ["name", "promise", "buyer", "proposedPrice", "holdReason", "nextProof"] as const) {
      assert.ok(offer[field].trim(), `${offer.slug}: missing ${field}`);
    }
    for (const field of ["buyerProvides", "customerReceives", "boundaries"] as const) {
      assert.ok(offer[field].length && offer[field].every((item) => item.trim()), `${offer.slug}: missing ${field}`);
    }
    const file = readFileSync(new URL(`../project-assets/felix-spark-income-ideas/offers/${offer.slug}.md`, import.meta.url), "utf8");
    assert.match(file, /ON HOLD/);
    assert.match(file, /Unblock only after/);
  }
});

test("one-day brief and feasibility pilot do not advertise subscriptions or running-agent service", () => {
  const oneDay = FELIX_SPARK_OFFERS.find((offer) => offer.slug === "while-you-slept");
  const pilot = FELIX_SPARK_OFFERS.find((offer) => offer.slug === "sop-to-agent");
  assert.ok(oneDay && pilot);
  assert.match(oneDay.proposedPrice, /^\$9\b/);
  assert.match(pilot.proposedPrice, /^\$149\b/);
  for (const offer of [oneDay, pilot]) {
    assert.doesNotMatch(offer.proposedPrice, /\$\d+\s*\/\s*(?:mo|month)|subscription/i);
    assert.doesNotMatch(offer.customerReceives.join(" "), /monthly|billing month|managed plan/i);
    const file = readFileSync(new URL(`../project-assets/felix-spark-income-ideas/offers/${offer.slug}.md`, import.meta.url), "utf8");
    assert.doesNotMatch(file, /\$\d+\s*\/\s*(?:mo|month)|\$\d+ (?:weekday|daily) monthly plan|proposed managed plan/i);
  }
  assert.doesNotMatch(oneDay.nextProof, /subscription|recurring/i);
  assert.doesNotMatch(pilot.promise, /have it run for you/i);
  assert.match(pilot.customerReceives.join(" "), /not a running agent/i);
  const pilotFile = readFileSync(new URL("../project-assets/felix-spark-income-ideas/offers/sop-to-agent.md", import.meta.url), "utf8");
  assert.match(pilotFile, /\*\*Status:\*\* ON HOLD\. Only the \$149 feasibility pilot is proposed/);
  assert.doesNotMatch(pilotFile, /managed agent (?:is|are) proposed|then decide whether to have it run/i);
});

test("admin-only opportunity navigation cannot be mistaken for a live product or checkout", () => {
  const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../client/src/components/app-sidebar.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../client/src/pages/admin-felix-spark-offers.tsx", import.meta.url), "utf8");
  assert.match(app, /\{isPlatformAdmin && <Route path="\/admin\/felix-spark-offers"/);
  assert.match(sidebar, /title="Income Opportunities"[\s\S]*?\{isPlatformAdmin && <NavLink path="\/admin\/felix-spark-offers"[\s\S]*?badge="ON HOLD"/);
  assert.match(page, /On hold · No checkout/);
  assert.doesNotMatch(page, /apiRequest|\/api\/checkout|Buy now/);
});