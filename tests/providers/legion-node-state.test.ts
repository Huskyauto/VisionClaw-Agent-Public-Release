import test from "node:test";
import assert from "node:assert/strict";
import { sealNodeState, openNodeState } from "../../server/legion/node-state";
import { claimNodeIdentity } from "../../server/legion/node-store";

test("daemon identity is encrypted and bound to the exact owner environment", () => {
  const key = "synthetic-test-secret-not-a-real-credential";
  const scope = { tenantId: 1, environment: "development" as const };
  const state = JSON.stringify({ _machinekey: "synthetic-private-identity" });
  const sealed = sealNodeState(state, scope, key);
  assert.ok(!sealed.includes("synthetic-private-identity"));
  assert.equal(openNodeState(sealed, scope, key), state);
  assert.throws(() => openNodeState(sealed, { ...scope, environment: "production" }, key));
  assert.throws(() => openNodeState(sealed, { ...scope, tenantId: 2 }, key));
  assert.throws(() => openNodeState(sealed, scope, "wrong-key"));
  assert.throws(() => openNodeState(state, scope, key));
  assert.throws(() => sealNodeState(state, scope, ""));
});

test("a second or crashed holder cannot take over an identity; clean shutdown permits restore", async () => {
  let holder: string | null = null;
  let payload: string | null = null;
  const connection = {
    async query(text: string, values: unknown[]) {
      if (text.startsWith("INSERT")) return { rows: [], rowCount: 0 };
      if (text.includes("holder IS NULL")) {
        if (holder !== null) return { rows: [], rowCount: 0 };
        holder = values[2] as string;
        return { rows: [{ payload }], rowCount: 1 };
      }
      if (values[2] !== holder) return { rows: [], rowCount: 0 };
      if (text.includes("SET payload")) payload = values[3] as string;
      if (text.includes("SET holder=NULL")) holder = null;
      return { rows: [], rowCount: 1 };
    },
  };
  const scope = { tenantId: 1, environment: "development" as const };
  const first = await claimNodeIdentity(connection, scope, "synthetic-encryption-key");
  assert.equal(first.state, null);
  await assert.rejects(claimNodeIdentity(connection, scope, "synthetic-encryption-key"), /already held/);
  await first.save('{"identity":"synthetic"}');
  await first.releaseAfterStop();
  const second = await claimNodeIdentity(connection, scope, "synthetic-encryption-key");
  assert.equal(second.state, '{"identity":"synthetic"}');
  await assert.rejects(first.save('{"identity":"stale"}'), /ownership lost/);
  await assert.rejects(claimNodeIdentity(connection, scope, "synthetic-encryption-key"), /already held/);
  await second.releaseAfterStop();
});
