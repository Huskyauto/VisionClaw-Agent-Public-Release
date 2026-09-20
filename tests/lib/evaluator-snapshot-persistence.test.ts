import { test } from "node:test";
import assert from "node:assert/strict";
import { persistSnapshotsIndividually } from "../../server/lib/evaluator-snapshot-persistence";

test("snapshot persistence continues after one failure and reports the failed evaluator", async () => {
  const attempted: string[] = [];
  const errors: string[] = [];
  const failures = await persistSnapshotsIndividually(
    [
      { evaluator: "first", status: "ok", metrics: {} },
      { evaluator: "broken", status: "warning", metrics: {} },
      { evaluator: "last", status: "ok", metrics: {} },
    ],
    async (result) => {
      attempted.push(result.evaluator);
      if (result.evaluator === "broken") throw new Error("database unavailable");
    },
    (error) => errors.push((error as Error).message),
  );

  assert.deepEqual(attempted, ["first", "broken", "last"]);
  assert.deepEqual(failures, ["broken"]);
  assert.deepEqual(errors, ["database unavailable"]);
});

test("snapshot persistence reports no degradation when every insert succeeds", async () => {
  const failures = await persistSnapshotsIndividually(
    [{ evaluator: "healthy", status: "ok", metrics: { count: 1 } }],
    async () => undefined,
  );

  assert.deepEqual(failures, []);
});