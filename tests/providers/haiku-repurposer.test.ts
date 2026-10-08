import assert from "node:assert/strict";
import test from "node:test";
import { runHaikuRepurposer, type RepurposerDeps } from "../../server/lib/haiku-repurposer";

test("paid repurposing pins Haiku medium and reserves before a single accounted call", async () => {
  const events: string[] = [];
  const deps: RepurposerDeps = {
    resolve: async tenantId => {
      assert.equal(tenantId, 1);
      return { native: true, model: "claude-haiku-5-5",
        count: async () => 200,
        generate: async request => {
          events.push("generate");
          assert.equal(request.model, "claude-haiku-5-5");
          assert.equal(request.output_config?.effort, "medium");
          assert.equal(request.thinking?.type, "adaptive");
          return { model: "claude-haiku-5-5", stop_reason: "end_turn",
            content: [{ type: "text", text: '{"variants":[]}' }],
            usage: { input_tokens: 200, output_tokens: 30 } };
        } };
    },
    reserve: async () => { events.push("reserve"); return true; },
    ceiling: () => true,
    record: async cost => { events.push("record"); assert.ok(cost < 0.003072); return true; },
  };
  assert.equal(await runHaikuRepurposer(1, "synthetic source", "system", undefined, deps), '{"variants":[]}');
  assert.deepEqual(events, ["reserve", "generate", "record"]);
});

function fakeDeps(overrides: Partial<RepurposerDeps> = {}): RepurposerDeps {
  return {
    resolve: async () => ({ native: true, model: "claude-haiku-5-5", count: async () => 200,
      generate: async () => ({ model: "claude-haiku-5-5", stop_reason: "end_turn",
        content: [{ type: "text", text: '{"variants":[]}' }],
        usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 } }) }),
    reserve: async () => true, ceiling: () => true, record: async () => true,
    ...overrides,
  };
}

test("untrusted/missing tenant fails before resolution; actual tenant owns reservation and cost", async () => {
  let resolutions = 0;
  const deps = fakeDeps({ resolve: async () => { resolutions++; throw new Error("must not call"); } });
  for (const tenant of [undefined, 0, -1, NaN, 1.5, "1" as any]) {
    await assert.rejects(runHaikuRepurposer(tenant, "source", "system", undefined, deps), /TRUSTED_TENANT_REQUIRED/);
  }
  assert.equal(resolutions, 0);
  await runHaikuRepurposer(2, "source", "system", undefined, fakeDeps({
    reserve: async tenant => { assert.equal(tenant, 2); return true; },
    record: async (cost, tenant) => { assert.equal(tenant, 2); assert.ok(Math.abs(cost - 0.0000376) < 1e-12); return true; },
  }));
});

test("budget denial, degraded admission and Anthropic ceiling cannot dispatch", async () => {
  let calls = 0;
  const resolve = async () => ({ native: true, model: "claude-haiku-5-5", count: async () => 200,
    generate: async () => { calls++; throw new Error("must not call"); } });
  await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined,
    fakeDeps({ resolve, reserve: async () => false })), /BUDGET_DENIED/);
  await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined,
    fakeDeps({ resolve, ceiling: () => false })), /BUDGET_DENIED/);
  assert.equal(calls, 0);
});

test("native timeouts record one conservative completion and never fall back/retry", async () => {
  let calls = 0, records = 0;
  const deps = fakeDeps({
    resolve: async () => ({ native: true, model: "claude-haiku-5-5", count: async () => 200,
      generate: async () => { calls++; throw new Error("private provider exception"); } }),
    record: async (cost, tenant, reply) => { records++; assert.equal(cost, 0.003072); assert.equal(tenant, 1); assert.equal(reply, undefined); return true; },
  });
  await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined, deps), /COMPLETION_UNCERTAIN_NO_RETRY/);
  assert.equal(calls, 1); assert.equal(records, 1);
});

test("flat/free route stays selected, avoids native effort, reservation and double accounting", async () => {
  const deps = fakeDeps({
    resolve: async () => ({ native: false, model: "gpt-5.4",
      generate: async request => {
        assert.equal(request.model, "gpt-5.4"); assert.equal(request.output_config, undefined);
        return { model: "gpt-5.4", stop_reason: "end_turn", content: [{ type: "text", text: "draft" }] };
      } }),
    reserve: async () => { throw new Error("must not reserve paid budget"); },
    ceiling: () => { throw new Error("must not inspect paid ceiling"); },
    record: async () => { throw new Error("provider owns accounting"); },
  });
  assert.equal(await runHaikuRepurposer(2, "source", "system", undefined, deps), "draft");
});

test("missing usage, wrong model and truncation cannot be returned as completed drafts", async () => {
  for (const defect of ["usage", "model", "truncation"]) {
    const base = fakeDeps();
    const route = await base.resolve(1);
    let records = 0;
    const deps = fakeDeps({
      resolve: async () => ({ ...route, generate: async (request, signal) => {
        const r = await route.generate(request, signal);
        return defect === "usage" ? { ...r, usage: undefined } :
          defect === "model" ? { ...r, model: "claude-sonnet-4-5" } : { ...r, stop_reason: "max_tokens" };
      } }),
      record: async cost => { records++; if (defect !== "truncation") assert.equal(cost, 0.003072); return true; },
    });
    await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined, deps), /NO_RETRY/);
    assert.equal(records, 1);
  }
});

test("input envelope and existing cancellation stop inference; ledger failure stops success", async () => {
  let calls = 0;
  const deps = fakeDeps({ resolve: async () => ({ native: true, model: "claude-haiku-5-5", count: async () => 8193,
    generate: async () => { calls++; throw new Error("must not call"); } }) });
  await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined, deps), /INPUT_TOO_LARGE/);
  await assert.rejects(runHaikuRepurposer(1, "source", "system", AbortSignal.abort(), deps));
  assert.equal(calls, 0);
  await assert.rejects(runHaikuRepurposer(1, "source", "system", undefined,
    fakeDeps({ record: async () => false })), /LEDGER_FAILED_NO_RETRY/);
});
