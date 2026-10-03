import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { tryAcquireHeavyWorkLane } from "../../server/lib/heavy-work-lane";

test("losing the PostgreSQL lock session notifies the active verifier", async () => {
  const events = new EventEmitter();
  let lost = 0;
  const factory = () => ({
    on(event: "error" | "end", listener: (...args: any[]) => void) {
      events.on(event, listener);
      return this;
    },
    async connect() {},
    async query(text: string) {
      return { rows: [{ got: text.includes("pg_try_advisory_lock") }] };
    },
    async end() { events.emit("end"); },
  });
  const release = await tryAcquireHeavyWorkLane("verifier", {
    clientFactory: factory,
    heapUsage: () => 0,
    onLost: () => { lost++; },
  });
  assert.ok(release);
  events.emit("end");
  events.emit("end");
  assert.equal(lost, 1);
  await release();
  assert.equal(lost, 1);
});

test("optional heavy work is single-flight and a release permits the next job", async () => {
  let held = false;
  let closed = 0;
  const factory = () => ({
    on() { return this; },
    async connect() {},
    async query(query: string) {
      if (query.includes("pg_try_advisory_lock")) {
        const got = !held;
        if (got) held = true;
        return { rows: [{ got }] };
      }
      if (query.includes("pg_advisory_unlock")) {
        held = false;
        return { rows: [{ unlocked: true }] };
      }
      throw new Error("unexpected query");
    },
    async end() { closed++; },
  });
  const first = await tryAcquireHeavyWorkLane("research", { clientFactory: factory, heapUsage: () => 0 });
  assert.ok(first);
  const second = await tryAcquireHeavyWorkLane("audit", { clientFactory: factory, heapUsage: () => 0 });
  assert.equal(second, null);
  assert.equal(closed, 1, "a denied candidate must close its DB connection");
  await first();
  await first();
  assert.equal(closed, 2, "releasing twice must not double-close");
  const third = await tryAcquireHeavyWorkLane("audit", { clientFactory: factory, heapUsage: () => 0 });
  assert.ok(third);
  await third();
});

test("high heap refuses optional work without opening a connection", async () => {
  const result = await tryAcquireHeavyWorkLane("research", {
    heapUsage: () => 0.8,
    clientFactory: () => { throw new Error("should not connect"); },
  });
  assert.equal(result, null);
});

test("database failure does not admit optional work", async () => {
  await assert.rejects(
    tryAcquireHeavyWorkLane("research", {
      heapUsage: () => 0,
      clientFactory: () => ({
        on() { return this; },
        async connect() { throw new Error("DB unavailable"); },
        async end() {},
      }),
    }),
    /DB unavailable/,
  );
});