import test from "node:test";
import assert from "node:assert/strict";
import { createLocalBackgroundRouter, SurfaceModelUnavailable } from "../../server/legion/local-router";

test("Lenovo stays primary when both laptops are enabled and healthy; Surface is not contacted", async () => {
  const calls: string[] = [];
  const body = { model: "qwen3:8b", stream: false, max_tokens: 2048, messages: [] };
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true,
    surfaceHealth: async () => { calls.push("surface-health"); },
    surfaceGenerate: async () => { calls.push("surface-generate"); return {}; },
    legionHealth: async () => { calls.push("legion-health"); },
    legionGenerate: async value => { calls.push("legion-generate"); assert.deepEqual(value, body); return {}; },
  });
  const result = await route(body);
  assert.equal(result.provider, "legion-local");
  assert.equal(result.localFallback, false);
  assert.deepEqual(calls, ["legion-health", "legion-generate"]);
});

test("disabled Surface leaves the Lenovo production body unchanged and makes no Surface call", async () => {
  const calls: string[] = [];
  const body = { model: "qwen3:8b", stream: false, max_tokens: 2048,
    reasoning_effort: "none", response_format: { type: "json_schema" }, messages: [] };
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => false,
    surfaceHealth: async () => { calls.push("surface-health"); },
    surfaceGenerate: async () => { calls.push("surface-generate"); return {}; },
    legionHealth: async () => { calls.push("legion-health"); },
    legionGenerate: async value => { calls.push("legion-generate"); assert.deepEqual(value, body); return { model: "qwen3:8b" }; },
  });
  const result = await route(body);
  assert.equal(result.provider, "legion-local");
  assert.equal(result.localFallback, false);
  assert.deepEqual(calls, ["legion-health", "legion-generate"]);
});

test("an unavailable Surface backup cannot jump back to the offline Lenovo", async () => {
  let legionCalls = 0;
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true, surfaceHealth: async () => {},
    surfaceGenerate: async () => { throw new SurfaceModelUnavailable("Surface model unavailable"); },
    legionHealth: async () => { throw Error("Lenovo offline"); },
    legionGenerate: async () => { legionCalls++; return {}; },
  });
  await assert.rejects(route({ messages: [] }), SurfaceModelUnavailable);
  assert.equal(legionCalls, 0);
});

test("Surface is used only after Lenovo is offline, with Foundry-compatible backup parameters", async () => {
  const calls: string[] = [];
  const body = { model: "qwen3:8b", stream: false, temperature: 0, max_tokens: 2048,
    reasoning_effort: "none", response_format: { type: "json_schema" },
    tools: [{ type: "function" }], messages: [{ role: "user", content: "Synthetic source only" }] };
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true,
    surfaceHealth: async () => { calls.push("surface-health"); },
    surfaceGenerate: async value => {
      calls.push("surface-generate");
      assert.deepEqual(value, { model: "qwen2.5-7b-instruct-generic-gpu:4", stream: true,
        temperature: 0, messages: body.messages });
      return { model: value.model };
    },
    legionHealth: async () => { calls.push("legion-health"); throw Error("Lenovo offline"); },
    legionGenerate: async () => { calls.push("legion-generate"); return {}; },
  });
  const result = await route(body);
  assert.equal(result.provider, "surface-local");
  assert.equal(result.localFallback, true);
  assert.equal(body.max_tokens, 2048);
  assert.deepEqual(calls, ["legion-health", "surface-health", "surface-generate"]);
});

test("disabled, away and revoked backup refuses work; failed Lenovo generation gets at most one Surface attempt", async () => {
  for (const scenario of ["disabled", "revoked", "surface-generation-failed", "both-away", "legion-generation-failed"]) {
    let enabled = scenario !== "disabled";
    const calls: string[] = [];
    const route = createLocalBackgroundRouter({
      surfaceEnabled: () => enabled,
      surfaceHealth: async () => {
        calls.push("surface-health");
        if (scenario === "both-away") throw Error("node away");
        if (scenario === "revoked") enabled = false;
      },
      surfaceGenerate: async () => { calls.push("surface-generate"); throw Error("uncertain generation"); },
      legionHealth: async () => { calls.push("legion-health"); if (scenario !== "legion-generation-failed") throw Error("Lenovo offline"); },
      legionGenerate: async () => { calls.push("legion-generate"); throw Error("uncertain primary generation"); },
    });
    await assert.rejects(route({ messages: [] }));
    assert.equal(calls.filter(c => c.endsWith("generate")).length,
      scenario === "legion-generation-failed" ? 2 : scenario === "surface-generation-failed" ? 1 : 0, scenario);
    if (scenario === "disabled") {
      assert.equal(calls.includes("surface-health"), false, scenario);
    }
  }
});

test("routing returns to Lenovo on the next call when it comes back online", async () => {
  let online = false;
  let surfaceCalls = 0;
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true, surfaceHealth: async () => {},
    surfaceGenerate: async () => { surfaceCalls++; return {}; },
    legionHealth: async () => { if (!online) throw Error("Lenovo offline"); },
    legionGenerate: async () => ({}),
  });
  assert.equal((await route({ messages: [] })).provider, "surface-local");
  online = true;
  const restored = await route({ messages: [] });
  assert.equal(restored.provider, "legion-local");
  assert.equal(restored.localFallback, false);
  assert.equal(surfaceCalls, 1);
});
