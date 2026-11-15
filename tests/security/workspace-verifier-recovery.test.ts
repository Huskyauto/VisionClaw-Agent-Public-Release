import assert from "node:assert/strict";
import test from "node:test";
import { nextWorkspaceRecovery } from "../../server/lib/workspace-verifier-recovery";

test("inconclusive and crashed runs cannot refund a per-context execution budget", () => {
  const hash = "a".repeat(64);
  let recovery = nextWorkspaceRecovery(undefined, hash);
  assert.deepEqual(recovery, { contextSha256: hash, runs: 1, paused: false });
  recovery = nextWorkspaceRecovery(recovery, hash);
  assert.equal(recovery.runs, 2);
  recovery = nextWorkspaceRecovery(recovery, hash);
  assert.equal(recovery.paused, true);
  assert.throws(() => nextWorkspaceRecovery(recovery, hash), /paused/);
  assert.equal(nextWorkspaceRecovery(recovery, "b".repeat(64)).runs, 1);
  for (const runs of [0, -1, "1", Infinity, NaN, 1.5]) {
    assert.throws(() => nextWorkspaceRecovery({ contextSha256: hash, runs, paused: false }, hash), /paused/);
  }
});
