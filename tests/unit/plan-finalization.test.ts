import assert from "node:assert/strict";
import test from "node:test";

import { finalizePlanExecution } from "../../server/lib/plan-finalization";

test("terminal goal evidence is never written before the authoritative status commit", async () => {
  const calls: string[] = [];

  await assert.rejects(
    finalizePlanExecution({
      commitTerminalState: async () => {
        calls.push("commit");
        throw new Error("database write failed");
      },
      appendTerminalAdvisory: async () => {
        calls.push("advisory");
      },
    }),
    /database write failed/,
  );

  assert.deepEqual(calls, ["commit"]);
});

test("terminal goal evidence is appended only after the status commit succeeds", async () => {
  const calls: string[] = [];

  await finalizePlanExecution({
    commitTerminalState: async () => {
      calls.push("commit");
    },
    appendTerminalAdvisory: async () => {
      calls.push("advisory");
    },
  });

  assert.deepEqual(calls, ["commit", "advisory"]);
});