import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareHarnessDiagnosis, prepareHarnessEvidence } from "../../server/agentic/harness-diagnostics";
import { digestFailures } from "../../server/agentic/harness-addendum-lib";

const now = Date.parse("2026-11-02T12:00:00Z");
const day = 86_400_000;
const sample = (summary: string, age: number, status = "error") => ({
  summary, status, toolName: "research", startedAt: new Date(now - age * day).toISOString(),
});

test("current repeated failures get attention before a larger stale cluster", () => {
  const train = [
    ...Array.from({ length: 8 }, () => sample("old parsing error", 10)),
    sample("missing verification", 1), sample("missing verification", 2),
  ];
  assert.match(digestFailures(train).split("\n")[0], /old parsing error/);
  const result = prepareHarnessDiagnosis(train, { nowMs: now, windowDays: 12 });
  assert.equal(result.mode, "adaptive");
  assert.equal(result.criteria[0].state, "newly-observed");
  assert.match(result.digest.split("\n")[0], /missing verification/);
  assert.equal(result.criteria[1].state, "not-observed-recently");
});

test("the real preparation boundary never lets held-out evidence guide the proposal", () => {
  const rows = Array.from({ length: 20 }, (_, i) => sample(`unique error ${i}`, i % 11));
  const prepared = prepareHarnessEvidence(rows, {
    nowMs: now, windowDays: 12, heldOutRatio: 0.4, seed: 0x5e1f,
  });
  assert.equal(prepared.train.length, 12);
  assert.equal(prepared.heldOut.length, 8);
  for (const row of prepared.heldOut) {
    assert.ok(!prepared.diagnosis.digest.includes(`research: ${row.summary}\n`));
    assert.ok(!prepared.diagnosis.criteria.some((c) => c.key === `research: ${row.summary}`));
  }
  assert.equal(rows.length, 20);
});

test("a repeated failure can return after a quiet middle window, without claiming resolution", () => {
  const rows = [sample("parse failure", 1), sample("parse failure", 2),
    sample("parse failure", 9), sample("parse failure", 10), sample("old error", 9)];
  const report = prepareHarnessDiagnosis(rows, { nowMs: now, windowDays: 12 });
  assert.equal(report.criteria[0].state, "returned");
  assert.equal(report.criteria[1].state, "not-observed-recently");
  assert.doesNotMatch(report.digest, /\b(resolved|fixed|confirmed)\b/);
});

test("a single recent occurrence stays weak evidence and declines are not diagnosed as defects", () => {
  const report = prepareHarnessDiagnosis([
    sample("rare error", 1), sample("legitimate safety refusal", 1, "declined"),
  ], { nowMs: now, windowDays: 12 });
  assert.deepEqual(report.criteria.map((c) => c.state), ["insufficient-evidence"]);
  assert.ok(!report.criteria.some((c) => c.key.includes("refusal")));
  assert.match(report.digest, /declines are not automatically defects/);
});

test("disable and incomplete timestamps use exactly the original digest", () => {
  const rows = [sample("error one", 1), sample("error two", 3)];
  assert.equal(prepareHarnessDiagnosis(rows, {
    nowMs: now, windowDays: 12, enabled: false,
  }).digest, digestFailures(rows));
  for (const startedAt of [undefined, null, "bad date", new Date(now + day).toISOString(),
    new Date(now - 15 * day).toISOString()]) {
    const partial = [...rows, { ...sample("undated", 1), startedAt }];
    const report = prepareHarnessDiagnosis(partial, { nowMs: now, windowDays: 12 });
    assert.equal(report.mode, "baseline");
    assert.equal(report.digest, digestFailures(partial));
  }
});

test("diagnosis is deterministic and bounded; refusal-only and empty sets stay baseline", () => {
  const rows = Array.from({ length: 4000 }, (_, i) => sample(`error ${i} ${"x".repeat(300)}`, 1));
  const a = prepareHarnessDiagnosis(rows, { nowMs: now, windowDays: 12 });
  assert.equal(a.criteria.length, 8);
  assert.ok(a.digest.length <= 2800);
  assert.deepEqual(a, prepareHarnessDiagnosis(rows, { nowMs: now, windowDays: 12 }));
  for (const set of [[], [sample("correct refusal", 1, "declined")]]) {
    assert.equal(prepareHarnessDiagnosis(set, { nowMs: now, windowDays: 12 }).mode, "baseline");
  }
});

test("bad time settings fall back and current/middle-window repeats are recurring", () => {
  const rows = [sample("ongoing error", 1), sample("ongoing error", 2), sample("ongoing error", 6)];
  assert.equal(prepareHarnessDiagnosis(rows, { nowMs: now, windowDays: 12 }).criteria[0].state, "recurring");
  for (const options of [
    { nowMs: NaN, windowDays: 12 }, { nowMs: now, windowDays: 0 },
    { nowMs: now, windowDays: Infinity },
  ]) {
    assert.equal(prepareHarnessDiagnosis(rows, options).digest, digestFailures(rows));
  }
});
