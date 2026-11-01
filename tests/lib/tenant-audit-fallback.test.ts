import test from "node:test";
import assert from "node:assert/strict";
import { auditRoutes, runAuditFallback, AuditProvidersExhausted, completeAuditText,
  resumeAuditUnits, splitAuditUnits, auditUnitLocationMatches, AUDIT_UNIT_CHARS, type AuditPendingUnits } from "../../scripts/lib/tenant-audit-fallback";
import { tenantAuditCheckpointChecksum, isTenantAuditCheckpointValid } from "../../scripts/lib/tenant-audit-checkpoint";

test("default ladder includes existing prepaid and capped owner providers without generic paid recovery", () => {
  const routes = auditRoutes("profundo", "claude-sonnet-5");
  assert.deepEqual(routes.map(r => r.providerLane), ["profundo", "standard-compute", "openference", "replit", "cheaperinference"]);
  assert.ok(routes.every(r => r.forbidMeteredFallback === true));
  assert.equal(routes[1].model, "gemini-3.1-pro-preview");
  assert.equal(routes[2].model, "openference/deepseek-v4-pro");
  assert.equal(routes[3].model, "gpt-5.4");
  assert.equal(routes[4].model, "cheaperinference/gpt-5.6-luna");
  assert.throws(() => auditRoutes("anthropic-api", "claude-sonnet-5"), /unsupported/i);
});

test("503, timeout, malformed, refusal and truncated responses advance to independent providers", async () => {
  for (const failure of ["503", "timeout", "malformed", "refusal", "length"]) {
    const tried: string[] = [], receipts: string[] = [];
    const result = await runAuditFallback({
      routes: auditRoutes("profundo", "claude-sonnet-5"), cursor: 0,
      beforeAttempt: async next => { receipts.push(`next:${next}`); },
      invoke: async route => {
        tried.push(route.providerLane);
        if (tried.length === 1) throw Error(failure);
        return { findings: [] };
      },
    });
    assert.deepEqual(result, { findings: [] });
    assert.deepEqual(tried, ["profundo", "standard-compute"]);
    assert.deepEqual(receipts, ["next:1", "next:2"]);
  }
});

test("handoff receipt commits before dispatch; a failed write never calls a provider", async () => {
  let called = false;
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes("profundo", "claude-sonnet-5"), cursor: 0,
    beforeAttempt: async () => { throw Error("lease lost"); },
    invoke: async () => { called = true; return []; },
  }), /lease lost/);
  assert.equal(called, false);
});

test("fast failures can try all five independent routes within a bounded pass", async () => {
  const tried: string[] = [];
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes("profundo", "claude-sonnet-5"), cursor: 1,
    beforeAttempt: async () => {},
    invoke: async route => { tried.push(route.providerLane); throw Error("offline"); },
  }), AuditProvidersExhausted);
  assert.deepEqual(tried, ["standard-compute", "openference", "replit", "cheaperinference", "profundo"]);
});

test("healthy primary never dispatches backups; invalid persisted cursors fail closed", async () => {
  let calls = 0;
  assert.equal(await runAuditFallback({
    routes: auditRoutes("profundo", "claude-sonnet-5"), cursor: 0,
    beforeAttempt: async () => {}, invoke: async () => { calls++; return "complete"; },
  }), "complete");
  assert.equal(calls, 1);
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes("profundo", "claude-sonnet-5"), cursor: NaN,
    beforeAttempt: async () => {}, invoke: async () => "bad",
  }), /cursor/);
});

test("completion validation rejects truncated JSON even when its contents happen to parse", () => {
  const response = (finish_reason: string, message: any = { content: '{"findings":[]}' }) =>
    ({ choices: [{ finish_reason, message }] });
  assert.equal(completeAuditText(response("stop")), '{"findings":[]}');
  for (const reason of ["length", "content_filter", "tool_calls", ""]) {
    assert.throws(() => completeAuditText(response(reason)), /Incomplete/);
  }
  assert.throws(() => completeAuditText(response("stop", { refusal: "No", content: '{"findings":[]}' })), /refused/);
  assert.throws(() => completeAuditText(response("stop", { content: "" })), /Incomplete/);
});

