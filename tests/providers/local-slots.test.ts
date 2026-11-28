test("durable direct admission precedes inference and preserves uncertain outcomes", async () => {
  for (const failed of [false, true]) {
    const events: string[] = [];
    const run = createLocalSlotRunner({ acquire: async () => ({
      signal: new AbortController().signal,
      beforeGenerate: async () => { events.push("reserved"); },
      finishGenerate: async definite => { events.push(definite ? "definite" : "uncertain"); },
      release: async () => { events.push("released"); },
    }) });
    const generation = run("legion-local", new AbortController().signal, async () => {
      assert.deepEqual(events, ["reserved"]); events.push("inference");
      if (failed) throw Error("socket lost");
      return "done";
    });
    if (failed) await assert.rejects(generation, /socket lost/); else assert.equal(await generation, "done");
    assert.deepEqual(events, ["reserved", "inference", failed ? "uncertain" : "definite", "released"]);
  }
});
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalSlotRunner, LocalAdmissionDeferred, withLocalPriority, currentLocalPriority } from "../../server/legion/local-slots";
import { createLocalBackgroundRouter, type LocalProvider } from "../../server/legion/local-router";

test("different laptops overlap while a second call to the same laptop is deferred", async () => {
  const held = new Set<LocalProvider>();
  const run = createLocalSlotRunner({
    acquire: async provider => {
      if (held.has(provider)) return null;
      held.add(provider);
      return { signal: new AbortController().signal, release: async () => { held.delete(provider); } };
    },
  });
  let releaseLenovo!: () => void;
  let startedLenovo!: () => void;
  const started = new Promise<void>(r => { startedLenovo = r; });
  const untilRelease = new Promise<void>(r => { releaseLenovo = r; });
  const signal = new AbortController().signal;
  const lenovo = run("legion-local", signal, async () => { startedLenovo(); await untilRelease; return "lenovo"; });
  await started;
  assert.equal(await run("surface-local", signal, async () => {
    assert.equal(held.has("legion-local"), true);
    return "surface";
  }), "surface");
  await assert.rejects(run("legion-local", signal, async () => "must not run"), LocalAdmissionDeferred);
  releaseLenovo();
  assert.equal(await lenovo, "lenovo");
  assert.equal(held.size, 0);
});

test("simple work starts on Surface, not Lenovo", async () => {
  const calls: string[] = [];
  const run = createLocalBackgroundRouter({
    preferred: "surface-local", surfaceEnabled: () => true,
    surfaceHealth: async () => {}, legionHealth: async () => {},
    surfaceGenerate: async () => { calls.push("surface"); return {}; },
    legionGenerate: async () => { calls.push("lenovo"); return {}; },
  });
  const result = await run({ messages: [] });
  assert.deepEqual(calls, ["surface"]);
  assert.equal(result.provider, "surface-local");
  assert.equal(result.localFallback, false);
});

test("busy backup preserves the earlier generation instead of refunding a real attempt", async () => {
  const run = createLocalBackgroundRouter({
    preferred: "surface-local", surfaceEnabled: () => true,
    surfaceHealth: async () => {}, legionHealth: async () => {},
    surfaceGenerate: async () => { throw Error("real failed generation"); },
    legionGenerate: async () => { throw new LocalAdmissionDeferred("busy"); },
  });
  await assert.rejects(run({ messages: [] }), error =>
    error instanceof LocalAdmissionDeferred && error.generationStarted === true);
});

test("busy primary does not try another provider or mark a generation started", async () => {
  let other = 0;
  const run = createLocalBackgroundRouter({
    preferred: "surface-local", surfaceEnabled: () => true,
    surfaceHealth: async () => {}, legionHealth: async () => {},
    surfaceGenerate: async () => { throw new LocalAdmissionDeferred("busy"); },
    legionGenerate: async () => { other++; return {}; },
  });
  await assert.rejects(run({ messages: [] }), error =>
    error instanceof LocalAdmissionDeferred && error.generationStarted === false);
  assert.equal(other, 0);
});

test("lost slot aborts only its generation and releases the lease once", async () => {
  const lost = new AbortController();
  let releases = 0;
  const run = createLocalSlotRunner({ acquire: async () => ({
    signal: lost.signal, release: async () => { releases++; },
  }) });
  await assert.rejects(run("surface-local", new AbortController().signal, async signal => {
    lost.abort();
    signal.throwIfAborted();
  }), error => error instanceof LocalAdmissionDeferred && error.generationStarted === true);
  assert.equal(releases, 1);
});

test("unavailable admission is not a provider failure eligible for hosted recovery", async () => {
  const run = createLocalSlotRunner({ acquire: async () => { throw Error("admission database unavailable"); } });
  await assert.rejects(run("surface-local", new AbortController().signal, async () => "must not run"),
    error => error instanceof LocalAdmissionDeferred && error.generationStarted === false);
});

test("concurrent daytime and overnight work retain their own priority contexts", async () => {
  const results = await Promise.all(["daytime", "overnight"].map(priority =>
    withLocalPriority(priority as "daytime" | "overnight", async () => {
      await new Promise(resolve => setImmediate(resolve));
      return currentLocalPriority();
    })));
  assert.deepEqual(results, ["daytime", "overnight"]);
  assert.equal(currentLocalPriority(), "daytime");
});
