import assert from "node:assert/strict";
import test from "node:test";
import { recoverSubscriptionSeats, runSubscriptionSynthesis, subscriptionRecoveryAllowed, defaultJuryRecoveryAllowed } from "../../server/lib/subscription-jury-recovery";

const withoutSkips = (rows: any[]) => rows.map(({ recoverySkips, ...row }) => row);

test("a working MiniMax subscription seat can complete a jury without lowering its three-seat requirement", async () => {
  const specs = ["gpt-5.6-sol", "claude-sonnet-5", "moonshotai/kimi-k3"]
    .map(modelId => ({ modelId, providerLane: "profundo" as const }));
  const results = specs.map((spec, i) => ({ ...spec, provider: "profundo", ok: i === 0,
    answer: i === 0 ? "retained GPT response" : undefined, latencyMs: 1 }));
  const calls: string[] = [];
  const recovered = await recoverSubscriptionSeats({ specs, results, allowPaid: false,
    eligible: spec => spec.providerLane === "standard-compute" || spec.modelId === "openference/minimax-m3",
    call: async spec => {
      calls.push(spec.modelId);
      return { ...spec, provider: spec.providerLane!, ok: true, answer: "new owned evidence response", latencyMs: 1 };
    } });
  assert.equal(recovered.filter(r => r.ok).length, 3);
  assert.ok(calls.includes("openference/minimax-m3"));
  assert.equal(new Set(recovered.filter(r => r.ok).map(r => r.providerLane)).size, 3);
});

test("alternate-model recovery is confined to owner defaults, never explicit pins", () => {
  assert.equal(subscriptionRecoveryAllowed(true, false, "profundo"), true);
  assert.equal(subscriptionRecoveryAllowed(true, true, "profundo"), false);
  assert.equal(subscriptionRecoveryAllowed(false, false, "profundo"), false);
  assert.equal(subscriptionRecoveryAllowed(true, false, "anthropic-api"), false);
  assert.equal(defaultJuryRecoveryAllowed(true, false, "anthropic-api"), true);
  assert.equal(defaultJuryRecoveryAllowed(false, false, "anthropic-api"), false);
  assert.equal(defaultJuryRecoveryAllowed(true, true, "anthropic-api"), false);
});

test("owner default pinned seats recover across unused lanes even for investigative juries", async () => {
  const specs = [
    { modelId: "openference/deepseek-v4-pro", providerLane: "openference" as const },
    { modelId: "gpt-5.4", providerLane: "openai-api" as const },
    { modelId: "claude-sonnet-5-5", providerLane: "anthropic-api" as const },
  ];
  const original = specs.map((s, i) => ({ ...s, provider: s.providerLane,
    ok: i === 1, answer: i === 1 ? "Keep GPT" : undefined, latencyMs: 1 }));
  const calls: number[] = [];
  const recovered = await recoverSubscriptionSeats({
    specs, results: original, allowPaid: false, recoverPinnedSeats: true,
    eligible: () => true,
    call: async (s, seat) => {
      assert.equal(s.noRetry, true);
      calls.push(seat);
      return { ...s, provider: s.providerLane!, ok: true, answer: `Fresh evidence for seat ${seat}`, latencyMs: 1 };
    },
  });
  assert.deepEqual(withoutSkips(recovered.slice(0, 3)), original);
  assert.deepEqual(calls, [0, 2]);
  assert.equal(recovered.filter(r => r.ok).length, 3);
  assert.equal(new Set(recovered.filter(r => r.ok).map(r => r.providerLane)).size, 3);
});

test("Profundo outage with only GPT and Claude available uses separately budgeted Meta for the third seat", async () => {
  const specs = ["gpt-5.6-sol", "claude-sonnet-5", "moonshotai/kimi-k3"]
    .map(modelId => ({ modelId, providerLane: "profundo" as const }));
  const failed = specs.map(s => ({ ...s, provider: "profundo", ok: false, latencyMs: 1, error: "503" }));
  const calls: string[] = [];
  const recovered = await recoverSubscriptionSeats({
    specs, results: failed, allowPaid: true,
    eligible: s => ["replit", "anthropic-api", "meta-direct"].includes(s.providerLane!),
    call: async s => {
      calls.push(s.providerLane!);
      assert.equal(s.noRetry, true);
      return { ...s, provider: s.providerLane!, ok: true, answer: "Independent response", latencyMs: 1 };
    },
  });
  assert.equal(recovered.filter(r => r.ok).length, 3);
  assert.deepEqual(calls, ["replit", "anthropic-api", "meta-direct"]);
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
  assert.deepEqual(withoutSkips(recovered.slice(0, 3)), original);
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
  assert.deepEqual(withoutSkips(results.slice(0, 3)), original);
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
  assert.equal(calls.length, 5);
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
  assert.deepEqual(calls, ["claude-runner", "standard-compute", "openference", "openference", "replit", "openai-api"]);
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
  assert.equal(calls, 6);
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

test("skipped routes explain missing seats and recovery stops admitting work at its deadline", async () => {
  const spec = { modelId: "gpt-5.6-sol", providerLane: "profundo" as const };
  const original = { ...spec, provider: "profundo", ok: false, latencyMs: 0 };
  let clock = 0;
  let calls = 0;
  const rows = await recoverSubscriptionSeats({
    specs: [spec], results: [original], allowPaid: false, eligible: () => true,
    now: () => clock, budgetMs: 20,
    call: async s => {
      calls++;
      assert.equal(s.timeoutMs, 20);
      clock = 21;
      return { ...original, modelId: s.modelId, providerLane: s.providerLane, error: "timeout" };
    },
  });
  assert.equal(calls, 1);
  assert.ok(rows[0].recoverySkips?.some(s => s.reason === "recovery-deadline"));
  assert.ok(rows[0].recoverySkips?.some(s => s.providerLane === "meta-direct" && s.reason === "paid-backup-not-authorized"));
});
