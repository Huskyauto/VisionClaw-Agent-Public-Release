import test from "node:test";
import assert from "node:assert/strict";
process.env.AI_TASK_FIT_AUDIT_ENABLED = "1";
import { lookupProduct } from "../server/product-catalog";
import { validateProductIntake } from "../server/routes/store-checkout";

test("audit checkout accepts declared selectors and rejects arbitrary sensitive strings", () => {
  const product = lookupProduct("sample-agency-audit-starter")!;
  const valid = validateProductIntake(product, { department_type: "operations", task_count: "1-5", primary_goal: "time-savings" });
  assert.equal(valid.error, undefined);
  assert.equal(valid.metadata.intake_department_type, "operations");
  const invalid = validateProductIntake(product, { department_type: "employee layoffs and names", task_count: "1-5", primary_goal: "time-savings" });
  assert.match(invalid.error || "", /declared option/);
});

test("optional select intake may be absent but rejects populated invalid values", () => {
  const product = lookupProduct("sample-test-service-sku-001")!;
  const absent = validateProductIntake(product, { topic: "AI safety" });
  assert.equal(absent.error, undefined);
  const invalid = validateProductIntake(product, { topic: "AI safety", depth: "secret-depth" });
  assert.match(invalid.error || "", /declared option/);
});