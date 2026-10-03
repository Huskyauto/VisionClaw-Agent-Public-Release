import assert from "node:assert/strict";
import test from "node:test";
import {
  FelixExpertContextRejectedError,
  FelixExpertFailureHistory,
  FelixExpertRejectedError,
  getFelixExpertFailureReason,
} from "../../server/felix-expert-route";

function exhaustedReason(errors: Array<{ error: unknown; contextRejected?: boolean }>) {
  const history = new FelixExpertFailureHistory();
  for (const { error, contextRejected } of errors) history.record(error, contextRejected);
  const exhausted = history.toExhaustedError();
  return { exhausted, persistedReason: getFelixExpertFailureReason(exhausted) };
}

test("a final timeout survives expert exhaustion into API-v1 persistence classification", () => {
  const outcome = exhaustedReason([{ error: Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }) }]);
  assert.equal((outcome.exhausted as any)?.code, "expert_provider_uncertain");
  assert.equal(outcome.persistedReason, "expert_provider_uncertain");
});

test("an earlier ambiguous completion keeps an exhausted 503 ladder uncertain", () => {
  const outcome = exhaustedReason([
    { error: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) },
    { error: Object.assign(new Error("HTTP 503"), { status: 503 }) },
  ]);
  assert.equal((outcome.exhausted as any)?.code, "expert_provider_uncertain");
  assert.equal(outcome.persistedReason, "expert_provider_uncertain");
});

test("an explicitly settled 503-only ladder persists as provider rejected", () => {
  const outcome = exhaustedReason([
    { error: Object.assign(new Error("HTTP 503"), { status: 503 }) },
    { error: Object.assign(new Error("HTTP 503"), { status: 503 }) },
  ]);
  assert.equal((outcome.exhausted as any)?.code, "expert_provider_rejected");
  assert.equal(outcome.persistedReason, "expert_provider_rejected");
});

test("an otherwise unclassified 500 response remains completion-uncertain", () => {
  const outcome = exhaustedReason([
    { error: Object.assign(new Error("internal server error"), { status: 500 }) },
  ]);
  assert.equal((outcome.exhausted as any)?.code, "expert_provider_uncertain");
  assert.equal(outcome.persistedReason, "expert_provider_uncertain");
});

test("SDK timeout name dominates 503 and context-rejection hints", () => {
  const outcome = exhaustedReason([{
    error: Object.assign(new Error("provider response unavailable"), {
      name: "APIConnectionTimeoutError",
      status: 503,
    }),
    contextRejected: true,
  }]);
  assert.equal((outcome.exhausted as any)?.code, "expert_provider_uncertain");
  assert.equal(outcome.persistedReason, "expert_provider_uncertain");
});

test("transport code or name on cause dominates settled status hints", () => {
  for (const cause of [{ code: "ETIMEDOUT" }, { name: "TimeoutError" }]) {
    const outcome = exhaustedReason([{
      error: Object.assign(new Error("provider response unavailable"), { status: 503, cause }),
      contextRejected: true,
    }]);
    assert.equal(outcome.persistedReason, "expert_provider_uncertain");
  }
});

test("context-only exhaustion has a new provenance-safe reason", () => {
  const outcome = exhaustedReason([
    { error: Object.assign(new Error("context length exceeded"), { status: 413 }), contextRejected: true },
  ]);
  assert.equal((outcome.exhausted as any)?.code, "expert_context_rejected");
  assert.equal(outcome.persistedReason, "expert_context_rejected");
});

test("context heuristics without a settled client rejection remain uncertain", () => {
  const serverError = exhaustedReason([{
    error: Object.assign(new Error("context length exceeded"), { status: 500 }),
    contextRejected: true,
  }]);
  assert.equal(serverError.persistedReason, "expert_provider_uncertain");

  const noStatus = exhaustedReason([{
    error: new Error("generic completion failure"),
    contextRejected: true,
  }]);
  assert.equal(noStatus.persistedReason, "expert_provider_uncertain");
});

test("an explicit HTTP 400 context-code rejection remains context-rejected", () => {
  const outcome = exhaustedReason([{
    error: Object.assign(new Error("request rejected"), {
      status: 400,
      code: "context_length_exceeded",
    }),
    contextRejected: true,
  }]);
  assert.equal(outcome.persistedReason, "expert_context_rejected");
});

test("no completion attempts leave initial client unavailability on the legacy blocked code", () => {
  const outcome = exhaustedReason([]);
  assert.equal(outcome.exhausted, undefined);
  assert.equal(getFelixExpertFailureReason({ code: "expert_provider_unavailable" }), "expert_provider_unavailable");
  assert.equal(getFelixExpertFailureReason({ code: "expert_context_limit" }), "expert_context_limit");
});

test("only trusted server-created rejected errors certify recoverable provenance", () => {
  assert.equal(getFelixExpertFailureReason({ code: "expert_provider_rejected" }), undefined);
  assert.equal(getFelixExpertFailureReason({ code: "expert_context_rejected" }), undefined);
  assert.equal(getFelixExpertFailureReason(new FelixExpertRejectedError()), "expert_provider_rejected");
  assert.equal(getFelixExpertFailureReason(new FelixExpertContextRejectedError()), "expert_context_rejected");
  assert.equal(getFelixExpertFailureReason({ code: "expert_provider_unavailable" }), "expert_provider_unavailable");
});