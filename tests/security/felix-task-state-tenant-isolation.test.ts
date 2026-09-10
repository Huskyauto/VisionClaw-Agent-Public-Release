import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrCreateTaskState,
  recordToolExecution,
  taskStateStore,
} from "../../server/felix-brain";

test("Felix task state never shares a conversation ID across tenants", () => {
  taskStateStore.clear();

  const tenantOne = getOrCreateTaskState(101, 42, "Research customer A");
  const tenantTwo = getOrCreateTaskState(202, 42, "Draft customer B email");
  recordToolExecution(101, 42, "web_search", true);

  assert.notStrictEqual(tenantOne, tenantTwo);
  assert.equal(tenantOne.tenantId, 101);
  assert.equal(tenantTwo.tenantId, 202);
  assert.deepEqual(tenantOne.completedSteps, ["web_search"]);
  assert.deepEqual(tenantTwo.completedSteps, []);
});