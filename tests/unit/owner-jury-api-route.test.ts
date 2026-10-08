import test from "node:test";
import assert from "node:assert/strict";
import { executeOwnerJuryApiCall, hasOwnerJuryApiGrant } from "../../server/lib/owner-jury-api-route";
import { resolveProposerSpecs, executeIncomeDiscoverySeats, ownerJuryMeteredOverrideAllowed } from "../../server/moa";
import { selectIncomeClaudeRoute } from "../../server/lib/income-claude-route";

test("any owner jury topic uses distinct direct OpenAI, Anthropic and Openference seats", () => {
  const specs = resolveProposerSpecs("frontier", undefined);
  assert.deepEqual(specs.map(s => [s.modelId, s.providerLane]), [
    ["openference/deepseek-v4-pro", "openference"],
    ["gpt-5.4", "openai-api"],
    ["claude-sonnet-5-5", "anthropic-api"],
  ]);
});

test("direct jury permission cannot unlock generic third-party paid routes or another tenant", () => {
  const previousDirect = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  const previousLegacy = process.env.OWNER_JURY_METERED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  process.env.OWNER_JURY_METERED = "0";
  try {
    assert.equal(ownerJuryMeteredOverrideAllowed(1, true, { modelId: "gpt-5.4", providerLane: "openai-api" }), true);
    assert.equal(ownerJuryMeteredOverrideAllowed(1, true, { modelId: "claude-opus-5-5", providerLane: "anthropic-api" }), true);
    for (const spec of [{ modelId: "google/gemini-3.8-flash" },
      { modelId: "gpt-5.4" }, { modelId: "z-ai/glm-5.3", providerLane: "zai" as const }]) {
      assert.equal(ownerJuryMeteredOverrideAllowed(1, true, spec), false);
    }
    assert.equal(ownerJuryMeteredOverrideAllowed(2, true, { modelId: "gpt-5.4", providerLane: "openai-api" }), false);
    assert.equal(ownerJuryMeteredOverrideAllowed(1, false, { modelId: "gpt-5.4", providerLane: "openai-api" }), false);
  } finally {
    if (previousDirect === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previousDirect;
    if (previousLegacy === undefined) delete process.env.OWNER_JURY_METERED;
    else process.env.OWNER_JURY_METERED = previousLegacy;
  }
});

test("general owner jury permission also covers income without its legacy topic-specific flags", async () => {
  const keys = ["OWNER_JURY_DIRECT_API_ENABLED", "INCOME_DISCOVERY_OPENAI_API_ENABLED", "INCOME_DISCOVERY_CLAUDE_API_ENABLED"];
  const previous = keys.map(key => process.env[key]);
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "0";
  process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "0";
  let paidCalls = 0, reserved = 0;
  try {
    const seats = await executeIncomeDiscoverySeats("Find opportunities", 1, undefined,
      selectIncomeClaudeRoute("Find opportunities"), {
        budget: { estimate: () => 0.1, ceiling: () => ({ spent: reserved, ceiling: 1 }),
          reserve: value => { reserved += value; } },
        call: async spec => {
          assert.equal(typeof spec, "object");
          if (typeof spec === "string") throw Error("Unexpected unpinned seat");
          spec.beforeDispatch?.();
          if (spec.providerLane === "openai-api" || spec.providerLane === "anthropic-api") {
            paidCalls++;
            assert.equal(hasOwnerJuryApiGrant(1, spec.providerLane, spec.modelId), true);
          }
          return { modelId: spec.modelId, provider: spec.providerLane!, ok: true, answer: "{}", latencyMs: 1 };
        },
      });
    assert.equal(seats.every(seat => seat.ok), true);
    assert.equal(paidCalls, 2);
    assert.equal(reserved, 0.2, "one reservation per paid seat, not a nested duplicate");
  } finally {
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
  }
});

test("owner jury paid grant is topic-independent, reserves before dispatch and denies other tenants", async () => {
  const previous = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "1";
  let spent = 0, calls = 0;
  const budget = { estimate: () => 0.3, ceiling: () => ({ spent, ceiling: 0.5 }),
    reserve: (value: number) => { spent += value; } };
  try {
    const answer = await executeOwnerJuryApiCall(1, "openai-api", "gpt-5.4", "Review an HVAC diagnosis", budget, async () => {
      calls++;
      assert.equal(spent, 0.3);
      assert.equal(hasOwnerJuryApiGrant(1, "openai-api", "gpt-5.4"), true);
      assert.equal(hasOwnerJuryApiGrant(2, "openai-api", "gpt-5.4"), false);
      assert.equal(hasOwnerJuryApiGrant(1, "anthropic-api", "gpt-5.4"), false);
      await Promise.resolve();
      return "reviewed";
    });
    assert.equal(answer, "reviewed");
    assert.equal(hasOwnerJuryApiGrant(1, "openai-api", "gpt-5.4"), false);
    await assert.rejects(executeOwnerJuryApiCall(1, "openai-api", "gpt-5.4", "Another topic", budget, async () => { calls++; }), /ceiling/);
    await assert.rejects(executeOwnerJuryApiCall(2, "openai-api", "gpt-5.4", "Another topic", budget, async () => { calls++; }), /denied/);
    process.env.OWNER_JURY_DIRECT_API_ENABLED = "true";
    await assert.rejects(executeOwnerJuryApiCall(1, "openai-api", "gpt-5.4", "Another topic", budget, async () => { calls++; }), /denied/);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = previous;
  }
});
