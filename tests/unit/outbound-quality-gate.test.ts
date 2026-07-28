/**
 * Unit tests for the app-wide outbound quality gate (R125+138).
 * Pure scan only — reportQualityIncident does a dynamic import at call time,
 * so importing this module never touches the DB (node-test pg-pool hang rule).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCustomerFacingText } from "../../server/lib/outbound-quality-gate";
import { buildErrorPlaceholder, buildNoContentPlaceholder } from "../../server/lib/deliverable-section-gate";

test("clean customer copy passes", () => {
  const r = scanCustomerFacingText(
    "Hi Sarah,\n\nYour AI Readiness Audit is attached. We found three high-impact opportunities for Herchenbach Mechanical, starting with your website's discoverability.\n\nBest,\nFelix",
  );
  assert.equal(r.blocked, false);
  assert.deepEqual(r.reasons, []);
});

test("blocks the exact Herchenbach failure shape (Error: 400 Unsupported parameter)", () => {
  const r = scanCustomerFacingText(
    "Section 1\nError: 400 Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
  );
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => x.includes("provider/API error")));
});

test("blocks section-failure placeholders anywhere in the body", () => {
  for (const body of [
    `Intro text\n${buildErrorPlaceholder("boom", "audit")}\nMore text`,
    `Intro\n${buildNoContentPlaceholder()}`,
  ]) {
    const r = scanCustomerFacingText(body);
    assert.equal(r.blocked, true, body.slice(0, 60));
    assert.ok(r.reasons.some((x) => x.includes("section-failure placeholder")));
  }
});

test("blocks AI meta leakage and unfilled template placeholders (shared failure modes)", () => {
  assert.equal(scanCustomerFacingText("As an AI language model, I cannot browse the internet.").blocked, true);
  assert.equal(scanCustomerFacingText("Dear {{customer_name}}, thanks for your order of many things and stuff.").blocked, true);
});

test("blocks effectively-empty content", () => {
  assert.equal(scanCustomerFacingText("   \n\n  ").blocked, true);
  assert.equal(scanCustomerFacingText(null).blocked, true);
  assert.equal(scanCustomerFacingText(undefined).blocked, true);
});

test("does not block legit prose mentioning errors in a normal register", () => {
  const r = scanCustomerFacingText(
    "Our audit found that your contact form returns an error page for some visitors — fixing this is a quick win worth prioritizing this quarter.",
  );
  assert.equal(r.blocked, false, r.reasons.join("; "));
});

test("does not block a price like $400 or a year like 'Error rates fell 3 percent'", () => {
  const r = scanCustomerFacingText("The package costs $400 per month. Error rates fell 3 percent after automation.");
  assert.equal(r.blocked, false, r.reasons.join("; "));
});

test("blocks truncation markers and [object Object] leaks", () => {
  assert.equal(scanCustomerFacingText("Here is your full report body text... [output truncated]").blocked, true);
  assert.equal(scanCustomerFacingText("Thanks for your purchase of [object Object] — enjoy your new plan!").blocked, true);
});
