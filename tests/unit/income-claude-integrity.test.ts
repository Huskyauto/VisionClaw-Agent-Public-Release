import test from "node:test";
import assert from "node:assert/strict";
import { wrapClientWithParamAdaptation } from "../../server/lib/param-adaptation";
import { incomeOriginalMessage, getIncomeDiscoveryTurn, withIncomeDiscoveryTurn,
  selectIncomeClaudeRoute, reportedJuryUsage } from "../../server/lib/income-claude-route";
import { runIncomeDiscovery } from "../../server/lib/income-discovery";
import { renderIncomeReport } from "../../server/lib/income-discovery-report";
import OpenAI from "openai";

test("maxRetries zero suppresses underlying parameter, timeout and SDK retries", async () => {
  for (const message of ["Unsupported parameter: max_completion_tokens", "request timed out", "HTTP 429 rate limit"]) {
    let calls = 0;
    const error = new Error(message);
    const client = wrapClientWithParamAdaptation({ chat: { completions: {
      create: async () => { calls++; throw error; },
    } } });
    await assert.rejects(() => client.chat.completions.create(
      { model: "claude-sonnet-5-5", max_completion_tokens: 16384 },
      { maxRetries: 0 }), err => err === error);
    assert.equal(calls, 1);
  }
});

test("real SDK plus adaptation makes one request under discovery's no-retry policy", async () => {
  for (const status of [400, 429]) {
    let requests = 0;
    const client = wrapClientWithParamAdaptation(new OpenAI({
      apiKey: "model-free-test-fixture", baseURL: "https://fixture.invalid/v1",
      fetch: async () => {
        requests++;
        return new Response(JSON.stringify({ error: { message: "Unsupported parameter: max_tokens",
          type: "invalid_request_error" } }), { status, headers: { "content-type": "application/json" } });
      },
    }));
    await assert.rejects(() => client.chat.completions.create({ model: "claude-sonnet-5-5",
      max_tokens: 16384, messages: [{ role: "user", content: "fixture" }] }, { maxRetries: 0 }));
    assert.equal(requests, 1);
  }
});

test("original income request stays bound to the invoking message during overlapping turns", async () => {
  const rows = [{ id: 1, role: "user", content: "Find ordinary income ideas" },
    { id: 2, role: "user", content: "Find income ideas needing a formal proof" }];
  const conversation = { id: 7, tenantId: 1, personaId: 2 };
  await Promise.all(rows.map(row => withIncomeDiscoveryTurn({
    tenantId: 1, conversationId: 7, personaId: 2, userMessageId: row.id,
  }, async () => {
    await Promise.resolve();
    assert.equal(incomeOriginalMessage(getIncomeDiscoveryTurn(), conversation, rows), row.content);
    assert.equal(incomeOriginalMessage(getIncomeDiscoveryTurn(), { ...conversation, tenantId: 2 }, rows), undefined);
    assert.equal(incomeOriginalMessage(getIncomeDiscoveryTurn(), { ...conversation, personaId: 3 }, rows), undefined);
  })));
  assert.equal(getIncomeDiscoveryTurn(), undefined);
  assert.equal(incomeOriginalMessage(undefined, conversation, rows), undefined);
});

test("report excludes guessed tokens from observed usage and discloses unconfirmed ledger writes", async () => {
  const result = await runIncomeDiscovery({ request: "Find income ideas",
    claudeRoute: selectIncomeClaudeRoute("Find income ideas"),
    infer: async () => [], research: async seat => ({ seatId: String(seat), runId: "",
      actor: "server-owned-juror-evidence-runner", receipts: [] }),
  });
  result.phases.ideation = [{ modelId: "claude-sonnet-5-5", provider: "anthropic-api",
    providerLane: "anthropic-api", ok: true, latencyMs: 1, tokensIn: 1000, tokensOut: 1000,
    usageReported: false, usagePersisted: false }];
  let report = renderIncomeReport(result);
  assert.ok(report.includes("$0.0000 based only on reported provider usage"));
  assert.ok(report.includes("token counts, if any, are estimates"));
  assert.ok(report.includes("ledger persistence: not confirmed"));
  result.phases.ideation[0] = { ...result.phases.ideation[0], ok: false,
    error: "empty completion", usageReported: true, reportedTokensIn: 1000, reportedTokensOut: 1000 };
  report = renderIncomeReport(result);
  assert.ok(report.includes("$0.0120 based only on reported provider usage"));
  assert.ok(report.includes("FAILED: empty completion"));
  assert.ok(report.includes("ledger persistence: not confirmed"));
  for (const [usage, expectedCost] of [
    [{ completion_tokens: 1000 }, "$0.0100"],
    [{ prompt_tokens: 1000 }, "$0.0020"],
    [{ completion_tokens: 0 }, "$0.0000"],
  ] as const) {
    const observed = reportedJuryUsage(usage);
    result.phases.ideation[0] = { ...result.phases.ideation[0],
      reportedTokensIn: observed.input, reportedTokensOut: observed.output };
    assert.ok(renderIncomeReport(result).includes(`${expectedCost} based only on reported provider usage`));
  }
});
