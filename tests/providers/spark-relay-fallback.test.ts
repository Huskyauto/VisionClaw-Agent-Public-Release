import test from "node:test";
import assert from "node:assert/strict";
import { createSparkFallback } from "../../server/legion/spark-relay-fallback";
import { LocalAdmissionDeferred, localDeviceEnvironmentAllowed } from "../../server/legion/local-slots";
import { LEGION_MODEL } from "../../server/legion/model-policy";
import { createLegionWorker } from "../../server/legion/background";

const body = { model: LEGION_MODEL };
function fixture(extra: Record<string, any> = {}) {
  const calls: string[] = [];
  const fallback = createSparkFallback({
    eligible: true, assertActive() {}, directHealth: async () => { calls.push("health"); },
    directGenerate: async () => { calls.push("direct"); return { direct: true }; },
    relayAvailable: async () => { calls.push("ready"); return true; },
    relayGenerate: async () => { calls.push("relay"); return { response: { relay: true }, relayJobId: 7 }; },
    ...extra,
  });
  return { fallback, calls };
}
test("direct success creates no relay work", async () => {
  const { fallback, calls } = fixture();
  await fallback.health(); assert.deepEqual(await fallback.generate(body), { direct: true });
  assert.deepEqual(calls, ["health", "direct"]);
});
test("arming Spark restricts Lenovo to production without disabling Surface or flag-off development", () => {
  assert.equal(localDeviceEnvironmentAllowed("legion-local", { NODE_ENV: "development" }), true);
  assert.equal(localDeviceEnvironmentAllowed("legion-local",
    { NODE_ENV: "development", LEGION_SPARK_RELAY_ENABLED: "1" }), false);
  assert.equal(localDeviceEnvironmentAllowed("legion-local",
    { NODE_ENV: "production", LEGION_SPARK_RELAY_ENABLED: "1" }), false);
  assert.equal(localDeviceEnvironmentAllowed("legion-local",
    { REPLIT_DEPLOYMENT: "1", LEGION_SPARK_RELAY_ENABLED: "1" }), true);
  assert.equal(localDeviceEnvironmentAllowed("surface-local",
    { NODE_ENV: "development", LEGION_SPARK_RELAY_ENABLED: "1" }), true);
});
test("only a failed pre-generation health check selects Spark", async () => {
  const { fallback, calls } = fixture({ directHealth: async () => { throw Error("offline"); } });
  await fallback.health(); assert.deepEqual(await fallback.generate(body), { relay: true });
  const candidate = { provider: "legion-local" as const, model: LEGION_MODEL, response: {}, localFallback: false };
  await fallback.accept(candidate, async () => {});
  assert.equal((candidate as any).transport, "spark-relay");
  assert.equal((candidate as any).relayJobId, 7);
  assert.deepEqual(calls, ["ready", "relay"]);
  await assert.rejects(fallback.accept(candidate, async () => { throw Error("bad quality"); }),
    e => e instanceof LocalAdmissionDeferred && e.generationStarted);
});
test("direct generation failure never selects Spark; ambiguous Spark failures stop automatic retries", async () => {
  for (const relay of [false, true]) {
    const { fallback, calls } = fixture({
      directHealth: async () => { if (relay) throw Error("offline"); },
      directGenerate: async () => { throw Error("lost socket"); },
      relayGenerate: async () => { throw Error("commit/result unknown"); },
    });
    await fallback.health();
    await assert.rejects(fallback.generate(body),
      e => relay ? e instanceof LocalAdmissionDeferred && e.generationStarted : e instanceof Error);
    assert(!calls.includes("direct") && !calls.includes("relay"));
  }
});
test("short tasks, stale worker and revoked authority never enter Spark", async () => {
  for (const extra of [
    { eligible: false }, { relayAvailable: async () => false },
    { assertActive: () => { throw Error("revoked"); } },
  ]) {
    const { fallback, calls } = fixture({ directHealth: async () => { throw Error("offline"); }, ...extra });
    await assert.rejects(fallback.health()); assert(!calls.includes("relay"));
  }
});

test("parent retries resume retained Spark work even after direct connectivity recovers", async () => {
  const { fallback, calls } = fixture({ retainedRelay: async () => true });
  await fallback.health(); await fallback.generate(body);
  assert.deepEqual(calls, ["relay"]);
});

test("relay revocation during accounting prevents final task acceptance", async () => {
  let allowed = true, generated = 0;
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1, acquire: async () => async () => {},
    providerEnabled: (_provider, candidate) => candidate?.transport !== "spark-relay" || allowed,
    request: async () => { throw Error("Legacy path forbidden"); },
    record: async () => { await Promise.resolve(); allowed = false; return true; },
    dispatch: async (_body, accept) => {
      generated++;
      const candidate = { provider: "legion-local" as const, localFallback: false, model: LEGION_MODEL,
        transport: "spark-relay" as const, relayJobId: 99, response: {
          model: LEGION_MODEL, system_fingerprint: "fp_ollama", usage: { prompt_tokens: 3, completion_tokens: 1 },
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "42" } }],
        } };
      await accept(candidate); return candidate;
    },
  });
  await assert.rejects(worker({ tenantId: 1, task: "compile-runbook",
    messages: [{ role: "user", content: "Return 42." }] }), /invalid text response/);
  assert.equal(generated, 1);
});
