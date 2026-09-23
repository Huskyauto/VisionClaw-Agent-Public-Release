import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySessionFactNeed,
  type SessionFactPrefilterAskFn,
} from "../server/lib/typesafe-fact-prefilter";

process.env.NODE_ENV = "test";
process.env.TYPESAFE_FACT_PREFILTER_TENANTS = "42";

const baseInput = {
  tenantId: 42,
  userTurn: "Thanks, that looks good.",
  assistantTurn: "You're welcome.",
};

function answer(probability: number): SessionFactPrefilterAskFn {
  return async (request) => {
    assert.deepEqual(Object.keys(request.questions), ["has_durable_fact"]);
    return {
      model: "jev-test",
      usage: { input_tokens: 40, output_tokens: 2 },
      answers: {
        has_durable_fact: { type: "noul", noul: probability },
      },
    };
  };
}

test("shadow mode observes a confident negative without skipping extraction", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "shadow";
  try {
    const result = await classifySessionFactNeed({ ...baseInput, _askFn: answer(0.01) });
    assert.equal(result.status, "validated");
    assert.equal(result.mode, "shadow");
    assert.equal(result.wouldSkip, true);
    assert.equal(result.shouldRunExtractor, true);
    assert.deepEqual(result.usage, { input_tokens: 40, output_tokens: 2 });
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});

test("enforce mode skips only a very confident negative", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "enforce";
  try {
    const negative = await classifySessionFactNeed({ ...baseInput, _askFn: answer(0.01) });
    const uncertain = await classifySessionFactNeed({ ...baseInput, _askFn: answer(0.2) });
    assert.equal(negative.shouldRunExtractor, false);
    assert.equal(negative.wouldSkip, true);
    assert.equal(uncertain.shouldRunExtractor, true);
    assert.equal(uncertain.wouldSkip, false);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});

test("unknown mode is off and makes no provider call", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "true";
  let calls = 0;
  try {
    const result = await classifySessionFactNeed({
      ...baseInput,
      _askFn: async () => {
        calls++;
        throw new Error("must not run");
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "disabled");
    assert.equal(result.shouldRunExtractor, true);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});

test("tenant must be explicitly allowlisted before any content leaves the platform", async () => {
  const priorMode = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  const priorTenants = process.env.TYPESAFE_FACT_PREFILTER_TENANTS;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "shadow";
  process.env.TYPESAFE_FACT_PREFILTER_TENANTS = "1";
  let calls = 0;
  try {
    const result = await classifySessionFactNeed({
      ...baseInput,
      _askFn: async () => {
        calls++;
        return answer(0.01)({} as any);
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "disabled");
    assert.equal(result.shouldRunExtractor, true);
  } finally {
    if (priorMode === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = priorMode;
    if (priorTenants === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_TENANTS;
    else process.env.TYPESAFE_FACT_PREFILTER_TENANTS = priorTenants;
  }
});

test("provider failure preserves the existing extractor path", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "enforce";
  try {
    const result = await classifySessionFactNeed({
      ...baseInput,
      _askFn: async () => { throw new Error("provider detail"); },
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.shouldRunExtractor, true);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});

test("preprocessing failure preserves the existing extractor path", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "enforce";
  try {
    const result = await classifySessionFactNeed({
      ...baseInput,
      userTurn: {
        toString() {
          throw new Error("preprocessing detail");
        },
      } as any,
      _askFn: answer(0.01),
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.shouldRunExtractor, true);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});

test("sensitive outbound state is withheld and extraction continues", async () => {
  const prior = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  process.env.TYPESAFE_FACT_PREFILTER_MODE = "enforce";
  let calls = 0;
  try {
    const result = await classifySessionFactNeed({
      ...baseInput,
      userTurn: "Use this value:\n-----BEGIN PRIVATE KEY-----\nnot-for-egress\n-----END PRIVATE KEY-----",
      _askFn: async () => {
        calls++;
        return answer(0.01)({} as any);
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "blocked");
    assert.equal(result.shouldRunExtractor, true);
  } finally {
    if (prior === undefined) delete process.env.TYPESAFE_FACT_PREFILTER_MODE;
    else process.env.TYPESAFE_FACT_PREFILTER_MODE = prior;
  }
});