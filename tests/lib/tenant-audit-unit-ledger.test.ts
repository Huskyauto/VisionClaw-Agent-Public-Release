import test from "node:test";
import assert from "node:assert/strict";
import { auditUnitKey, sealAuditUnitLedger, restoreAuditUnitLedger, planAuditSlice } from "../../scripts/lib/tenant-audit-unit-ledger";
import { auditRoutes, resumeAuditUnits, runAuditFallback, AuditWorkDeferred } from "../../scripts/lib/tenant-audit-fallback";
import { auditDeadlineAt, assertAuditTimeBudget } from "../../scripts/lib/tenant-audit-deadline";
import { groupPrecisionFindings } from "../../scripts/lib/tenant-audit-precision-cache";

test("source edits reuse only byte-identical audit units under the same scan contract", () => {
  const ctx = "a".repeat(64), one = "file A line 1", two = "file B line 1";
  const receipt = { findings: ["A"], provider: "replit", model: "gpt-5.4" };
  const saved = sealAuditUnitLedger(ctx, {
    [auditUnitKey(ctx, one)]: receipt, [auditUnitKey(ctx, two)]: { ...receipt, findings: ["B"] },
  });
  const restored = restoreAuditUnitLedger(saved, ctx, [one, two + " changed"], () => true);
  assert.deepEqual(Object.keys(restored.receipts), [auditUnitKey(ctx, one)]);
  assert.deepEqual(restored.receipts[auditUnitKey(ctx, one)].findings, ["A"]);
});

test("300 cached chunks replay in one slice and only fresh chunks consume its quota", () => {
  const chunks = Array.from({ length: 304 }, (_, i) => i);
  assert.deepEqual(planAuditSlice(chunks, 0, 1, i => i < 300), { end: 301, uncached: 1 });
  assert.deepEqual(planAuditSlice(chunks, 0, 1, () => true), { end: 304, uncached: 0 });
  assert.deepEqual(planAuditSlice(chunks, 300, 1, i => i === 301), { end: 302, uncached: 1 });
});

test("context drift, tamper, bad finding binding and invalid keys never grant cache clearance", () => {
  const ctx = "a".repeat(64), source = "label and line";
  const receipt = { findings: ["ok"], provider: "replit", model: "gpt-5.4" };
  const saved = sealAuditUnitLedger(ctx, { [auditUnitKey(ctx, source)]: receipt });
  const corrupt = structuredClone(saved);
  corrupt.receipts[auditUnitKey(ctx, source)].findings = ["tampered"];
  const cases = [
    restoreAuditUnitLedger(corrupt, ctx, [source], () => true),
    restoreAuditUnitLedger(saved, "b".repeat(64), [source], () => true),
    restoreAuditUnitLedger(saved, ctx, [source], () => false),
    restoreAuditUnitLedger(sealAuditUnitLedger(ctx, { bad: receipt }), ctx, [source], () => true),
  ];
  for (const result of cases) assert.deepEqual(result.receipts, {});
  const reordered = JSON.parse(JSON.stringify(saved, (_k, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.deepEqual(restoreAuditUnitLedger(reordered, ctx, [source], () => true).receipts, saved.receipts);
  assert.throws(() => sealAuditUnitLedger(ctx, { [auditUnitKey(ctx, source)]:
    { ...receipt, findings: ["x".repeat(6 * 1024 * 1024)] } }), /capacity/);
});

test("the controller scheduling deadline stops dispatch without poisoning health or advancing an unused provider", async () => {
  assert.equal(auditDeadlineAt(undefined), Infinity);
  for (const value of ["bad", "0", "-1", "Infinity"]) assert.throws(() => auditDeadlineAt(value));
  assert.doesNotThrow(() => assertAuditTimeBudget(90_000, 55_000, 0));
  assert.throws(() => assertAuditTimeBudget(69_999, 55_000, 0), AuditWorkDeferred);
  const cursors: number[] = [];
  let calls = 0, failures = 0;
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 1,
    beforeAttempt: async next => { cursors.push(next); },
    invoke: async () => { calls++; throw new AuditWorkDeferred("pre-dispatch scheduling yield"); },
    failed: () => { failures++; },
  }), AuditWorkDeferred);
  assert.equal(calls, 1);
  assert.equal(failures, 0);
  assert.deepEqual(cursors, [2, 1]);
});

test("precision batches remain local to a file when another file gains findings", () => {
  const a = { file: "a.ts", line: 1, issue: "A" };
  const b = { file: "b.ts", line: 2, issue: "B" };
  const original = groupPrecisionFindings([b, a], 2);
  const changed = groupPrecisionFindings([b, a, { ...a, line: 3, issue: "new" }], 2);
  assert.deepEqual(original.find(batch => batch[0].file === "b.ts"), changed.find(batch => batch[0].file === "b.ts"));
  assert.ok(changed.every(batch => new Set(batch.map(f => f.file)).size === 1));
});

test("real unit resumption consumes validated cache without dispatch and commits fresh receipts before proceeding", async () => {
  const pending = { chunk: 0, completed: {}, nextRoute: 0 };
  const events: string[] = [];
  const known = { findings: ["old"], provider: "replit", model: "gpt-5.4" };
  const result = await resumeAuditUnits({
    units: ["same", "changed"], pending, routes: auditRoutes(),
    reuse: source => source === "same" ? known : undefined,
    committed: (source) => { events.push(`commit:${source}`); },
    persist: async () => { events.push("persist"); },
    invoke: async (_route, source) => { events.push(`call:${source}`); return { ...known, findings: ["new"] }; },
  });
  assert.deepEqual(result, ["old", "new"]);
  assert.deepEqual(events.filter(e => e.startsWith("call:")), ["call:changed"]);
  assert.ok(events.indexOf("commit:changed") < events.lastIndexOf("persist"));
});
