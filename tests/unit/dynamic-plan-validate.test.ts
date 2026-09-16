/**
 * tests/unit/dynamic-plan-validate.test.ts
 *
 * Covers the PURE fail-closed validation for Felix's dynamically composed plans
 * (server/lib/dynamic-plan-validate.ts). Imports the dependency-free module ONLY
 * (type-only PipelineStep import is erased at runtime) so node:test never hangs
 * on an open pg pool.
 *
 * Run: node --import tsx --test tests/unit/dynamic-plan-validate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildValidatedDynamicSteps } from "../../server/lib/dynamic-plan-validate";

const valid = new Set(["generate_image", "create_pdf", "deliver_product", "web_search"]);

test("drops steps whose tool is not in the live registry (fail-closed)", () => {
  const out = buildValidatedDynamicSteps(
    [
      { tool: "generate_image", purpose: "make art" },
      { tool: "totally_made_up_tool", purpose: "hallucinated" },
      { tool: "create_pdf", purpose: "build doc" },
    ],
    valid,
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => s.tool), ["generate_image", "create_pdf"]);
});

test("returns [] when no proposed tool is valid", () => {
  const out = buildValidatedDynamicSteps(
    [{ tool: "nope", purpose: "x" }, { tool: "also_nope", purpose: "y" }],
    valid,
  );
  assert.deepEqual(out, []);
});

test("non-array / empty / junk input yields []", () => {
  assert.deepEqual(buildValidatedDynamicSteps(undefined, valid), []);
  assert.deepEqual(buildValidatedDynamicSteps(null, valid), []);
  assert.deepEqual(buildValidatedDynamicSteps("not-an-array" as unknown, valid), []);
  assert.deepEqual(buildValidatedDynamicSteps([], valid), []);
  assert.deepEqual(buildValidatedDynamicSteps([{}, { tool: 5 }], valid), []);
});

test("builds a sequential dependency chain + waves", () => {
  const out = buildValidatedDynamicSteps(
    [
      { tool: "web_search", purpose: "research" },
      { tool: "create_pdf", purpose: "write" },
      { tool: "deliver_product", purpose: "ship" },
    ],
    valid,
  );
  assert.deepEqual(out.map((s) => s.wave), [1, 2, 3]);
  assert.deepEqual(out[0].dependsOn, []);
  assert.deepEqual(out[1].dependsOn, [0]);
  assert.deepEqual(out[2].dependsOn, [1]);
});

test("waves/dependsOn are renumbered AFTER invalid steps are dropped", () => {
  const out = buildValidatedDynamicSteps(
    [
      { tool: "bogus_first", purpose: "drop me" },
      { tool: "web_search", purpose: "research" },
      { tool: "bogus_mid", purpose: "drop me too" },
      { tool: "create_pdf", purpose: "write" },
    ],
    valid,
  );
  assert.deepEqual(out.map((s) => s.tool), ["web_search", "create_pdf"]);
  assert.deepEqual(out.map((s) => s.wave), [1, 2]);
  assert.deepEqual(out[0].dependsOn, []);
  assert.deepEqual(out[1].dependsOn, [0]);
});

test("defaults required=true; honors explicit required=false", () => {
  const out = buildValidatedDynamicSteps(
    [
      { tool: "generate_image", purpose: "p" },
      { tool: "web_search", purpose: "p", required: false },
    ],
    valid,
  );
  assert.equal(out[0].required, true);
  assert.equal(out[1].required, false);
});

test("caps the plan at maxSteps (default 8)", () => {
  const many = Array.from({ length: 20 }, () => ({ tool: "web_search", purpose: "p" }));
  assert.equal(buildValidatedDynamicSteps(many, valid).length, 8);
  assert.equal(buildValidatedDynamicSteps(many, valid, 3).length, 3);
});

test("trims whitespace around tool names before matching", () => {
  const out = buildValidatedDynamicSteps([{ tool: "  create_pdf  ", purpose: "p" }], valid);
  assert.equal(out.length, 1);
  assert.equal(out[0].tool, "create_pdf");
});

test("truncates over-long purpose / inputsHint to 300 chars", () => {
  const long = "x".repeat(500);
  const out = buildValidatedDynamicSteps([{ tool: "web_search", purpose: long, inputs_hint: long }], valid);
  assert.equal(out[0].purpose.length, 300);
  assert.equal(out[0].inputsHint?.length, 300);
});
