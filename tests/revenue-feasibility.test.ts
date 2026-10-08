import assert from "node:assert/strict";
import test from "node:test";
import {
  REFERENCE_RULES_VERSION,
  SMART_LEADS_CORPUS,
  SMART_LEADS_CORPUS_VERSION,
  SYNTHETIC_COMPANY,
  evaluateTriagePredictions,
  getTriageFixtureView,
  makeExamplePrediction,
  runReferenceRulesBaseline,
} from "../shared/revenue-feasibility";

const predictionRows = (labelsFor: (id: string) => string[]) =>
  SMART_LEADS_CORPUS.map(({ id }) => ({ id, labels: labelsFor(id) }));

test("fixed synthetic fixture is versioned, bounded, and contains no contact identities", () => {
  assert.match(SMART_LEADS_CORPUS_VERSION, /^smart-leads-synthetic-v\d+$/);
  assert.ok(SMART_LEADS_CORPUS.length >= 20 && SMART_LEADS_CORPUS.length <= 30);
  assert.match(SYNTHETIC_COMPANY.name, /synthetic/i);
  assert.equal(SYNTHETIC_COMPANY.website, null);
  assert.equal(SYNTHETIC_COMPANY.email, null);
  assert.equal(SYNTHETIC_COMPANY.phone, null);
  assert.ok(SMART_LEADS_CORPUS.every((item) => item.message && !/@|https?:\/\/|\b\d{3}[-.) ]\d{3}\b/.test(item.message)));
  assert.ok(SMART_LEADS_CORPUS.some((item) => item.expectedLabels.includes("quote") && item.expectedLabels.includes("booking")));
});

test("reference RULES baseline is deterministic and distinguishes CO Company from a CO hazard", () => {
  const first = runReferenceRulesBaseline();
  assert.deepEqual(runReferenceRulesBaseline(), first);
  assert.match(REFERENCE_RULES_VERSION, /RULES/i);
  assert.ok(first.some((row) =>
    !row.labels.every((label) => SMART_LEADS_CORPUS.find((item) => item.id === row.id)!.expectedLabels.includes(label)) ||
    !SMART_LEADS_CORPUS.find((item) => item.id === row.id)!.expectedLabels.every((label) => row.labels.includes(label)),
  ), "the rules baseline must not simply copy the fixture's expected labels");
  const authoredExample = makeExamplePrediction();
  const authoredTruth = SMART_LEADS_CORPUS.find((item) => item.id === authoredExample.id)!;
  assert.notDeepEqual(authoredExample.labels, authoredTruth.expectedLabels, "the authored example is not a leaked answer key");
  const companyMention = SMART_LEADS_CORPUS.find((item) => /\bCO Company\b/i.test(item.message));
  assert.ok(companyMention);
  assert.ok(!first.find((row) => row.id === companyMention.id)?.labels.includes("escalate"));
});

test("multi-label metrics have explicit per-label counts and null zero-denominator metrics", () => {
  const result = evaluateTriagePredictions(predictionRows((id) =>
    SMART_LEADS_CORPUS.find((item) => item.id === id)!.expectedLabels,
  ));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.coverage.predicted, SMART_LEADS_CORPUS.length);
  assert.equal(result.coverage.total, SMART_LEADS_CORPUS.length);
  assert.equal(result.metrics.quote.precision, 1);
  assert.equal(result.metrics.quote.recall, 1);
  assert.equal(result.metrics.escalate.precision, 1);
  assert.equal(result.metrics.escalate.recall, 1);
  assert.equal(result.metrics.spam.precision, 1);
  assert.equal(result.metrics.spam.recall, 1);
  assert.equal(result.metrics.no_action.precision, 1);
  assert.equal(result.metrics.no_action.recall, 1);
  assert.equal(result.safetyHardFail, false);
  assert.ok(result.dispatchReviewCounts.expected >= 1);
});

test("incomplete predictions fail full immutable-corpus coverage with missing IDs", () => {
  const result = evaluateTriagePredictions([]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errorDetails.some((detail) => detail.code === "missing_id"));
  assert.equal(result.coverage.total, SMART_LEADS_CORPUS.length);
});

test("an emergency escalation miss hard-fails despite otherwise perfect agreement", () => {
  const rows = predictionRows((id) => SMART_LEADS_CORPUS.find((item) => item.id === id)!.expectedLabels);
  const emergency = SMART_LEADS_CORPUS.find((item) => item.emergency);
  assert.ok(emergency);
  const row = rows.find((item) => item.id === emergency.id)!;
  row.labels = row.labels.filter((label) => label !== "escalate");
  const result = evaluateTriagePredictions(rows);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.safetyHardFail, true);
  assert.ok(result.failedIds.includes(emergency.id));
  assert.ok(result.emergencyMisses.some((miss) => miss.id === emergency.id));
});

