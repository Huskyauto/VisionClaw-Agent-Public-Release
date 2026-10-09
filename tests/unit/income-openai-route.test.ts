import test from "node:test";
import assert from "node:assert/strict";
import { withIncomeOpenaiApiGrant, hasIncomeOpenaiApiGrant } from "../../server/lib/income-openai-route";
import { reserveIncomeApiBudget } from "../../server/lib/income-claude-route";
import { getClientForModel } from "../../server/providers";

test("OpenAI income grant requires exact opt-in, owner and exact model; cannot authorize other transports", async () => {
  const previous = process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
  try {
    process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "1";
    assert.equal(hasIncomeOpenaiApiGrant(1, "gpt-5.4"), false);
    await withIncomeOpenaiApiGrant(1, "gpt-5.4", async () => {
      assert.equal(hasIncomeOpenaiApiGrant(1, "gpt-5.4"), true);
      assert.equal(hasIncomeOpenaiApiGrant(2, "gpt-5.4"), false);
      assert.equal(hasIncomeOpenaiApiGrant(1, "gpt-5.5"), false);
      await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(hasIncomeOpenaiApiGrant(1, "gpt-5.4"), true);
    });
    assert.equal(hasIncomeOpenaiApiGrant(1, "gpt-5.4"), false);
    assert.throws(() => withIncomeOpenaiApiGrant(2, "gpt-5.4", () => {}), /denied/);
    process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "true";
    assert.throws(() => withIncomeOpenaiApiGrant(1, "gpt-5.4", () => {}), /denied/);
  } finally {
    if (previous === undefined) delete process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
    else process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = previous;
  }
});

test("direct OpenAI paid requests share synchronous reserve-before-dispatch ceiling", () => {
  let spent = 0;
  const budget = { estimate: () => 0.4, ceiling: () => ({ spent, ceiling: 0.5 }),
    reserve: (usd: number) => { spent += usd; } };
  assert.equal(reserveIncomeApiBudget("gpt-5.4", "Original prompt", budget), 0.4);
  assert.throws(() => reserveIncomeApiBudget("gpt-5.4", "Overlapping call", budget), /ceiling/);
  assert.equal(spent, 0.4);
});

test("pinned API rejects missing grant, nonowner and missing metered override before networking", async () => {
  const previous = process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
  process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "1";
  try {
    await assert.rejects(getClientForModel("gpt-5.4", 1, { providerLane: "openai-api", meteredOverride: true }), /grant/);
    await assert.rejects(getClientForModel("gpt-5.4", 2, { providerLane: "openai-api", meteredOverride: true }), /grant/);
    await withIncomeOpenaiApiGrant(1, "gpt-5.4", async () => {
      await assert.rejects(getClientForModel("gpt-5.4", 1, { providerLane: "openai-api" }), /grant/);
      await assert.rejects(getClientForModel("gpt-5.5", 1, { providerLane: "openai-api", meteredOverride: true }), /grant/);
    });
  } finally {
    if (previous === undefined) delete process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
    else process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = previous;
  }
});
