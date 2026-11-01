import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createReplitSessionAcquirer } from "../../server/lib/replit-admission-postgres";

function backend() {
  let locked = false, clock = 0, until = 0;
  let fault = "";
  const sessions: { release: (destroy?: boolean) => void }[] = [];
  let destroyed = 0;
  const pool = {
    connect: async () => {
      let holds = false, returned = false;
      const client = {
        release: (destroy?: boolean) => {
          assert.equal(returned, false, "session must never be returned twice");
          returned = true;
          if (destroy) { destroyed++; if (holds) locked = false; }
        },
        query: async (config: { text: string; values: number[] }) => {
          if (fault && config.text.includes(fault)) throw new Error("injected query failure");
          if (config.text.includes("pg_try_advisory_lock")) {
            if (locked) return { rows: [{ acquired: false }] };
            locked = holds = true;
            return { rows: [{ acquired: true }] };
          }
          if (config.text.includes("pg_advisory_unlock")) { locked = holds = false; return { rows: [] }; }
          if (config.text.startsWith("INSERT")) { until = Math.max(until, clock + config.values[0]); return { rows: [] }; }
          return { rows: until > clock ? [{}] : [] };
        },
      };
      sessions.push(client);
      return client;
    },
  } as unknown as Pick<Pool, "connect">;
  return { pool, sessions, advance: (ms: number) => { clock += ms; },
    fault: (text: string) => { fault = text; }, destroyed: () => destroyed };
}

test("saved cooldown survives originating session loss and blocks a different worker", async () => {
  const b = backend();
  const workerA = createReplitSessionAcquirer(b.pool);
  const workerB = createReplitSessionAcquirer(b.pool);
  const first = await workerA();
  assert.ok(first);
  assert.equal(await workerB(), null, "parallel worker must not reenter live session lock");
  await first.cooldown(75_000);
  b.sessions[0].release(true); // process termination / database session loss.
  assert.equal(await workerB(), null, "saved deadline outlives the socket");
  b.advance(75_001);
  const recovered = await workerB();
  assert.ok(recovered);
  await recovered();
  await recovered(); // idempotent cleanup.
});

test("pool saturation leaves at most one pending checkout, including after timeout", async () => {
  let connects = 0, returned = 0;
  let resolve!: (client: unknown) => void;
  const pool = {
    connect: () => {
      connects++;
      return new Promise(r => { resolve = r; });
    },
  } as unknown as Pick<Pool, "connect">;
  const acquire = createReplitSessionAcquirer(pool);
  assert.ok((await Promise.all(Array.from({ length: 30 }, () => acquire()))).every(x => x === null));
  assert.equal(connects, 1);
  assert.equal(await acquire(), null);
  assert.equal(connects, 1, "timed-out checkout must not be replaced while pending");
  resolve({ release: () => { returned++; } });
  await new Promise(r => setImmediate(r));
  assert.equal(returned, 1, "late checkout must be returned without acquiring a lock");
});

test("uncertain acquisition and unlock errors destroy sessions rather than leak locks", async () => {
  const b = backend();
  const acquire = createReplitSessionAcquirer(b.pool);
  b.fault("pg_try_advisory_lock");
  await assert.rejects(acquire, /injected query failure/);
  assert.equal(b.destroyed(), 1);
  b.fault("");
  const lease = await acquire();
  assert.ok(lease);
  b.fault("pg_advisory_unlock");
  await lease();
  assert.equal(b.destroyed(), 2);
  b.fault("");
  const next = await acquire();
  assert.ok(next);
  await next();
});