test("missing, duplicate, unknown IDs, invalid labels, and malformed rows fail explicitly", () => {
  const valid = predictionRows(() => []);
  const cases = [
    valid.slice(1),
    [...valid, valid[0]],
    [...valid, { id: "unknown-fixture", labels: [] }],
    valid.map((row, index) => index === 0 ? { ...row, labels: ["invented"] } : row),
    [...valid, null],
  ];
  for (const input of cases) {
    const result = evaluateTriagePredictions(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errorDetails.length > 0);
  }
});

test("fixture carries source and QA boundaries; no result claims demand, paid fulfillment, or real performance", () => {
  assert.ok(SYNTHETIC_COMPANY.facts.length > 0);
  assert.ok(SYNTHETIC_COMPANY.hypotheses.length > 0);
  assert.equal(SYNTHETIC_COMPANY.profile.trade, "Residential and light-commercial HVAC");
  assert.match(SYNTHETIC_COMPANY.profile.staffing, /fictional/i);
  assert.ok(SYNTHETIC_COMPANY.fitRubric.length >= 3);
  assert.ok(SYNTHETIC_COMPANY.disqualifiers.length > 0);
  assert.ok(SYNTHETIC_COMPANY.reviewQuestions.length > 0);
  assert.match(SYNTHETIC_COMPANY.qaChecklist.join(" "), /unvalidated draft rubric.*awaiting dispatcher review/i);
  assert.match(SYNTHETIC_COMPANY.fitScoreNote, /illustrative.*not verified/i);
  assert.match(SYNTHETIC_COMPANY.qaChecklist.join(" "), /freshness: unknown/i);
  assert.match(SYNTHETIC_COMPANY.qaChecklist.join(" "), /no live research/i);
  const result = evaluateTriagePredictions(runReferenceRulesBaseline());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.disclaimer, /synthetic only/i);
    assert.match(result.disclaimer, /no proof.*demand/i);
    assert.match(result.disclaimer, /paid.fulfillment/i);
    assert.match(result.reviewBurdenInstruction, /timings were not measured/i);
  }
});

test("fixture provenance is synthetic and unvalidated draft labels are blinded until evaluation succeeds", () => {
  assert.ok(SMART_LEADS_CORPUS.every((item) => item.authoring === "Fixed synthetic test fixture"));
  const emergency = SMART_LEADS_CORPUS.find((item) => item.emergency);
  assert.ok(emergency);
  assert.equal(emergency.authoring, "Fixed synthetic test fixture");
  assert.equal(emergency.emergency?.authoring, "Fixed synthetic hazard scenario");
  assert.match(SYNTHETIC_COMPANY.qaChecklist.join(" "), /unvalidated draft rubric.*awaiting dispatcher review/i);

  const beforeEvaluation = getTriageFixtureView(emergency.id, false);
  assert.deepEqual(Object.keys(beforeEvaluation).sort(), ["authoring", "id", "message"]);
  assert.equal("emergency" in beforeEvaluation, false);
  assert.equal("expectedLabels" in beforeEvaluation, false);
  const afterEvaluation = getTriageFixtureView(emergency.id, true);
  assert.equal(afterEvaluation.emergency?.kind, emergency.emergency?.kind);
  assert.deepEqual(afterEvaluation.expectedLabels, emergency.expectedLabels);
});

test("no-action is a distinct exclusive gold label and never accompanies operational labels", () => {
  assert.ok(SMART_LEADS_CORPUS.every((item) =>
    !item.expectedLabels.includes("no_action") || item.expectedLabels.length === 1,
  ));
  const acknowledgments = SMART_LEADS_CORPUS.filter((item) => ["SL-020", "SL-024"].includes(item.id));
  assert.ok(acknowledgments.every((item) => item.expectedLabels.length === 1 && item.expectedLabels[0] === "no_action"));
  const baseline = runReferenceRulesBaseline();
  for (const item of acknowledgments) {
    const prediction = baseline.find((row) => row.id === item.id)!;
    assert.deepEqual(prediction.labels, ["no_action"]);
  }
  const rows = predictionRows((id) => SMART_LEADS_CORPUS.find((item) => item.id === id)!.expectedLabels);
  const evaluation = evaluateTriagePredictions(rows);
  assert.equal(evaluation.ok, true);
  if (evaluation.ok) assert.equal(evaluation.metrics.no_action.TP, acknowledgments.length);

  const invalid = rows.map((row) => row.id === "SL-001" ? { ...row, labels: ["no_action", "quote"] } : row);
  const rejected = evaluateTriagePredictions(invalid);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.errorDetails.some((detail) => detail.code === "invalid_label" && detail.id === "SL-001"));
});