import assert from "node:assert/strict";
import test from "node:test";
import { seedFable5Workspace } from "../server/lib/fable-5-seed";
import { db } from "../server/db";

type SeedDatabase = Pick<typeof db, "transaction">;

function databaseWithResponses(responses: unknown[]) {
  let callCount = 0;
  const queries: unknown[] = [];
  const database = {
    transaction: async (callback: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<unknown>) =>
      callback({
        execute: async (query: unknown) => {
          queries.push(query);
          const response = responses[callCount++];
          if (response instanceof Error) throw response;
          return response;
        },
      }),
  } as unknown as SeedDatabase;

  return { database, getCallCount: () => callCount, getQueries: () => queries };
}

test("defers immediately when another startup owns the Fable 5 seed lock", async () => {
  const { database, getCallCount, getQueries } = databaseWithResponses([{ rows: [{ acquired: false }] }]);

  const result = await seedFable5Workspace(database);

  assert.deepEqual(result, {
    parentProjectId: null,
    childProjectIds: [],
    createdParent: false,
    createdChildren: 0,
    skippedDueToConcurrentSeed: true,
  });
  assert.equal(getCallCount(), 1);
  assert.match(JSON.stringify(getQueries()[0]), /pg_try_advisory_xact_lock/);
});

test("creates the missing Fable 5 parent and all five child projects", async () => {
  const responses: unknown[] = [
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [] },
    { rows: [{ id: 308 }] },
  ];
  for (let i = 0; i < 5; i++) {
    responses.push({ rows: [] }, { rows: [{ id: 309 + i }] });
  }

  const result = await seedFable5Workspace(databaseWithResponses(responses).database);

  assert.deepEqual(result, {
    parentProjectId: 308,
    childProjectIds: [309, 310, 311, 312, 313],
    createdParent: true,
    createdChildren: 5,
    skippedDueToConcurrentSeed: false,
  });
});

test("reuses existing Fable projects and refuses duplicate parent rows", async () => {
  const responses: unknown[] = [
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 308 }] },
  ];
  for (let i = 0; i < 5; i++) responses.push({ rows: [{ id: 309 + i }] });

  const result = await seedFable5Workspace(databaseWithResponses(responses).database);
  assert.deepEqual(result, {
    parentProjectId: 308,
    childProjectIds: [309, 310, 311, 312, 313],
    createdParent: false,
    createdChildren: 0,
    skippedDueToConcurrentSeed: false,
  });

  await assert.rejects(
    () => seedFable5Workspace(databaseWithResponses([
      { rows: [{ acquired: true }] },
      { rows: [{ id: 1 }] },
      { rows: [{ id: 308 }, { id: 314 }] },
    ]).database),
    /duplicate Fable 5 parent projects/
  );
});