import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScenarioOutput,
  parseValidationOutput,
  type Candidate,
} from "../../server/lib/ideabrowser-scenario";

const candidate: Candidate = {
  id: 7,
  name: "Example",
  description: "Example idea",
  tier: "S",
  composite: 25,
};

test("scenario parser rejects missing required narrative fields", () => {
  const raw = JSON.stringify({
    revenue12moUsd: 10000,
    buildCostUsd: 500,
    buildHours: 10,
    monthlyRunCostUsd: 50,
    daysToFirstDollar: 14,
    successProbabilityPct: 40,
    visionclawLeverage: "",
    goToMarket: "Direct outreach",
    topRisk: "No urgency",
    verdict: "Build",
  });

  assert.throws(() => parseScenarioOutput(raw, candidate), /empty required field visionclawLeverage/);
});

test("validation parser rejects malformed out-of-pocket cost instead of claiming zero", () => {
  const valid = {
    whatItIs: "A paid review.",
    numbersVerdict: "Conservative.",
    adjustedSuccessProbabilityPct: 30,
    cheapestMoneyPlan: ["Sell one pilot — $0"],
    totalOutOfPocketUsd: 0,
    week1Actions: ["Contact five buyers"],
    goNoGo: "GO as a pilot",
  };

  for (const malformed of [null, "", " ", false, "0"]) {
    assert.throws(
      () => parseValidationOutput(JSON.stringify({ ...valid, totalOutOfPocketUsd: malformed })),
      /bad totalOutOfPocketUsd/,
    );
  }
  for (const malformed of [null, "", " ", false, "30"]) {
    assert.throws(
      () => parseValidationOutput(JSON.stringify({ ...valid, adjustedSuccessProbabilityPct: malformed })),
      /bad adjustedSuccessProbabilityPct/,
    );
  }
});

test("scenario parser rejects coercible non-number values", () => {
  const valid = {
    revenue12moUsd: 10000,
    buildCostUsd: 500,
    buildHours: 10,
    monthlyRunCostUsd: 50,
    daysToFirstDollar: 14,
    successProbabilityPct: 40,
    visionclawLeverage: "Felix builds the report.",
    goToMarket: "Direct outreach",
    topRisk: "No urgency",
    verdict: "Build one paid pilot",
  };

  for (const malformed of [null, "", " ", false, "0"]) {
    assert.throws(
      () => parseScenarioOutput(JSON.stringify({ ...valid, buildCostUsd: malformed }), candidate),
      /bad numeric field buildCostUsd/,
    );
  }
  for (const malformed of [null, "", " ", false, "40"]) {
    assert.throws(
      () => parseScenarioOutput(JSON.stringify({ ...valid, successProbabilityPct: malformed }), candidate),
      /bad successProbabilityPct/,
    );
  }
});

test("strict scenario parsers accept a complete response", () => {
  const scenario = parseScenarioOutput(JSON.stringify({
    revenue12moUsd: 10000,
    buildCostUsd: 500,
    buildHours: 10,
    monthlyRunCostUsd: 50,
    daysToFirstDollar: 14,
    successProbabilityPct: 40,
    visionclawLeverage: "Felix builds the report.",
    goToMarket: "Direct outreach",
    topRisk: "No urgency",
    verdict: "Build one paid pilot",
  }), candidate);

  assert.equal(scenario.projectId, candidate.id);
  assert.equal(scenario.expectedProfitUsd, 2400);
});