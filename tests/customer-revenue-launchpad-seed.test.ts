import assert from "node:assert/strict";
import test from "node:test";
import { seedCustomerRevenueLaunchpad } from "../server/lib/customer-revenue-launchpad-seed";
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

test("defers immediately when another startup already owns the launchpad seed lock", async () => {
  const { database, getCallCount, getQueries } = databaseWithResponses([{ rows: [{ acquired: false }] }]);

  const result = await seedCustomerRevenueLaunchpad(database);

  assert.deepEqual(result, {
    projectId: null,
    created: false,
    pointerNoteCreated: false,
    skippedDueToConcurrentSeed: true,
  });
  assert.equal(getCallCount(), 1);
  assert.match(JSON.stringify(getQueries()[0]), /pg_try_advisory_xact_lock/);
});

test("creates the fixed owner-only launchpad project and pointer note once", async () => {
  const { database } = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [] },
    { rows: [{ id: 349 }] },
    { rows: [] },
    { rows: [] },
    { rows: [{ id: 349, customer_name: null, customer_email: null }] },
  ]);

  const result = await seedCustomerRevenueLaunchpad(database);

  assert.deepEqual(result, {
    projectId: 349,
    created: true,
    pointerNoteCreated: true,
    skippedDueToConcurrentSeed: false,
  });
});

test("reuses the existing launchpad and refuses duplicate project rows", async () => {
  const existing = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 349 }] },
    { rows: [{ id: 88 }] },
    { rows: [{ id: 349, customer_name: null, customer_email: null }] },
  ]);

  await assert.doesNotReject(async () => {
    const result = await seedCustomerRevenueLaunchpad(existing.database);
    assert.deepEqual(result, {
      projectId: 349,
      created: false,
      pointerNoteCreated: false,
      skippedDueToConcurrentSeed: false,
    });
  });

  const duplicate = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 349 }, { id: 350 }] },
  ]);

  await assert.rejects(
    () => seedCustomerRevenueLaunchpad(duplicate.database),
    /duplicate owner projects already exist/
  );
});