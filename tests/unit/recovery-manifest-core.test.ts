import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRecoveryCheckpoint } from "../../server/lib/recovery-manifest-core";

describe("recovery manifest core", () => {
  it("builds a deterministic, inspect-only checkpoint without mutating input", () => {
    const state = { stage: "research", completed: ["source-a"], nested: { attempt: 2 } };
    const payload = {
      summary: "Collected one source.",
      apiKey: "must-not-persist",
      metadata: { authorization: "Bearer must-not-persist", source: "web" },
    };

    const a = buildRecoveryCheckpoint({
      tenantId: 41,
      scope: { runId: 17, traceId: "trace-abc", conversationId: 9 },
      eventType: "run.step.completed",
      eventIndex: 3,
      state,
      payload,
    });
    const b = buildRecoveryCheckpoint({
      tenantId: 41,
      scope: { conversationId: 9, traceId: "trace-abc", runId: 17 },
      eventType: "run.step.completed",
      eventIndex: 3,
      state: { nested: { attempt: 2 }, completed: ["source-a"], stage: "research" },
      payload: { metadata: { source: "web" }, summary: "Collected one source." },
    });

    assert.equal(a.idempotencyKey, b.idempotencyKey);
    assert.equal(a.stateHash, b.stateHash);
    assert.deepEqual(a.nextCursor, {
      mode: "inspect-only",
      eventIndex: 4,
      runId: 17,
      traceId: "trace-abc",
      conversationId: 9,
    });
    assert.doesNotMatch(JSON.stringify(a.payload), /must-not-persist/);
    assert.doesNotMatch(JSON.stringify(a.payload), /Collected one source|source-a|research/);
    assert.equal(payload.apiKey, "must-not-persist");
    assert.equal(state.nested.attempt, 2);
  });

  it("bounds untrusted payloads and redacts common token values", () => {
    const checkpoint = buildRecoveryCheckpoint({
      tenantId: 41,
      scope: { runId: 17 },
      eventType: "run.step.started",
      eventIndex: 0,
      state: { current: "collect" },
      payload: {
        note: `Authorization: Bearer ${"x".repeat(128)}`,
        providerKey: `sk-${"a".repeat(80)}`,
        ["user secret-token-in-object-key"]: "value",
        tooLong: "z".repeat(2_000),
        rows: Array.from({ length: 80 }, (_, index) => index),
      },
    });

    const encoded = JSON.stringify(checkpoint.payload);
    assert.doesNotMatch(encoded, /x{40}/);
    assert.doesNotMatch(encoded, /sk-a{30}/);
    assert.doesNotMatch(encoded, /secret-token-in-object-key/);
    assert.ok(encoded.length <= 8_500);
    const payloadValues = Object.values(checkpoint.payload as Record<string, unknown>);
    const boundedRows = payloadValues.find(Array.isArray);
    assert.ok(Array.isArray(boundedRows));
    assert.ok(boundedRows.length <= 33);
  });

  it("stores arbitrary string values as value-free correlation metadata", () => {
    const rawProviderError = "provider response: database://user:password@host?token=secret";
    const checkpoint = buildRecoveryCheckpoint({
      tenantId: 41,
      scope: { runId: 17 },
      eventType: "run.failed",
      eventIndex: 2,
      state: { lastError: rawProviderError },
      payload: { error: rawProviderError },
    });

    const serialized = JSON.stringify(checkpoint);
    assert.doesNotMatch(serialized, /provider response|database:|password|secret/);
    const errorMetadata = Object.values(checkpoint.payload as Record<string, Record<string, unknown>>)[0];
    assert.match(String(errorMetadata._textHash), /^[a-f0-9]{64}$/);
    assert.equal(errorMetadata._chars, rawProviderError.length);
  });

  it("rejects unsafe checkpoint identity fields instead of guessing a recovery cursor", () => {
    assert.throws(() => buildRecoveryCheckpoint({
      tenantId: 0,
      scope: {},
      eventType: "run.step",
      eventIndex: 0,
      state: {},
    }), /tenantId/);

    assert.throws(() => buildRecoveryCheckpoint({
      tenantId: 1,
      scope: {},
      eventType: "not valid spaces",
      eventIndex: 0,
      state: {},
    }), /eventType/);
  });
});