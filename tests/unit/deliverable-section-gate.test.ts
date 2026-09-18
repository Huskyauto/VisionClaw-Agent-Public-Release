import test from "node:test";
import assert from "node:assert/strict";
import {
  isFailedSectionBody,
  findFailedSectionIndices,
  describeFailedSections,
} from "../../server/lib/deliverable-section-gate";

test("real content passes", () => {
  assert.equal(isFailedSectionBody("Herchenbach Mechanical is well positioned..."), false);
});

test("error placeholder is a failed section", () => {
  assert.equal(isFailedSectionBody("(This section could not be generated automatically. Error: 400 Unsupported parameter: 'max_tokens'...)"), true);
});

test("no-content placeholder is a failed section", () => {
  assert.equal(isFailedSectionBody("(No content generated for this section. The agent may need to retry.)"), true);
});

test("empty / undefined / whitespace are failed sections", () => {
  assert.equal(isFailedSectionBody(""), true);
  assert.equal(isFailedSectionBody(undefined), true);
  assert.equal(isFailedSectionBody(null), true);
  assert.equal(isFailedSectionBody("   \n"), true);
});

test("leading whitespace before placeholder still detected", () => {
  assert.equal(isFailedSectionBody("  (This section could not be generated automatically.)"), true);
});

test("content that merely CONTAINS a parenthetical is fine", () => {
  assert.equal(isFailedSectionBody("Good content (with an aside) continues here."), false);
});

test("findFailedSectionIndices returns ordered indices", () => {
  const bodies = ["ok content here", "(No content generated for this section.)", "more ok", "", "(This section could not be generated automatically.)"];
  assert.deepEqual(findFailedSectionIndices(bodies), [1, 3, 4]);
});

test("findFailedSectionIndices empty on all-good", () => {
  assert.deepEqual(findFailedSectionIndices(["a real body", "another"]), []);
});

test("describeFailedSections summarizes with headings and caps at 5", () => {
  const headings = ["A", "B", "C", "D", "E", "F", "G"];
  const s = describeFailedSections(headings, [0, 1, 2, 3, 4, 5], 7);
  assert.ok(s.startsWith('6/7 sections failed generation: "A", "B", "C", "D", "E"'));
  assert.ok(s.includes("+1 more"));
});

test("describeFailedSections tolerates missing heading", () => {
  const s = describeFailedSections(["A"], [3], 5);
  assert.ok(s.includes('"#4"'));
});

test("builder round-trip: emitted placeholders are always detected by the gate", async () => {
  const { buildErrorPlaceholder, buildNoContentPlaceholder } = await import("../../server/lib/deliverable-section-gate");
  assert.equal(isFailedSectionBody(buildErrorPlaceholder("400 Unsupported parameter", "audit")), true);
  assert.equal(isFailedSectionBody(buildErrorPlaceholder(undefined, "report")), true);
  assert.equal(isFailedSectionBody(buildNoContentPlaceholder()), true);
  assert.equal(isFailedSectionBody(buildNoContentPlaceholder("Topic: X")), true);
});
