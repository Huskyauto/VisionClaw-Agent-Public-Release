import { test } from "node:test";
import assert from "node:assert/strict";

// Guards the CLI/import split added when the knob-readiness registry was wired
// into weekly-maintenance Pass 10. Importing the module must NOT execute the CLI
// `main()` (which calls process.exit + writes a report). If the guard ever
// regressed, `main()` would call process.exit(0) during this import and kill the
// test runner before any assertion ran — so simply reaching the assertions is
// itself proof the guard holds.
test("importing autotts-knob-readiness does not execute the CLI", async () => {
  const mod = await import("../../scripts/autotts-knob-readiness.ts");
  assert.equal(typeof mod.runReadinessProbes, "function");
  assert.equal(typeof mod.statusOf, "function");
});

test("runReadinessProbes returns one typed result per registered knob, no throw", async () => {
  const { runReadinessProbes, statusOf } = await import("../../scripts/autotts-knob-readiness.ts");
  const results = runReadinessProbes();
  // Deterministic regardless of DB/corpus availability: one entry per probe.
  assert.equal(Array.isArray(results), true);
  assert.equal(results.length, 3);
  for (const r of results) {
    assert.equal(typeof r.probe.id, "string");
    assert.equal(typeof r.probe.title, "string");
    // statusOf must always render a non-empty status string for any result shape
    // (discoverable / data-blocked / structural-blocked / inaccessible).
    assert.equal(typeof statusOf(r), "string");
    assert.ok(statusOf(r).length > 0);
    // A structural block and a data-derived readiness are mutually exclusive.
    if (r.structuralBlock) assert.equal(r.readiness, null);
  }
});
