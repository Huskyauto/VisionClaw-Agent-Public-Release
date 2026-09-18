import test from "node:test";
import assert from "node:assert/strict";
import { askTypeSafeJev, TYPESAFE_JEV_ENDPOINT } from "../server/typesafe-jev";
import { typesafeJevDefinition } from "../server/tools/domains/typesafe-jev/definitions";

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

test("Jev accepts and sends documented optional Noul criteria", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  let capturedBody: unknown;
  try {
    await askTypeSafeJev({
      state: "The request asks for an immediate refund.",
      questions: {
        requests_refund: {
          type: "noul",
          instructions: "Is the customer requesting a refund?",
          criteria: {
            true: "The customer explicitly asks for money back",
            false: "The customer does not ask for money back",
          },
        },
      },
    }, (async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { requests_refund: { type: "noul", noul: 0.99 } },
        usage: { input_tokens: 12, output_tokens: 3 },
      }));
    }) as typeof fetch);

    assert.deepEqual(
      (capturedBody as any).questions.requests_refund.criteria,
      {
        true: "The customer explicitly asks for money back",
        false: "The customer does not ask for money back",
      },
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev tool schema exposes documented optional Noul criteria", () => {
  const schema = JSON.stringify(typesafeJevDefinition.function.parameters);
  assert.match(schema, /"true"/);
  assert.match(schema, /"false"/);
});

test("Jev preserves the documented Score probability distribution", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    const result = await askTypeSafeJev({
      state: "The customer says this has failed repeatedly and is costing sales.",
      questions: {
        frustration: {
          type: "score",
          instructions: "How frustrated is the customer?",
          criteria: ["Calm", "Frustrated", "Very angry"],
        },
      },
    }, (async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: {
        frustration: {
          type: "score",
          score: 1.6,
          legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
          probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 },
          confidence: 0.78,
        },
      },
      usage: { input_tokens: 15, output_tokens: 5 },
    }))) as typeof fetch);

    assert.deepEqual(result.answers.frustration.probabilities, {
      "0": 0.05,
      "1": 0.3,
      "2": 0.65,
    });
    assert.deepEqual(result.answers.frustration.legend, {
      "0": "Calm",
      "1": "Frustrated",
      "2": "Very angry",
    });
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects a malformed Score probability distribution", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: {
          fit: {
            type: "score",
            instructions: "How strong is the fit?",
            criteria: ["Weak", "Moderate", "Strong"],
          },
        },
      }, (async () => new Response(JSON.stringify({
        model: "jev-latest",
        answers: {
          fit: {
            type: "score",
            score: 1,
            legend: { "0": "Weak", "1": "Moderate", "2": "Strong" },
            probabilities: { "0": 0.9, "1": 0.9, "2": 0.9 },
            confidence: 0.8,
          },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      }))) as typeof fetch),
      /probabilities must sum to 1/,
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects an incomplete Score answer", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: {
          fit: {
            type: "score",
            instructions: "How strong is the fit?",
            criteria: ["Weak", "Strong"],
          },
        },
      }, (async () => new Response(JSON.stringify({
        model: "jev-latest",
        answers: {
          fit: { type: "score", score: 1, confidence: 0.9 },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      }))) as typeof fetch),
      /incomplete score/,
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects a Score that contradicts its probability distribution", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: {
          fit: {
            type: "score",
            instructions: "How strong is the fit?",
            criteria: ["Weak", "Moderate", "Strong"],
          },
        },
      }, (async () => new Response(JSON.stringify({
        model: "jev-latest",
        answers: {
          fit: {
            type: "score",
            score: 2,
            legend: { "0": "Weak", "1": "Moderate", "2": "Strong" },
            probabilities: { "0": 1, "1": 0, "2": 0 },
            confidence: 1,
          },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      }))) as typeof fetch),
      /score contradicts probabilities/,
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev accepts valid Score distributions with double-digit level indexes", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  const criteria = Array.from({ length: 11 }, (_, index) => `Level ${index}`);
  const probabilities = Object.fromEntries(criteria.map((_, index) => [String(index), index === 10 ? 1 : 0]));
  const legend = Object.fromEntries(criteria.map((criterion, index) => [String(index), criterion]));
  try {
    const result = await askTypeSafeJev({
      state: "A bounded state",
      questions: {
        fit: { type: "score", instructions: "How strong is the fit?", criteria },
      },
    }, (async () => new Response(JSON.stringify({
      model: "jev-latest",
      answers: {
        fit: { type: "score", score: 10, legend, probabilities, confidence: 1 },
      },
      usage: { input_tokens: 20, output_tokens: 12 },
    }))) as typeof fetch);
    assert.equal(result.answers.fit.score, 10);
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects an incomplete documented response envelope", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: { fit: { type: "noul", instructions: "Is this a fit?" } },
      }, (async () => new Response(JSON.stringify({
        answers: { fit: { type: "noul", noul: 0.9 } },
      }))) as typeof fetch),
      /missing model or usage/,
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects a Choice value inherited from Object.prototype", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: {
          route: {
            type: "choice",
            instructions: "Which route applies?",
            criteria: { research: "Research work", operations: "Operations work" },
          },
        },
      }, (async () => new Response(JSON.stringify({
        model: "jev-latest",
        answers: {
          route: {
            type: "choice",
            choice: "toString",
            probabilities: { research: 0.5, operations: 0.5 },
            confidence: 0.5,
          },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      }))) as typeof fetch),
      /invalid choice/,
    );
  } finally {
    if (priorKey === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = priorKey;
    if (priorEnabled === undefined) delete process.env.TYPESAFE_JEV_ENABLED; else process.env.TYPESAFE_JEV_ENABLED = priorEnabled;
  }
});

test("Jev rejects a Choice that is not the highest-probability option", async () => {
  const priorKey = process.env.TYPESAFE_API_KEY;
  const priorEnabled = process.env.TYPESAFE_JEV_ENABLED;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_JEV_ENABLED = "1";
  try {
    await assert.rejects(
      askTypeSafeJev({
        state: "A bounded state",
        questions: {
          route: {
            type: "choice",
            instructions: "Which route applies?",
            criteria: { research: "Research work", operations: "Operations work" },
          },
        },
      }, (async () => new Response(JSON.stringify({
        model: "jev-latest",
        answers: {
          route: {
            type: "choice",
            choice: "operations",
            probabilities: { research: 0.9, operations: 0.1 },
            confidence: 0.8,
          },
        },
        usage: { input_tokens: 10, output_tokens: 3 },
      }))) as typeof fetch),
      /choice contradicts probabilities/,
    );
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
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: { fit: { type: "noul", noul: 2, authorize: true } },
          usage: { input_tokens: 10, output_tokens: 2 },
        }));
      }) as typeof fetch),
      /unexpected fields/,
    );
    assert.equal(calls, 1, "provider failures must not retry");
    await assert.rejects(
      askTypeSafeJev(input, (async () => {
        calls++;
        return new Response(JSON.stringify({
          model: "jev-latest",
          answers: {
            fit: { type: "noul", noul: 0.8 },
            authorize: { type: "noul", noul: 1 },
          },
          usage: { input_tokens: 10, output_tokens: 3 },
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