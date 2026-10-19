import test from "node:test";
import assert from "node:assert/strict";
import { withTenantContext } from "../../server/lib/tenant-context";
import {
  cheaperAutomaticAllowed, runCheaperBudgeted, parseCheaperCatalog, cheaperMinimumDiscount,
} from "../../server/lib/cheaper-inference-automatic.ts";

test("automatic authority is exact owner scope and opt-in, never a caller grant", () => {
  const env = { CHEAPER_INFERENCE_AUTOMATIC_ENABLED: "1", CHEAPER_INFERENCE_API_KEY: "fixture" };
  assert.equal(cheaperAutomaticAllowed(1, env), true);
  for (const id of [undefined, 2, 0, "1", NaN]) assert.equal(cheaperAutomaticAllowed(id as number, env), false);
  for (const flag of [undefined, "", "true", "0"]) {
    assert.equal(cheaperAutomaticAllowed(1, { ...env, CHEAPER_INFERENCE_AUTOMATIC_ENABLED: flag }), false);
  }
  assert.equal(cheaperAutomaticAllowed(1, { ...env, CHEAPER_INFERENCE_ENABLED: "0" }), false);
  assert.equal(withTenantContext({ tenantId: 2, source: "explicit" }, () => cheaperAutomaticAllowed(1, env)), false);
});

test("operator discount floor defaults to forty and rejects malformed relaxation", () => {
  assert.equal(cheaperMinimumDiscount({}), 40);
  assert.equal(cheaperMinimumDiscount({ CHEAPER_INFERENCE_MIN_DISCOUNT_PERCENT: "15" }), 15);
  for (const value of ["", "false", "-1", "101", "NaN", "15.5", " 0"])
    assert.throws(() => cheaperMinimumDiscount({ CHEAPER_INFERENCE_MIN_DISCOUNT_PERCENT: value }));
});

test("catalog separates chat/vision from media and rejects malformed billing metadata", () => {
  const entry = { id: "fixture", type: "text", endpoint: "/v1/chat/completions",
    context_length: 8192, capabilities: { vision: true },
    pricing: { input_per_million: "1", output_per_million: "2",
      list_input_per_million: "2", list_output_per_million: "4" } };
  const models = parseCheaperCatalog({ data: [entry, { ...entry, id: "image", type: "image",
    endpoint: "/v1/images/generations" }] });
  assert.equal(models.length, 2);
  assert.equal(models[0].vision, true);
  assert.equal(models[0].maximumInput, 2, "reserve full maker input price even at a relaxed discount");
  assert.equal(models[0].maximumOutput, 4, "reserve full maker output price even at a relaxed discount");
  assert.equal(models[1].type, "image");
  assert.throws(() => parseCheaperCatalog({ data: [{ ...entry, id: "../../bad" }] }));
  assert.throws(() => parseCheaperCatalog({ data: [{ ...entry, pricing: {} }] }));
});

test("known decision-only catalog entries cannot disable or enter chat routing", () => {
  const chat = { id: "fixture", type: "text", endpoint: "/v1/chat/completions",
    context_length: 8192, pricing: { input_per_million: "1", output_per_million: "2" } };
  const decision = { id: "jev-1.13", type: "decision", endpoint: "/v1/decisions" };
  assert.deepEqual(parseCheaperCatalog({ data: [chat, decision] }).map(m => m.id), ["fixture"]);
  assert.throws(() => parseCheaperCatalog({ data: [chat, { ...decision, endpoint: "/v1/chat/completions" }] }));
  assert.throws(() => parseCheaperCatalog({ data: [chat, { ...decision, type: "unknown" }] }));
  assert.throws(() => parseCheaperCatalog({ data: [chat, { ...decision, id: chat.id }] }));
  assert.throws(() => parseCheaperCatalog({ data: [chat, { ...chat, id: "broken", pricing: {} }] }));
});

test("reserve precedes dispatch; buffered usage settles once and missing usage retains its hold", async () => {
  const events: string[] = [];
  const deps = {
    reserve: async () => { events.push("reserve"); return { id: 1, attemptKey: "fixture" }; },
    settle: async () => { events.push("settle"); },
  };
  const run = (result: any) => runCheaperBudgeted(1, 0.25, async () => {
    events.push("dispatch"); return result;
  }, u => typeof u?.cost === "number" ? u.cost : undefined, deps);
  await run({ usage: { cost: 0.01 } });
  assert.deepEqual(events, ["reserve", "dispatch", "settle"]);
  events.length = 0;
  await run({});
  assert.deepEqual(events, ["reserve", "dispatch"]);
});

test("stream disconnect and network timeout never release an ambiguous reservation", async () => {
  let settled = 0;
  const deps = { reserve: async () => ({ id: 1, attemptKey: "fixture" }),
    settle: async () => { settled++; } };
  await assert.rejects(runCheaperBudgeted(1, 0.25, async () => { throw Error("timeout"); },
    () => 0, deps));
  const stream = await runCheaperBudgeted(1, 0.25, async () => (async function* () {
    yield { choices: [], usage: { cost: 0.01 } };
    yield { choices: [] };
  })(), u => u?.cost, deps);
  for await (const chunk of stream) { assert.ok(chunk); break; }
  assert.equal(settled, 0);
  const complete = await runCheaperBudgeted(1, 0.25, async () => (async function* () {
    yield { choices: [], usage: { cost: 0.01 } };
  })(), u => u?.cost, deps);
  for await (const _ of complete) { /* exhaust */ }
  assert.equal(settled, 1);
});

test("failed admission prevents spend; foreign tenants never reach admission", async () => {
  let dispatched = false;
  const deps = { reserve: async () => { throw Error("budget exhausted"); }, settle: async () => {} };
  for (const tenant of [1, 2]) await assert.rejects(runCheaperBudgeted(tenant, 0.25,
    async () => { dispatched = true; }, () => 0, deps));
  assert.equal(dispatched, false);
});
