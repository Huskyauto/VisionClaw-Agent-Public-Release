import test from "node:test";
import assert from "node:assert/strict";
import { appendPilotRun, deletePilotRun, parsePilotState } from "../../server/lib/business-pilot-state";
const request = () => ({ requestId: "11111111-1111-4111-8111-111111111111",
  input: { business: "Example", reference: "example", currency: "USD", start: "2026-09-01", end: "2026-09-30" } });
test("state retries retain exact original run and reject reused identity with different payload", () => {
  const first = appendPilotRun([], "health", request());
  assert.equal(first.runs.length, 1);
  assert.deepEqual(appendPilotRun(first.runs, "health", request()).run, first.run);
  assert.throws(() => appendPilotRun(first.runs, "health", { ...request(),
    input: { ...request().input, business: "Changed" } }), /different payload/i);
});
test("state baseline must exist and deleting a referenced baseline is blocked", () => {
  const first = appendPilotRun([], "health", request());
  assert.throws(() => appendPilotRun(first.runs, "health", { ...request(),
    requestId: "22222222-2222-4222-8222-222222222222", baselineId: "33333333-3333-4333-8333-333333333333" }), /baseline/i);
  const second = appendPilotRun(first.runs, "health", { ...request(),
    requestId: "22222222-2222-4222-8222-222222222222", baselineId: first.run.id,
    input: { ...request().input, start: "2026-10-01", end: "2026-10-19" } });
  assert.throws(() => deletePilotRun(second.runs, first.run.id), /referenced/i);
  assert.equal(deletePilotRun(second.runs, second.run.id).length, 1);
});
test("corrupted state is refused, never silently reset", () => {
  assert.throws(() => parsePilotState("not JSON", "health"), /corrupt/i);
  assert.throws(() => parsePilotState('{"version":1,"runs":[{}]}', "health"), /corrupt/i);
  assert.deepEqual(parsePilotState(null, "health"), []);
});
