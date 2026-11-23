import assert from "node:assert/strict";
import test from "node:test";
import { resolveProposerSpecs } from "../../server/moa";
import { withTenantContext } from "../../server/lib/tenant-context";
import { assertOwnerFrontierDispatch, claimOwnerFrontierPanel, explicitlyRequestsFrontierJury,
  withOwnerFrontierTurn } from "../../server/lib/owner-frontier-refresh";
import { recoverSubscriptionSeats } from "../../server/lib/subscription-jury-recovery";

function withFlags<T>(fn: () => T): T {
  const values = { OWNER_JURY_DIRECT_API_ENABLED: "1", OWNER_FRONTIER_REFRESH_DISABLED: "0",
    PROFUNDO_ENABLED: "0", OPENAI_GPT_62_DISABLED: "0", FABLE_52_DISABLED: "0", OPENAI_API_KEY: "sk-offline-test" };
  const prior = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, values);
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("an authorized owner frontier panel has Sol, Fable and DeepSeek on three independent lanes", () => withFlags(() => {
  const got = resolveProposerSpecs("frontier", undefined, 1, { sol: true, fable: true });
  assert.deepEqual(got.map(s => [s.modelId, s.providerLane]), [
    ["openference/deepseek-v4-pro", "openference"],
    ["gpt-6.2-sol", "openai-api"],
    ["claude-fable-5-2", "anthropic-api"],
  ]);
  assert.equal(got.some(s => s.modelId === "gpt-6.2-astra"), false);
  assert.equal(resolveProposerSpecs("frontier", undefined, 1, { sol: false, fable: true })[1].modelId, "gpt-5.4");
  assert.equal(resolveProposerSpecs("frontier", undefined, 2, { sol: true, fable: true })[1].modelId, "gpt-5.4");
  assert.equal(resolveProposerSpecs("frontier", ["gpt-5.4"], 1, { sol: true, fable: true })[0].modelId, "gpt-5.4");
  assert.equal(resolveProposerSpecs("frontier-lite", undefined, 1, { sol: true, fable: true })[1].modelId, "gpt-5.4");
}));

test("only a direct owner request can claim one panel; dispatcher provenance reset cannot mint a grant", () => withFlags(() => {
  assert.equal(claimOwnerFrontierPanel(1, true), undefined);
  for (const [tenantId, source] of [[2, "session"], [1, "background-job"], [1, "explicit"]] as const) {
    withTenantContext({ tenantId, source }, () =>
      withOwnerFrontierTurn(tenantId, true, () => assert.equal(claimOwnerFrontierPanel(tenantId, true), undefined)));
  }
  withTenantContext({ tenantId: 1, source: "session" }, () => {
    withOwnerFrontierTurn(1, false, () => assert.equal(claimOwnerFrontierPanel(1, true), undefined));
    withOwnerFrontierTurn(1, true, () => {
      assert.equal(claimOwnerFrontierPanel(1, false), undefined);
      assert.throws(() => assertOwnerFrontierDispatch(1, "gpt-6.2-sol", "openai-api"), /not authorized/);
      withTenantContext({ tenantId: 2, source: "explicit" }, () => assert.equal(claimOwnerFrontierPanel(1, true), undefined));
      withTenantContext({ tenantId: 1, source: "explicit" }, () => {
        assert.deepEqual(claimOwnerFrontierPanel(1, true), { sol: true, fable: true });
        assert.doesNotThrow(() => assertOwnerFrontierDispatch(1, "gpt-6.2-sol", "openai-api"));
        assert.throws(() => assertOwnerFrontierDispatch(1, "gpt-6.2-astra", "openai-api"), /not authorized/);
        assert.throws(() => assertOwnerFrontierDispatch(1, "claude-fable-5-2", "openai-api"), /not authorized/);
        assert.equal(claimOwnerFrontierPanel(1, true), undefined);
        process.env.OWNER_FRONTIER_REFRESH_DISABLED = "1";
        assert.throws(() => assertOwnerFrontierDispatch(1, "gpt-6.2-sol", "openai-api"), /not authorized/);
      });
    });
  });
}));

test("stop flags, no paid permission, and subscription-first are honored", () => withFlags(() => {
  withTenantContext({ tenantId: 1, source: "api-key" }, () => {
    for (const flag of ["OWNER_JURY_DIRECT_API_ENABLED", "OWNER_FRONTIER_REFRESH_DISABLED", "PROFUNDO_ENABLED"] as const) {
      const standard = process.env[flag];
      process.env[flag] = flag === "OWNER_JURY_DIRECT_API_ENABLED" ? "0" : "1";
      withOwnerFrontierTurn(1, true, () => assert.equal(claimOwnerFrontierPanel(1, true), undefined));
      process.env[flag] = standard;
    }
    process.env.FABLE_52_DISABLED = "1";
    withOwnerFrontierTurn(1, true, () => assert.deepEqual(claimOwnerFrontierPanel(1, true), { sol: true, fable: false }));
    const abort = new AbortController();
    withOwnerFrontierTurn(1, true, () => {
      claimOwnerFrontierPanel(1, true);
      abort.abort();
      assert.throws(() => assertOwnerFrontierDispatch(1, "gpt-6.2-sol", "openai-api"), /abort/i);
    }, abort.signal);
  });
}));

test("request parser distinguishes commands from mentions, discussion and negation", () => {
  for (const input of ["Run the jury on this", "[Felix line] Could you ask the jury about it?", "Please jury this"]) {
    assert.equal(explicitlyRequestsFrontierJury(input), true, input);
  }
  for (const input of ["How does the jury work?", "Don't run the jury", "Notes:\nRun the jury", "The jury was useful"]) {
    assert.equal(explicitlyRequestsFrontierJury(input), false, input);
  }
});

test("recovery retains the failed premium identity and does not buy a second call on that provider", async () => {
  const spec = { modelId: "gpt-6.2-sol", providerLane: "openai-api" } as const;
  const failed = { ...spec, provider: "openai-api", ok: false, latencyMs: 1 };
  const called: string[] = [];
  const results = await recoverSubscriptionSeats({
    specs: [spec], results: [failed], recoverPinnedSeats: true, allowPaid: true,
    avoidPaidLanes: new Set(["openai-api"]),
    eligible: s => s.providerLane === "openai-api" || s.providerLane === "anthropic-api",
    async call(s) {
      called.push(s.modelId);
      return { ...s, provider: s.providerLane!, ok: true, latencyMs: 2, answer: "alternate ballot" };
    },
  });
  assert.deepEqual(called, ["claude-sonnet-5-5"]);
  assert.equal(results[0].modelId, spec.modelId);
  assert.equal(results[0].ok, false);
  assert.equal(results[1].ok, true);
});
