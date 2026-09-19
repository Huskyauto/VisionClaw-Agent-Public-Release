import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLegacyExecutablePlanStepIds,
  validateExecutablePlanStructure,
} from "../../server/lib/executable-plan-structure";

test("legacy normalization fills only missing IDs and preserves malformed IDs for rejection", () => {
  const normalized = normalizeLegacyExecutablePlanStepIds([
      { task: "legacy" },
      { n: "2", task: "malformed" },
      { n: null, task: "also malformed" },
      null,
      42,
    ]);
  assert.deepEqual(
    normalized,
    [
      { n: 1, task: "legacy" },
      { n: "2", task: "malformed" },
      { n: null, task: "also malformed" },
      null,
      42,
    ],
  );
  assert.deepEqual(
    validateExecutablePlanStructure(normalized),
    [
      'step at position 2 has invalid id "2"',
      "step at position 3 has invalid id null",
      "step at position 4 is not an object",
      "step at position 5 is not an object",
    ],
  );
});

test("valid executable DAGs preserve ordering-only dependencies", () => {
  assert.deepEqual(
    validateExecutablePlanStructure([
      { n: 1, depends_on: [] },
      { n: 2, depends_on: [1] },
      { n: 3, depends_on: [1] },
      { n: 4, depends_on: [2, 3] },
    ]),
    [],
  );
});

test("executable plans reject duplicate and invalid step identities", () => {
  assert.deepEqual(
    validateExecutablePlanStructure([
      { n: 1 },
      { n: 1 },
      { n: 2.5 },
    ]),
    [
      "duplicate step id 1",
      "step at position 3 has invalid id 2.5",
    ],
  );
});

test("executable plans reject malformed, self, and dangling dependencies", () => {
  assert.deepEqual(
    validateExecutablePlanStructure([
      { n: 1, depends_on: [] },
      { n: 2, depends_on: [2, 99, "1"] },
    ]),
    [
      "step 2 depends on itself",
      "step 2 depends on unknown step 99",
      'step 2 has invalid dependency "1"',
    ],
  );
});

test("executable plans reject a non-array dependency field", () => {
  assert.deepEqual(
    validateExecutablePlanStructure([
      { n: 1 },
      { n: 2, depends_on: "1" },
    ]),
    ['step 2 has invalid depends_on "1"'],
  );
});

test("executable plans reject dependency cycles", () => {
  assert.deepEqual(
    validateExecutablePlanStructure([
      { n: 1, depends_on: [3] },
      { n: 2, depends_on: [1] },
      { n: 3, depends_on: [2] },
    ]),
    ["dependency graph contains a cycle"],
  );
});