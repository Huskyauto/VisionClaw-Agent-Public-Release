import assert from "node:assert/strict";
import test from "node:test";
import { selectIncomeClaudeRoute, reserveIncomeClaudeBudget, estimateIncomeClaudeUsage,
  withIncomeClaudeApiGrant, hasIncomeClaudeApiGrant, incomeClaudeApiEnabled } from "../../server/lib/income-claude-route";

test("ordinary income discovery uses Sonnet 5.5 without a classifier call", () => {
  const route = selectIncomeClaudeRoute("Run the jury to discover three evidence-backed income opportunities for HVAC businesses.");
  assert.equal(route.modelId, "claude-sonnet-5-5");
  assert.equal(route.providerLane, "anthropic-api");
  assert.equal(route.classifierCalls, 0);
});

test("density escalates but merely saying hard does not", () => {
  assert.equal(selectIncomeClaudeRoute("Find income ideas; this is a hard prompt.").modelId, "claude-sonnet-5-5");
  assert.equal(selectIncomeClaudeRoute("Run the income jury. " + "must retain evidence and exclude overlap; ".repeat(210)).modelId, "claude-opus-5-5");
  assert.throws(() => selectIncomeClaudeRoute(""), /original/);
  assert.throws(() => selectIncomeClaudeRoute("x".repeat(16001)), /original/);
});

test("owner grant is scoped by model and async context, not global metered state", async () => {
  const saved = process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED;
  try {
    process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "true";
    assert.equal(incomeClaudeApiEnabled(), false);
    process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "1";
    assert.equal(hasIncomeClaudeApiGrant(1, "claude-sonnet-5-5"), false);
    assert.throws(() => withIncomeClaudeApiGrant(2, "claude-sonnet-5-5", () => 1), /denied/);
    await withIncomeClaudeApiGrant(1, "claude-sonnet-5-5", async () => {
      await Promise.resolve();
      assert.equal(hasIncomeClaudeApiGrant(1, "claude-sonnet-5-5"), true);
      assert.equal(hasIncomeClaudeApiGrant(1, "claude-opus-5-5"), false);
      process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "0";
      assert.equal(hasIncomeClaudeApiGrant(1, "claude-sonnet-5-5"), false);
    });
    assert.equal(hasIncomeClaudeApiGrant(1, "claude-sonnet-5-5"), false);
  } finally {
    if (saved === undefined) delete process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED;
    else process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = saved;
  }
});

test("budget reserves synchronously and refuses overlapping calls beyond the ceiling", () => {
  let spent = 0;
  const budget = { ceiling: () => ({ spent, ceiling: 0.25 }),
    estimate: estimateIncomeClaudeUsage, reserve: (usd: number) => { spent += usd; } };
  const reserved = reserveIncomeClaudeBudget("claude-sonnet-5-5", "small prompt", budget);
  assert.ok(reserved > 0 && spent === reserved);
  assert.throws(() => reserveIncomeClaudeBudget("claude-sonnet-5-5", "small prompt", budget), /ceiling/);
  assert.equal(spent, reserved);
  assert.throws(() => reserveIncomeClaudeBudget("claude-sonnet-5-5", "x", { ...budget,
    ceiling: () => ({ spent: NaN, ceiling: 1 }) }), /ceiling/);
  assert.equal(estimateIncomeClaudeUsage("claude-sonnet-5-5", 1000, 1000), 0.012);
  assert.equal(estimateIncomeClaudeUsage("claude-opus-5-5", 1000, 1000), 0.024);
});

test("substantive hard prompts select Opus 5.5 before inference", () => {
  const route = selectIncomeClaudeRoute("Run the income jury, derive a formal proof of convergence and perform adversarial security analysis of the proposed multi-tenant service.");
  assert.equal(route.modelId, "claude-opus-5-5");
  assert.match(route.reason, /proof|security/i);
  assert.equal(route.classifierCalls, 0);
});
