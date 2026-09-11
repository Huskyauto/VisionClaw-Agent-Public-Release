import test from "node:test";
import assert from "node:assert/strict";
import { decideWedgeLifecycle, type WedgeSignals } from "../../scripts/lib/wedge-lifecycle-policy";

const quiet: WedgeSignals = {
  signups7d: 0, signups21d: 0, content7d: 0, content21d: 0,
  orders7d: 0, orders21d: 0, inbox7d: 0, inbox21d: 0,
};

test("a quiet mature wedge stalls and stops claiming active status", () => {
  assert.deepEqual(decideWedgeLifecycle("validation", 25, quiet), {
    stage: "stalled", status: "on_hold", reason: "zero signals for 21d",
  });
});

test("a clearly dormant wedge is parked and archived", () => {
  assert.deepEqual(decideWedgeLifecycle("stalled", 50, quiet), {
    stage: "parked", status: "archived", reason: "zero signals for 42d",
  });
});

test("paid orders advance traction and sustained orders advance scale", () => {
  assert.equal(decideWedgeLifecycle("validation", 10, { ...quiet, orders7d: 1, orders21d: 1 }).stage, "traction");
  assert.equal(decideWedgeLifecycle("traction", 30, { ...quiet, orders7d: 1, orders21d: 3 }).stage, "scale");
});

test("fresh inbox or content activity reactivates a dormant wedge for validation", () => {
  assert.deepEqual(decideWedgeLifecycle("parked", 50, { ...quiet, inbox7d: 1, inbox21d: 1 }), {
    stage: "validation", status: "active", reason: "fresh signal returned",
  });
});

test("activity older than seven days does not falsely reactivate a dormant wedge", () => {
  assert.deepEqual(decideWedgeLifecycle("stalled", 30, { ...quiet, inbox21d: 1 }), {
    stage: "stalled", status: "on_hold", reason: "no fresh signal",
  });
  assert.deepEqual(decideWedgeLifecycle("parked", 50, { ...quiet, content21d: 1 }), {
    stage: "parked", status: "archived", reason: "no fresh signal",
  });
});