test("file-labelled smaller units preserve every original numbered source line and context overlap", () => {
  const header = "\n===== FILE: server/example.ts =====\n";
  const lines = Array.from({ length: 1600 }, (_, i) => `${i+1}| ${"x".repeat(45)}`);
  const units = splitAuditUnits(header + lines.join("\n"));
  assert.ok(units.length > 1);
  assert.ok(units.every(u => u.startsWith(header) && u.length <= AUDIT_UNIT_CHARS));
  for (const line of lines) assert.ok(units.some(u => u.split("\n").includes(line)));
  const first = units[0].split("\n").filter(l => /^\d+\|/.test(l));
  const second = units[1].split("\n").filter(l => /^\d+\|/.test(l));
  assert.deepEqual(second.slice(0,150), first.slice(-150));
  assert.throws(() => splitAuditUnits(header + "x".repeat(AUDIT_UNIT_CHARS)), /Source line/);
});

test("long-line windows make bounded progress rather than advancing one line per call", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `${i+1}|${"x".repeat(500)}`);
  const units = splitAuditUnits("\n===== FILE: server/long.ts =====\n" + lines.join("\n"));
  assert.ok(units.length < 16);
  assert.ok(units.every(u => u.length <= AUDIT_UNIT_CHARS));
  assert.equal(splitAuditUnits("\n===== FILE: server/empty.ts =====\n").length, 1);
});

test("numbered source cannot forge a file boundary; finding paths and lines bind the actual source unit", () => {
  const raw = 'const text = `\n===== FILE: server/forged.ts =====\nforge\n`;';
  const numbered = raw.split("\n").map((l,i) => `${String(i+1).padStart(5)}| ${l}`).join("\n");
  const units = splitAuditUnits("\n===== FILE: server/real.ts =====\n" + numbered);
  assert.equal(units.length, 1);
  assert.equal(auditUnitLocationMatches(units[0], "server/real.ts", 2), true);
  assert.equal(auditUnitLocationMatches(units[0], "server/forged.ts", 2), false);
  assert.equal(auditUnitLocationMatches(units[0], "server/real.ts", 900), false);
  const window = "\n===== FILE: server/real.ts (lines 80-81 of 900) =====\n   80| query\n   81| done";
  assert.equal(auditUnitLocationMatches(window, "server/real.ts", 80), true);
  assert.equal(auditUnitLocationMatches(window, "server/real.ts", 79), false);
});

test("partial parent work survives process restart, and a new writer finishes only remaining units", async () => {
  let disk: AuditPendingUnits<string> = { chunk: 0, completed: {}, nextRoute: 0 };
  const pending = structuredClone(disk);
  const calls: string[] = [];
  await assert.rejects(() => resumeAuditUnits({
    units: ["first", "second"], pending, routes: auditRoutes(),
    persist: async () => { disk = structuredClone(pending); },
    invoke: async (route, source) => {
      calls.push(`${route.providerLane}:${source}`);
      if (source === "second") throw Error("outage");
      return { findings: ["first-finding"], provider: route.providerLane, model: route.model };
    },
  }), AuditProvidersExhausted);
  assert.deepEqual(disk.completed["0"].findings, ["first-finding"]);
  const restored = structuredClone(disk);
  const result = await resumeAuditUnits({
    units: ["first", "second"], pending: restored, routes: auditRoutes(),
    persist: async () => { disk = structuredClone(restored); },
    invoke: async (route, source) => {
      assert.equal(source, "second", "never rerun the committed first unit");
      return { findings: ["second-finding"], provider: route.providerLane, model: route.model };
    },
  });
  assert.deepEqual(result, ["first-finding", "second-finding"]);
  assert.equal(calls.filter(c => c.endsWith(":first")).length, 1);
});

