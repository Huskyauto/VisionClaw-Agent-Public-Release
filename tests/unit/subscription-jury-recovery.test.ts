import assert from "node:assert/strict";
import test from "node:test";
import { recoverSubscriptionSeats, runSubscriptionSynthesis, subscriptionRecoveryAllowed } from "../../server/lib/subscription-jury-recovery";

test("alternate-model recovery is confined to owner defaults, never explicit pins", () => {
  assert.equal(subscriptionRecoveryAllowed(true, false, "profundo"), true);
  assert.equal(subscriptionRecoveryAllowed(true, true, "profundo"), false);
  assert.equal(subscriptionRecoveryAllowed(false, false, "profundo"), false);
  assert.equal(subscriptionRecoveryAllowed(true, false, "anthropic-api"), false);
});

test("Standard Compute recovers a missing seat before any paid API while retaining successful work", async () => {
  const specs = ["gpt-5.6-sol", "claude-sonnet-5", "moonshotai/kimi-k3"]
    .map(modelId => ({ modelId, providerLane: "profundo" as const }));
  const original = specs.map((s, i) => ({ ...s, provider: "profundo", ok: i < 2,
    answer: i < 2 ? `Keep original ${i}` : undefined, latencyMs: 1 }));
  const calls: string[] = [];
  const recovered = await recoverSubscriptionSeats({
    specs, results: original, allowPaid: true,
    eligible: s => s.providerLane !== "claude-runner",
    call: async s => {
      calls.push(s.providerLane!);
      return { ...s, provider: s.providerLane!, ok: s.providerLane === "standard-compute",
        answer: s.providerLane === "standard-compute" ? "Pinned Gemini recovery" : undefined, latencyMs: 1 };
    },
  });
  assert.deepEqual(recovered.slice(0, 3), original);
  assert.deepEqual(calls, ["standard-compute"]);
  assert.equal(recovered.filter(r => r.ok).length, 3);
  assert.equal(recovered.at(-1)?.modelId, "gemini-3.1-pro-preview");
});

test("a total subscription outage recovers all seats without losing original failures", async () => {
  const specs = ["gpt-5.6-sol", "claude-sonnet-5", "moonshotai/kimi-k3"]
    .map(modelId => ({ modelId, providerLane: "profundo" as const }));
  const original = specs.map(s => ({ ...s, provider: "profundo", ok: false, latencyMs: 1, error: "HTTP 503" }));
  const calls: string[] = [];
  const results = await recoverSubscriptionSeats({
    specs, results: original, allowPaid: false, eligible: () => true,
    call: async spec => {
      calls.push(spec.modelId);
      return { ...spec, provider: spec.providerLane!, ok: true, answer: "A substantive independent answer.", latencyMs: 1 };
    },
  });
  assert.deepEqual(results.slice(0, 3), original);
  assert.equal(results.filter(r => r.ok).length, 3);
  assert.equal(new Set(results.filter(r => r.ok).map(r => r.providerLane)).size, 3);
  assert.equal(calls.length, 3);
  assert.ok(results.filter(r => r.ok).every(r => r.routeReason?.startsWith("subscription-recovery:")));
});

test("synthesis survives both the primary provider and first backup failing", async () => {
  const calls: string[] = [];
  const outcome = await runSubscriptionSynthesis({
    primary: { modelId: "claude-opus-5", providerLane: "profundo" },
    allowPaid: false, eligible: () => true,
    call: async spec => {
      calls.push(spec.providerLane!);
      if (spec.providerLane !== "openference") throw new Error("503");
      return { answer: "Completed combined answer", providerLane: spec.providerLane };
    },
  });
  assert.deepEqual(calls, ["profundo", "claude-runner", "standard-compute", "openference"]);
  assert.equal(outcome.result.answer, "Completed combined answer");
  assert.deepEqual(outcome.attempts.map(a => a.ok), [false, false, false, true]);
});

test("partial outages keep good answers and never call a backup twice", async () => {
  const specs = ["gpt-5.6-sol", "claude-sonnet-5", "moonshotai/kimi-k3"]
    .map(modelId => ({ modelId, providerLane: "profundo" as const }));
  const results = specs.map((s, i) => ({ ...s, provider: "profundo", ok: i === 0,
    answer: i === 0 ? "Keep this original answer" : undefined, latencyMs: 1 }));
  const calls: string[] = [];
  const recovered = await recoverSubscriptionSeats({ specs, results, allowPaid: false, eligible: () => true,
    call: async spec => {
      calls.push(`${spec.providerLane}:${spec.modelId}`);
      return { ...spec, provider: spec.providerLane!, ok: false, error: "Unavailable", latencyMs: 1 };
    } });
  assert.equal(recovered[0].answer, "Keep this original answer");
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls).size, calls.length);
  assert.ok(calls.every(c => !/openai-api|anthropic-api/.test(c)));
});

test("paid backups only fire when permitted, after free routes fail", async () => {
  const spec = { modelId: "gpt-5.6-sol", providerLane: "profundo" as const };
  const calls: string[] = [];
  const results = await recoverSubscriptionSeats({
    specs: [spec], results: [{ ...spec, provider: "profundo", ok: false, latencyMs: 0 }],
    allowPaid: true, eligible: () => true,
    call: async s => {
      calls.push(s.providerLane!);
      return { ...s, provider: s.providerLane!, ok: s.providerLane === "openai-api",
        answer: s.providerLane === "openai-api" ? "Native recovery" : undefined, latencyMs: 1 };
    },
  });
  assert.deepEqual(calls, ["claude-runner", "standard-compute", "openference", "replit", "openai-api"]);
  assert.equal(results.at(-1)?.answer, "Native recovery");
});

test("healthy subscription synthesis makes no backup inference calls", async () => {
  let calls = 0;
  const result = await runSubscriptionSynthesis({ primary: { modelId: "claude-opus-5", providerLane: "profundo" },
    allowPaid: true, eligible: () => true, call: async () => { calls++; return "Finished"; } });
  assert.equal(calls, 1);
  assert.equal(result.result, "Finished");
});

test("total synthesis failure terminates after all permitted routes", async () => {
  let calls = 0;
  await assert.rejects(() => runSubscriptionSynthesis({
    primary: { modelId: "claude-opus-5", providerLane: "profundo" },
    allowPaid: false, eligible: () => true, call: async () => { calls++; throw new Error("503"); },
  }), /503/);
  assert.equal(calls, 5);
});

test("telemetry and one readiness failure cannot destroy a completed synthesis", async () => {
  let calls = 0;
  const outcome = await runSubscriptionSynthesis({
    primary: { modelId: "claude-opus-5", providerLane: "profundo" },
    allowPaid: false,
    eligible: s => { if (s.providerLane === "claude-runner") throw new Error("readiness broken"); return true; },
    call: async () => { calls++; return "Completed"; },
    onAttempt: () => { throw new Error("logger broken"); },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.result, "Completed");
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.attempts[0].ok, true);
});
