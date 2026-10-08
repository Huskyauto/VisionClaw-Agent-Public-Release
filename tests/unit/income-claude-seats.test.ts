import test from "node:test";
import assert from "node:assert/strict";
import { executeIncomeDiscoverySeats } from "../../server/moa";
import { estimateIncomeClaudeUsage, hasIncomeClaudeApiGrant, selectIncomeClaudeRoute } from "../../server/lib/income-claude-route";

test("ordinary income jury phases prefer the subscription without paid reservations", async () => {
  const saved = process.env.PROFUNDO_ENABLED;
  process.env.PROFUNDO_ENABLED = "1";
  try {
    const calls: string[] = [];
    const result = await executeIncomeDiscoverySeats("Synthetic structured ideation fixture", 1, undefined,
      selectIncomeClaudeRoute("Find practical income ideas"), {
        budget: { ceiling: () => ({ spent: 0, ceiling: 5, exceeded: false }),
          estimate: () => 0.1, reserve: () => { throw new Error("Healthy subscription must not reserve paid funds"); } },
        call: async spec => {
          calls.push(spec.providerLane!);
          return { modelId: spec.modelId, provider: spec.providerLane!, providerLane: spec.providerLane,
            ok: true, answer: '{"concepts":[]}', latencyMs: 1 };
        },
      });
    assert.deepEqual(calls, ["profundo", "profundo", "profundo"]);
    assert.equal(result.length, 3);
  } finally {
    if (saved === undefined) delete process.env.PROFUNDO_ENABLED;
    else process.env.PROFUNDO_ENABLED = saved;
  }
});
import { hasIncomeOpenaiApiGrant } from "../../server/lib/income-openai-route";
import { estimateCostUsd } from "../../server/agentic/cost-ledger";

test("two rounds pin only the selected Claude seat as paid and reserve before its call", async () => {
  const saved = process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED;
  const savedGeneral = process.env.OWNER_JURY_DIRECT_API_ENABLED;
  process.env.OWNER_JURY_DIRECT_API_ENABLED = "0";
  const savedOpenai = process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
  process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "1";
  process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "1";
  try {
    for (const original of ["Find income opportunities", "Find income opportunities requiring a formal proof"]) {
      let spent = 0;
      const calls: { lane?: string; model: string; metered: boolean }[] = [];
      const route = selectIncomeClaudeRoute(original);
      const dependencies = {
        budget: { estimate: estimateCostUsd, ceiling: () => ({ spent, ceiling: 10 }),
          reserve: (usd: number) => { spent += usd; } },
        call: async (specOrId: string | import("../../server/moa").ProposerCallSpec,
          _question: string, _tenant: number, metered = false) => {
          assert.ok(typeof specOrId !== "string");
          const spec = specOrId;
          spec.beforeDispatch?.();
          assert.equal(spec.noRetry, true);
          assert.equal(spec.maxTokens, 16384);
          assert.equal(spec.profundoRetry, undefined);
          assert.notEqual(spec.providerLane, "profundo");
          assert.equal(spec.timeoutMs, spec.providerLane === "openai-api" ? 120000 : 60000);
          calls.push({ lane: spec.providerLane, model: spec.modelId, metered });
          if (metered) {
            assert.ok(spent > 0);
            assert.equal(spec.providerLane === "openai-api"
              ? hasIncomeOpenaiApiGrant(1, "gpt-5.4") : hasIncomeClaudeApiGrant(1, route.modelId), true);
          }
          return { modelId: spec.modelId, provider: spec.providerLane!, providerLane: spec.providerLane,
            ok: true, reportedModel: spec.modelId, answer: "{}", latencyMs: 1 };
        },
      };
      await executeIncomeDiscoverySeats("Ideation template", 1, undefined, route, dependencies);
      await executeIncomeDiscoverySeats("Assessment: formal proof; adversarial security template", 1, undefined, route, dependencies);
      assert.equal(calls.length, 6);
      assert.deepEqual(calls.filter(c => c.metered).map(c => c.model), ["gpt-5.4", route.modelId, "gpt-5.4", route.modelId]);
      assert.ok(calls.filter(c => c.lane === "openference").every(c => !c.metered));
      const paidBeforeDisable = calls.filter(c => c.lane === "anthropic-api").length;
      process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "0";
      const disabled = await executeIncomeDiscoverySeats("Ideation", 1, undefined, route, dependencies);
      assert.equal(disabled[2].ok, false);
      assert.equal(calls.filter(c => c.lane === "anthropic-api").length, paidBeforeDisable);
      process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "0";
      const noOpenai = await executeIncomeDiscoverySeats("Ideation", 1, undefined, route, dependencies);
      assert.equal(noOpenai[1].ok, false);
      process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = "1";
      process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = "1";
      await assert.rejects(() => executeIncomeDiscoverySeats("Ideation", 2, undefined, route, dependencies), /owner-only/);
    }
  } finally {
    if (savedGeneral === undefined) delete process.env.OWNER_JURY_DIRECT_API_ENABLED;
    else process.env.OWNER_JURY_DIRECT_API_ENABLED = savedGeneral;
    if (saved === undefined) delete process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED;
    else process.env.INCOME_DISCOVERY_CLAUDE_API_ENABLED = saved;
    if (savedOpenai === undefined) delete process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED;
    else process.env.INCOME_DISCOVERY_OPENAI_API_ENABLED = savedOpenai;
  }
});