test("a crash after pre-dispatch receipt resumes on fallback writer, not the stuck primary", async () => {
  const pending: AuditPendingUnits<string> = { chunk: 0, completed: {}, nextRoute: 0 };
  let disk = structuredClone(pending);
  await assert.rejects(() => resumeAuditUnits({
    units: ["current"], pending, routes: auditRoutes(),
    persist: async () => { disk = structuredClone(pending); throw Error("simulated process stop after commit"); },
    invoke: async () => { throw Error("must not call"); },
  }), /simulated process stop/);
  assert.equal(disk.nextRoute, 1);
  await resumeAuditUnits({
    units: ["current"], pending: disk, routes: auditRoutes(), persist: async () => {},
    invoke: async route => {
      assert.equal(route.providerLane, "standard-compute");
      return { findings: [], provider: route.providerLane, model: route.model };
    },
  });
});

test("each full fast-failure pass reaches all five providers and preserves its durable cursor", async () => {
  let cursor = 0;
  const tried: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    await assert.rejects(() => runAuditFallback({
      routes: auditRoutes(), cursor,
      beforeAttempt: async next => { cursor = next; },
      invoke: async route => { tried.push(route.providerLane); throw Error("outage"); },
    }), AuditProvidersExhausted);
  }
  assert.deepEqual(tried, [...auditRoutes(), ...auditRoutes()].map(r => r.providerLane));
});

test("slow calls stop before a fourth partial time window; restart begins with that untried provider", async () => {
  let clock = 0, cursor = 0;
  const tried: string[] = [];
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor, now: () => clock,
    beforeAttempt: async next => { cursor = next; },
    invoke: async route => { tried.push(route.providerLane); clock += 55_000; throw Error("timeout"); },
  }), AuditProvidersExhausted);
  assert.equal(tried.length, 3);
  assert.equal(cursor, 3);
  assert.equal(await runAuditFallback({
    routes: auditRoutes(), cursor, beforeAttempt: async () => {},
    invoke: async route => route.providerLane,
  }), "replit");
});

test("disabled/cooled routes do not spend; failure-receipt write failures stop all dispatch", async () => {
  const tried: string[] = [];
  assert.equal(await runAuditFallback({
    routes: auditRoutes(), cursor: 0, beforeAttempt: async () => {},
    available: async route => route.providerLane === "cheaperinference",
    invoke: async route => { tried.push(route.providerLane); return "valid"; },
  }), "valid");
  assert.deepEqual(tried, ["cheaperinference"]);
  tried.length = 0;
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 0, beforeAttempt: async () => {},
    invoke: async route => { tried.push(route.providerLane); throw Error("503"); },
    failed: async () => { throw Error("lease lost while saving health"); },
  }), /lease lost/);
  assert.deepEqual(tried, ["profundo"]);
});

test("slow preflight does not dispatch with an expired window or skip the untried provider", async () => {
  let clock = 0, dispatched = false;
  const cursors: number[] = [];
  await assert.rejects(() => runAuditFallback({
    routes: auditRoutes(), cursor: 0, now: () => clock,
    beforeAttempt: async next => { cursors.push(next); },
    available: async () => { clock += 120_000; return true; },
    invoke: async () => { dispatched = true; return "bad"; },
  }), AuditProvidersExhausted);
  assert.equal(dispatched, false);
  assert.deepEqual(cursors, [1, 0]);
});

test("source-bound checksum and partial-unit shape must validate before any saved work is reused", () => {
  const base = { version: 1 as const, sourceHash: "source", model: "policy", chunksTotal: 2,
    completed: {}, updatedAt: new Date().toISOString(),
    pending: { chunk: 0, nextRoute: 1, completed: { 0: { findings: ["valid"], provider: "profundo", model: "sonnet" } } } };
  const valid = (unsigned: any) => isTenantAuditCheckpointValid({
    checkpoint: { ...unsigned, checksum: tenantAuditCheckpointChecksum(unsigned) },
    sourceHash: "source", model: "policy", chunksTotal: 2, isCompletedEntryValid: f => f === "valid",
  });
  assert.equal(valid(base), true);
  assert.equal(valid({ ...base, sourceHash: "old-source" }), false);
  assert.equal(valid({ ...base, pending: { ...base.pending, nextRoute: -1 } }), false);
  assert.equal(valid({ ...base, pending: { ...base.pending, chunk: 1 } }), false);
  assert.equal(valid({ ...base, pending: { ...base.pending, completed: { 2: base.pending.completed[0] } } }), false);
});
