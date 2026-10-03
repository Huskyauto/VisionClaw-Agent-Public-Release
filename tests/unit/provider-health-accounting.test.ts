import assert from "node:assert/strict";
import test from "node:test";
import {
  isProviderHealthy,
  markProviderUnhealthy,
  markProviderUnhealthyOnce,
  resetProviderHealth,
  resetProviderHealthForRoute,
} from "../../server/provider-recovery";
import {
  wrapOpenferenceFailureMarking,
  wrapOpenferenceRateLimitRetry,
  wrapProfundoFailureMarking,
} from "../../server/providers";

async function markExpertCatch(provider: string, request: () => Promise<unknown>) {
  try {
    await request();
  } catch (error) {
    markProviderUnhealthyOnce(provider, error, "expert catch");
  }
}

test("a Profundo request marked by both its wrapper and expert catch counts once", async () => {
  resetProviderHealth("profundo");
  try {
    const markProfundoFailure = (message: string) => {
      const failure = Object.assign(new Error(message), { status: 503 });
      const client = {
        chat: { completions: { create: async () => { throw failure; } } },
      } as any;
      const wrapped = wrapProfundoFailureMarking(client);
      return markExpertCatch("profundo", () =>
        wrapped.chat.completions.create({ model: "gpt-5.6-sol" }));
    };

    await markProfundoFailure("HTTP 503: temporarily unavailable");
    assert.equal(isProviderHealthy("profundo"), true);

    await markProfundoFailure("HTTP 503: temporarily unavailable");
    assert.equal(isProviderHealthy("profundo"), true);

    await markProfundoFailure("third distinct HTTP 503");
    assert.equal(isProviderHealthy("profundo"), false);
  } finally {
    resetProviderHealth("profundo");
  }
});

test("an Openference final failure is not double-counted by its wrapper and expert catch", async () => {
  resetProviderHealth("openference");
  try {
    const failures = [
      Object.assign(new Error("HTTP 503: first rate limit"), { status: 503 }),
      Object.assign(new Error("HTTP 503: final rate limit"), { status: 503 }),
    ];
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => { throw failures[calls++]; },
        },
      },
    } as any;
    const wrapped = wrapOpenferenceFailureMarking(
      wrapOpenferenceRateLimitRetry(client, { sleep: async () => undefined }),
    );
    await markExpertCatch("openference", () =>
      wrapped.chat.completions.create({ model: "DeepSeek-V4-Pro" }));
    assert.equal(calls, 2, "the transient 503 is retried once before final failure");
    assert.equal(isProviderHealthy("openference"), true);
  } finally {
    resetProviderHealth("openference");
  }
});

test("successful Profundo routing resets its transport lane, not registry provider replit", () => {
  resetProviderHealth("profundo");
  resetProviderHealth("replit");
  try {
    markProviderUnhealthy("profundo", "failure before success 1");
    markProviderUnhealthy("profundo", "failure before success 2");
    for (let attempt = 0; attempt < 3; attempt++) {
      markProviderUnhealthy("replit", "registry provider quarantine");
    }
    assert.equal(isProviderHealthy("profundo"), true);
    assert.equal(isProviderHealthy("replit"), false);

    resetProviderHealthForRoute("replit", "profundo");
    assert.equal(isProviderHealthy("profundo"), true);
    assert.equal(isProviderHealthy("replit"), false);

    markProviderUnhealthy("profundo", "failure after success 1");
    markProviderUnhealthy("profundo", "failure after success 2");
    assert.equal(isProviderHealthy("profundo"), true);
    markProviderUnhealthy("profundo", "failure after success 3");
    assert.equal(isProviderHealthy("profundo"), false);
  } finally {
    resetProviderHealth("profundo");
    resetProviderHealth("replit");
  }
});