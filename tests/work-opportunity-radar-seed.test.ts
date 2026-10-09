import assert from "node:assert/strict";
import test from "node:test";
import { seedWorkOpportunityRadar } from "../server/lib/work-opportunity-radar-seed";
import { db } from "../server/db";

type SeedDatabase = Pick<typeof db, "transaction">;

function databaseWithResponses(responses: unknown[]) {
  let callCount = 0;
  const database = {
    transaction: async (callback: (tx: { execute: (query: unknown) => Promise<unknown> }) => Promise<unknown>) =>
      callback({
        execute: async () => responses[callCount++],
      }),
  } as unknown as SeedDatabase;
  return { database, getCallCount: () => callCount };
}

test("creates the owner Work Opportunity Radar project, note, and file pointer once", async () => {
  const { database } = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [] },
    { rows: [{ id: 519 }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 519, customer_name: null, customer_email: null }] },
  ]);

  const result = await seedWorkOpportunityRadar(database);

  assert.deepEqual(result, {
    projectId: 519,
    created: true,
    noteCreated: true,
    filePointerCreated: true,
    compassCreated: true,
    skippedDueToConcurrentSeed: false,
  });
});

test("defers without side effects when another production instance owns the seed lock", async () => {
  const { database, getCallCount } = databaseWithResponses([{ rows: [{ acquired: false }] }]);

  const result = await seedWorkOpportunityRadar(database);

  assert.deepEqual(result, {
    projectId: null,
    created: false,
    noteCreated: false,
    filePointerCreated: false,
    compassCreated: false,
    skippedDueToConcurrentSeed: true,
  });
  assert.equal(getCallCount(), 1);
});

test("reuses the existing owner project without duplicating its note or file pointer", async () => {
  const { database } = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 519 }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [{ id: 519, customer_name: null, customer_email: null }] },
  ]);

  const result = await seedWorkOpportunityRadar(database);

  assert.deepEqual(result, {
    projectId: 519,
    created: false,
    noteCreated: false,
    filePointerCreated: false,
    compassCreated: false,
    skippedDueToConcurrentSeed: false,
  });
});

test("refuses ambiguous duplicate owner projects", async () => {
  const { database } = databaseWithResponses([
    { rows: [{ acquired: true }] },
    { rows: [{ id: 1 }] },
    { rows: [{ id: 519 }, { id: 520 }] },
  ]);

  await assert.rejects(
    () => seedWorkOpportunityRadar(database),
    /duplicate owner projects already exist/,
  );
});