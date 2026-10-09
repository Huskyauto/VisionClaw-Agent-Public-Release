import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeMemoryGroups } from "../../server/storage-helpers/memory-stats";

test("memory stats count every status but classify only active and archived facts", () => {
  assert.deepEqual(summarizeMemoryGroups([
    { status: "active", category: "preference", count: 3 },
    { status: "active", category: "project", count: 2 },
    { status: "superseded", category: "preference", count: 4 },
    { status: "archived", category: "project", count: 1 },
    { status: "deleted", category: "project", count: 1 },
  ], 7), {
    active: 5,
    archived: 5,
    total: 11,
    byCategory: { preference: 3, project: 2 },
    knowledgeCount: 7,
  });
});