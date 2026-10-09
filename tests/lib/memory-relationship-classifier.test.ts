import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryRelationshipClassifier } from "../../server/lib/memory-relationship-classifier";

const pair = {
  tenantId: 2, personaId: 3,
  newFact: "Works at Globex", existingFact: "Works at Acme",
};
const valid = '{"relation":"update","certainty":"high"}';

test("identical scoped facts reuse a valid classification without a second AI call", async () => {
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => { calls++; return valid; });
  assert.deepEqual(await classifier.classify(pair), { relation: "update", confidence: 0.9 });
  assert.deepEqual(await classifier.classify({ ...pair }), { relation: "update", confidence: 0.9 });
  assert.equal(calls, 1);
});

test("malformed categorical results cannot trigger updates or become reusable judgments", async () => {
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => {
    calls++;
    return calls === 1 ? '{"relation":"update","certainty":"certain"}' : valid;
  });
  assert.deepEqual(await classifier.classify(pair), { relation: "unrelated", confidence: 0 });
  assert.deepEqual(await classifier.classify(pair), { relation: "update", confidence: 0.9 });
  assert.equal(calls, 2);
});

test("overlapping identical fact pairs share one inference request", async () => {
  let calls = 0;
  let finish!: (content: string) => void;
  const classifier = createMemoryRelationshipClassifier(async () => {
    calls++;
    return new Promise<string>(resolve => { finish = resolve; });
  });
  const first = classifier.classify(pair);
  const second = classifier.classify({ ...pair });
  assert.equal(calls, 1);
  finish(valid);
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]);
});

test("tenant, specialist, fact order and exact text changes cannot share judgments", async () => {
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => { calls++; return valid; });
  const cases = [
    pair,
    { ...pair, tenantId: 4 },
    { ...pair, personaId: 5 },
    { ...pair, personaId: null },
    { ...pair, newFact: pair.existingFact, existingFact: pair.newFact },
    { ...pair, newFact: `${pair.newFact} ` },
    { ...pair, existingFact: `${pair.existingFact}!` },
  ];
  for (const input of cases) await classifier.classify(input);
  assert.equal(calls, cases.length);
  for (const input of cases) await classifier.classify(input);
  assert.equal(calls, cases.length);
});

test("absent or invalid tenant/persona scope bypasses reuse, never defaults to owner", async () => {
  for (const input of [
    { ...pair, tenantId: undefined }, { ...pair, tenantId: 0 },
    { ...pair, tenantId: -1 }, { ...pair, tenantId: NaN },
    { ...pair, tenantId: 1.5 }, { ...pair, tenantId: Number.MAX_SAFE_INTEGER + 1 },
    { ...pair, personaId: 0 }, { ...pair, personaId: 1.5 },
  ]) {
    let calls = 0;
    const classifier = createMemoryRelationshipClassifier(async () => { calls++; return valid; });
    await classifier.classify(input);
    await classifier.classify(input);
    assert.equal(calls, 2);
  }
});

test("omitted/undefined specialist scope bypasses reuse and cannot share with explicit null", async () => {
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => { calls++; return valid; });
  const { personaId: _persona, ...omitted } = pair;
  await classifier.classify(omitted);
  await classifier.classify({ ...pair, personaId: undefined });
  assert.equal(calls, 2);
  await classifier.classify({ ...pair, personaId: null });
  await classifier.classify({ ...pair, personaId: null });
  assert.equal(calls, 3);
});

test("five-minute expiry is absolute even when the result is repeatedly accessed", async () => {
  let time = 0, calls = 0;
  const classifier = createMemoryRelationshipClassifier(
    async () => { calls++; return valid; }, { now: () => time },
  );
  await classifier.classify(pair);
  time = 299_999;
  await classifier.classify(pair);
  assert.equal(calls, 1);
  time = 300_000;
  await classifier.classify(pair);
  assert.equal(calls, 2);
});

test("128-entry LRU evicts old judgments instead of growing indefinitely", async () => {
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => { calls++; return valid; });
  await classifier.classify(pair);
  for (let i = 0; i < 127; i++) await classifier.classify({ ...pair, newFact: `fact ${i}` });
  await classifier.classify(pair); // keep this one; fact 0 is now oldest
  await classifier.classify({ ...pair, newFact: "overflow" });
  await classifier.classify(pair);
  assert.equal(calls, 129);
  await classifier.classify({ ...pair, newFact: "fact 0" });
  assert.equal(calls, 130);
});

