import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_REGISTRY } from "../../server/model-registry";
import {
  clearClientCache,
  createOpenferenceStartGate,
  getClientForModel,
  getTestModelForProvider,
  wrapOpenferenceRateLimitRetry,
} from "../../server/providers";

test("Openference DeepSeek V4 Pro is registered as a zero-marginal-cost model", () => {
  const model = MODEL_REGISTRY.find((entry) => entry.id === "openference/deepseek-v4-pro");

  assert.ok(model, "the Openference DeepSeek V4 Pro model should be selectable");
  assert.equal(model.provider, "openference");
  assert.equal(model.costClass, "free");
});

test("a configured Openference key resolves DeepSeek V4 Pro through its live upstream ID", async () => {
  const priorKey = process.env.OPENFERENCE_API_KEY;
  process.env.OPENFERENCE_API_KEY = "sk-of-test-key-for-openference-routing";
  clearClientCache();

  try {
    const resolved = await getClientForModel("openference/deepseek-v4-pro", 1);
    assert.equal(resolved.actualModelId, "DeepSeek-V4-Pro");
  } finally {
    if (priorKey === undefined) delete process.env.OPENFERENCE_API_KEY;
    else process.env.OPENFERENCE_API_KEY = priorKey;
    clearClientCache();
  }
});

test("the provider health probe uses the routed Openference model ID", () => {
  assert.equal(getTestModelForProvider("openference"), "openference/deepseek-v4-pro");
});

test("Openference only paces request starts, so a stalled completion does not block the next start", async () => {
  const gate = createOpenferenceStartGate({ intervalMs: 20, queueTimeoutMs: 200 });
  await gate.waitForStart();

  const neverSettles = new Promise<void>(() => {});
  const stalledCompletion = gate.waitForStart().then(() => neverSettles);
  let secondStarted = false;
  const nextCompletion = gate.waitForStart().then(() => {
    secondStarted = true;
  });

  await nextCompletion;
  assert.equal(secondStarted, true);
  void stalledCompletion;
});

test("Openference rejects an aborted request while it is waiting for a paced start", async () => {
  const gate = createOpenferenceStartGate({ intervalMs: 100, queueTimeoutMs: 200 });
  await gate.waitForStart();

  const controller = new AbortController();
  const queuedStart = gate.waitForStart(controller.signal);
  controller.abort();

  await assert.rejects(queuedStart, /aborted/i);
});

test("Openference retries one rate-limited 503 after the provider Retry-After delay", async () => {
  const waits: number[] = [];
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          if (calls === 1) {
            const error: any = new Error("temporarily unavailable");
            error.status = 503;
            error.headers = new Headers({ "retry-after": "1" });
            throw error;
          }
          return { choices: [{ message: { content: "recovered" } }] };
        },
      },
    },
  } as any;
  const wrapped = wrapOpenferenceRateLimitRetry(client, {
    sleep: async (ms) => { waits.push(ms); },
    random: () => 0.5,
  });

  const result = await wrapped.chat.completions.create({ model: "DeepSeek-V4-Pro" });
  assert.equal(result.choices[0].message.content, "recovered");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1_000]);
});

test("Openference does not retry an ambiguous timeout", async () => {
  let calls = 0;
  const timeout = Object.assign(new Error("request timed out"), { name: "APIConnectionTimeoutError" });
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          throw timeout;
        },
      },
    },
  } as any;
  const wrapped = wrapOpenferenceRateLimitRetry(client, {
    sleep: async () => assert.fail("timeouts must not be retried"),
  });

  await assert.rejects(wrapped.chat.completions.create({ model: "DeepSeek-V4-Pro" }), timeout);
  assert.equal(calls, 1);
});

test("Openference does not retry rate-limit statuses with transport-ambiguous SDK errors", async () => {
  const errors = [
    Object.assign(new Error("request timed out"), {
      status: 503,
      name: "APIConnectionTimeoutError",
    }),
    Object.assign(new Error("connection reset"), {
      status: 429,
      cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    }),
  ];
  for (const originalError of errors) {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls++;
            throw originalError;
          },
        },
      },
    } as any;
    const wrapped = wrapOpenferenceRateLimitRetry(client, {
      sleep: async () => assert.fail("transport-ambiguous responses must not be retried"),
    });

    await assert.rejects(
      wrapped.chat.completions.create({ model: "DeepSeek-V4-Pro" }),
      (error: unknown) => error === originalError,
    );
    assert.equal(calls, 1);
  }
});

test("Openference parses HTTP-date Retry-After and defers if the delay exceeds its bound", async () => {
  const now = Date.parse("2026-10-01T00:00:00.000Z");
  const waits: number[] = [];
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          if (calls === 1) {
            const error: any = new Error("temporarily unavailable");
            error.status = 503;
            error.headers = new Headers({
              "retry-after": new Date(now + 4_000).toUTCString(),
            });
            throw error;
          }
          return { choices: [{ message: { content: "recovered" } }] };
        },
      },
    },
  } as any;
  const wrapped = wrapOpenferenceRateLimitRetry(client, {
    sleep: async (ms) => { waits.push(ms); },
    now: () => now,
    random: () => 0.5,
  });
  await wrapped.chat.completions.create({ model: "DeepSeek-V4-Pro" });
  assert.deepEqual(waits, [4_000]);

  calls = 0;
  const deferredClient = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          const error: any = new Error("temporarily unavailable");
          error.status = 503;
          error.headers = new Headers({ "retry-after": "21" });
          throw error;
        },
      },
    },
  } as any;
  const deferred = wrapOpenferenceRateLimitRetry(deferredClient, {
    sleep: async () => assert.fail("do not retry before Retry-After"),
  });
  await assert.rejects(deferred.chat.completions.create({ model: "DeepSeek-V4-Pro" }), /temporarily unavailable/);
  assert.equal(calls, 1);
});