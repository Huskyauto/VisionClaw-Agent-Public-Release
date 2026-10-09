import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRules } from "../../server/structured-extraction";

test("validateRules: rejects non-object", () => {
  assert.equal(validateRules(null as any).ok, false);
  assert.equal(validateRules("nope" as any).ok, false);
  assert.equal(validateRules([] as any).ok, false);
});

test("validateRules: rejects empty rules object", () => {
  assert.equal(validateRules({}).ok, false);
});

test("validateRules: rejects selectors longer than 500 chars", () => {
  const longSel = "div".repeat(200);
  const r = validateRules({ title: { selector: longSel } });
  assert.equal(r.ok, false);
});

test("validateRules: rejects attr not in allowlist", () => {
  const r = validateRules({ link: { selector: "a", attr: "onclick" } });
  assert.equal(r.ok, false);
});

test("validateRules: allows data-* attrs (allowlist exception)", () => {
  const r = validateRules({ id: { selector: "div", attr: "data-id" } });
  assert.equal(r.ok, true);
});

test("validateRules: rejects nesting beyond max depth", () => {
  let nested: any = { selector: "div" };
  for (let i = 0; i < 10; i++) nested = { selector: "div", fields: { x: nested } };
  const r = validateRules({ root: nested });
  assert.equal(r.ok, false);
});

test("validateRules: happy path", () => {
  const r = validateRules({
    title: { selector: "h1" },
    lead: { selector: "p.lead" },
    items: { selector: "li", multiple: true, fields: { name: { selector: "span" } } },
  });
  assert.equal(r.ok, true);
});

test("validateRules: rejects too many fields per level", () => {
  const rules: Record<string, any> = {};
  for (let i = 0; i < 50; i++) rules["f" + i] = { selector: "div" };
  const r = validateRules(rules);
  assert.equal(r.ok, false);
});