test("errors, empty/malformed JSON, unknown enums and numeric certainty are never cached", async () => {
  for (const invalid of [
    null, "", "{", "null", "[]", "{}", '{"relation":"invented","certainty":"high"}',
    '{"relation":"update","certainty":0.9}', '{"relation":"duplicate","certainty":["high"]}',
  ]) {
    let calls = 0;
    const classifier = createMemoryRelationshipClassifier(async () => { calls++; return invalid; });
    assert.deepEqual(await classifier.classify(pair), { relation: "unrelated", confidence: 0 });
    await classifier.classify(pair);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const classifier = createMemoryRelationshipClassifier(async () => {
    if (++calls === 1) throw new Error("private provider diagnostic");
    return valid;
  });
  await classifier.classify(pair);
  await classifier.classify(pair);
  await classifier.classify(pair);
  assert.equal(calls, 2);
});

test("valid categorical confidence retains the existing action thresholds", async () => {
  for (const [certainty, confidence] of [["high", 0.9], ["medium", 0.65], ["low", 0.3]] as const) {
    const classifier = createMemoryRelationshipClassifier(async () =>
      JSON.stringify({ relation: "contradiction", certainty }));
    assert.deepEqual(await classifier.classify(pair), { relation: "contradiction", confidence });
  }
});

test("disabled reuse clears prior judgments; re-enabling starts fresh", async () => {
  let reuse = true, calls = 0;
  const classifier = createMemoryRelationshipClassifier(
    async () => { calls++; return valid; }, { enabled: () => reuse },
  );
  await classifier.classify(pair);
  await classifier.classify(pair);
  reuse = false;
  await classifier.classify(pair);
  await classifier.classify(pair);
  assert.equal(calls, 3);
  reuse = true;
  await classifier.classify(pair);
  await classifier.classify(pair);
  assert.equal(calls, 4);
});

test("disabled reuse clears overlapping requests and old results cannot repopulate it", async () => {
  let reuse = true, calls = 0;
  const finish: Array<(content: string) => void> = [];
  const classifier = createMemoryRelationshipClassifier(async () => {
    calls++;
    return new Promise<string>(resolve => finish.push(resolve));
  }, { enabled: () => reuse });
  const old = classifier.classify(pair);
  reuse = false;
  const disabled = classifier.classify(pair);
  reuse = true;
  finish[0](valid);
  finish[1](valid);
  await Promise.all([old, disabled]);
  const fresh = classifier.classify(pair);
  assert.equal(calls, 3);
  finish[2](valid);
  await fresh;
});

test("callers cannot mutate the cached or coalesced result for another caller", async () => {
  const classifier = createMemoryRelationshipClassifier(async () => valid);
  const [a, b] = await Promise.all([classifier.classify(pair), classifier.classify(pair)]);
  a.relation = "unrelated";
  a.confidence = 0;
  assert.deepEqual(b, { relation: "update", confidence: 0.9 });
  assert.deepEqual(await classifier.classify(pair), b);
});

test("cache events carry no facts, tenant identifiers or provider error text", async () => {
  const events: string[] = [];
  const classifier = createMemoryRelationshipClassifier(async () => valid, {
    onEvent: event => events.push(event),
  });
  await classifier.classify(pair);
  await classifier.classify(pair);
  assert.deepEqual(events, ["cache-miss", "cache-hit"]);
  assert.ok(!JSON.stringify(events).includes(pair.newFact));
});

test("in-flight bookkeeping is bounded; excess calls fall back to ordinary inference", async () => {
  let calls = 0;
  const finish: Array<(content: string) => void> = [];
  const classifier = createMemoryRelationshipClassifier(async () => {
    calls++;
    return new Promise<string>(resolve => finish.push(resolve));
  });
  const pending = Array.from({ length: 129 }, (_, i) =>
    classifier.classify({ ...pair, newFact: `parallel ${i}` }));
  pending.push(classifier.classify({ ...pair, newFact: "parallel 0" }));
  pending.push(classifier.classify({ ...pair, newFact: "parallel 128" }));
  assert.equal(calls, 130);
  for (const resolve of finish) resolve(valid);
  await Promise.all(pending);
});