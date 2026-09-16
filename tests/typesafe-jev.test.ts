import test from "node:test";
import assert from "node:assert/strict";
import { askTypeSafeJev, TYPESAFE_JEV_ENDPOINT } from "../server/typesafe-jev";

test("Jev sends the documented state and keyed-question contract in one bounded request", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key-not-a-secret";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  let calls = 0;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({
      model: "jev-latest",
      answers: {
        route: {
          type: "choice",
          choice: "research",
          probabilities: { research: 0.9, operations: 0.1 },
          confidence: 0.8,
        },
      },
      usage: { input_tokens: 25, output_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await askTypeSafeJev({
      state: "A customer asks for current market evidence.",
      questions: {
        route: {
          type: "choice",
          instructions: "Which workflow should handle this?",
          criteria: {
            research: "External investigation is required",
            operations: "An operational change is required",
          },
        },
      },
    }, fetchMock as typeof fetch);

    assert.equal(calls, 1);
    assert.equal(capturedUrl, TYPESAFE_JEV_ENDPOINT);
    assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer test-key-not-a-secret");
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      model: "jev-latest",
      state: "A customer asks for current market evidence.",
      questions: {
        route: {
          type: "choice",
          instructions: "Which workflow should handle this?",
          criteria: {
            research: "External investigation is required",
            operations: "An operational change is required",
          },
        },
      },
    });
    assert.equal(result.answers.route.type, "choice");
    assert.equal(result.answers.route.choice, "research");
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED;
    else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev requires both the exact opt-in flag and a key before any network call", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  let calls = 0;
  const fetchMock = async () => { calls++; return new Response("{}"); };
  const input = { state: "Bounded state", questions: { fit: { type: "noul", instructions: "Is this a fit?" } } };
  try {
    delete process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_JEV_ENABLED = "1";
    await assert.rejects(askTypeSafeJev(input, fetchMock as typeof fetch), /not configured/);
    process.env.TYPESAFE_API_KEY = "test-key";
    process.env.TYPESAFE_JEV_ENABLED = "true";
    await assert.rejects(askTypeSafeJev(input, fetchMock as typeof fetch), /disabled/);
    assert.equal(calls, 0);
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev validates bounds and provider responses without retrying", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  let calls = 0;
  const input = { state: "Bounded state", questions: { fit: { type: "noul", instructions: "Is this a fit?" } } };
  try {
    await assert.rejects(
      askTypeSafeJev({ ...input, state: "x".repeat(12_001) }, (async () => { calls++; return new Response("{}"); }) as typeof fetch),
      /at most 12000/,
    );
    assert.equal(calls, 0);
    await assert.rejects(
      askTypeSafeJev(input, (async () => {
        calls++;
        return new Response(JSON.stringify({ answers: { fit: { type: "noul", noul: 2, authorize: true } } }));
      }) as typeof fetch),
      /unexpected fields/,
    );
    assert.equal(calls, 1, "provider failures must not retry");
    await assert.rejects(
      askTypeSafeJev(input, (async () => {
        calls++;
        return new Response(JSON.stringify({
          answers: {
            fit: { type: "noul", noul: 0.8 },
            authorize: { type: "noul", noul: 1 },
          },
        }));
      }) as typeof fetch),
      /unexpected answer keys/,
    );
    assert.equal(calls, 2);
    await assert.rejects(
      askTypeSafeJev(input, (async () => {
        calls++;
        return new Response("nope", { status: 503 });
      }) as typeof fetch),
      /provider returned 503/,
    );
    assert.equal(calls, 3, "each invocation makes at most one provider call");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      askTypeSafeJev(input, (async (_url, init) => {
        calls++;
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return new Response("{}");
      }) as typeof fetch, controller.signal),
      /request cancelled/,
    );
    assert.equal(calls, 4);
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});