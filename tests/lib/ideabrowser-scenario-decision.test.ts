import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scenarioDecision, scenarioValidationSummary } from "../../server/lib/ideabrowser-scenario-decision";

const scenario = { revenue12moUsd: 18_000, buildCostUsd: 800, buildHours: 32,
  monthlyRunCostUsd: 150, successProbabilityPct: 22, verdict: "Skip — unvalidated" };
test("a negative-profit ranking winner with NO-GO never produces launch actions", () => {
  const result = scenarioDecision(scenario, { adjustedSuccessProbabilityPct: 8, goNoGo: "NO-GO — no buyer evidence" });
  assert.equal(result.showLaunchPlan, false);
  assert.equal(result.status, "no-go");
  assert.equal(result.analystExpectedProfitUsd, -240);
  assert.equal(result.adjustedExpectedProfitUsd, -2760);
  assert.doesNotMatch(result.label, /winner/i);
});

test("positive economics need explicit independent GO and still grant no execution authority", () => {
  const positive = { ...scenario, revenue12moUsd: 100_000, successProbabilityPct: 50, verdict: "Build one pilot" };
  const yes = scenarioDecision(positive, { adjustedSuccessProbabilityPct: 30, goNoGo: "GO for discovery" });
  assert.equal(yes.showLaunchPlan, true);
  assert.equal(yes.status, "review-only");
  assert.match(yes.notice, /require owner approval/);
  for (const validation of [null, { adjustedSuccessProbabilityPct: 30, goNoGo: "Maybe" },
    { adjustedSuccessProbabilityPct: NaN, goNoGo: "GO" },
    { adjustedSuccessProbabilityPct: 101, goNoGo: "GO" },
    { adjustedSuccessProbabilityPct: 30, goNoGo: "NO–GO" }]) {
    assert.equal(scenarioDecision(positive, validation).showLaunchPlan, false);
  }
  assert.equal(scenarioDecision({ ...positive, buildCostUsd: Number.POSITIVE_INFINITY },
    { adjustedSuccessProbabilityPct: 30, goNoGo: "GO" }).showLaunchPlan, false);
  assert.equal(scenarioDecision({ ...positive, verdict: "Skip this" },
    { adjustedSuccessProbabilityPct: 30, goNoGo: "GO" }).showLaunchPlan, false);
});

test("weekly and master reports use the same projection for Markdown, email and winner metadata", () => {
  for (const file of ["scripts/ideabrowser-weekly-scenario.ts", "scripts/ideabrowser-master-scenario.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /md \+= scenarioValidationSummary\(winner, validation\)/);
    assert.match(source, /scenarioValidationSummary\(winner, validation, false\)/);
    assert.match(source, /'winner', \$\{decision.showLaunchPlan\}::boolean/);
    assert.doesNotMatch(source, /validation\.(?:cheapestMoneyPlan|week1Actions)\./);
    assert.doesNotMatch(source, /emailSubject:.*winner:/);
  }
});

test("NO-GO output retains the explanation but omits contradictory launch instructions and zero-cost claims", () => {
  const validation = { adjustedSuccessProbabilityPct: 8, goNoGo: "NO-GO — no buyer evidence",
    whatItIs: "An expense review.", numbersVerdict: "No demand established.",
    cheapestMoneyPlan: ["Send 500 cold emails"], week1Actions: ["Promise $12k in savings"],
    totalOutOfPocketUsd: 0 };
  for (const markdown of [true, false]) {
    const text = scenarioValidationSummary(scenario, validation, markdown);
    assert.match(text, /NO-GO|no-go/);
    assert.match(text, /No demand established/);
    assert.match(text, /withheld/i);
    assert.doesNotMatch(text, /500 cold emails|12k|\$0/);
  }
});
