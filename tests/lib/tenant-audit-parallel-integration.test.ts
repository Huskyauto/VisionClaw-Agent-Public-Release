import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { transformSync } from "esbuild";
import {
  createAuditPrecisionState, createAuditStateGate, runAuditTaskPool, auditConcurrency,
} from "../../scripts/lib/tenant-audit-coordinator";
import {
  auditRoutes, runAuditFallback, AuditContentError, AuditProvidersExhausted, AuditWorkDeferred, AuditResponseError,
} from "../../scripts/lib/tenant-audit-fallback";
import { groupPrecisionFindings } from "../../scripts/lib/tenant-audit-precision-cache";
import { matchVerdictToFinding } from "../../scripts/lib/triage-verdict-match";

const auditSource = fs.readFileSync("scripts/tenant-isolation-audit.ts", "utf8");
const triageSource = auditSource.slice(
  auditSource.indexOf("async function precisionTriage("),
  auditSource.indexOf("\nasync function remediate(", auditSource.indexOf("async function precisionTriage(")),
).replace(/\bimport\(/g, "__fixtureImport(");
const parseSource = auditSource.slice(
  auditSource.indexOf("interface RawVerdict"),
  auditSource.indexOf("\n// ── Human-verified suppression allowlist", auditSource.indexOf("interface RawVerdict")),
);

type Provider = (file: string, route: ReturnType<typeof auditRoutes>[number]) => Promise<{ raw: string; model: string }>;

function createHarness(options: {
  concurrency?: number;
  provider?: Provider;
  fence?: (call: number) => boolean;
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-parallel-"));
  const state: Record<string, any> = { auditPrecision: {}, auditHandoff: {} };
  const calls: Array<{ file: string; route: string }> = [];
  let budgetClaims = 0, fenceCalls = 0;
  const findings = Array.from({ length: 4 }, (_, i) => {
    const file = path.join(dir, `file-${i}.ts`);
    fs.writeFileSync(file, `export const fixture${i} = ${i};\n`);
    return { file, line: 1, severity: "HIGH", issue: `fixture-${i}` };
  });
  const ok = createHash("sha256").update("contract").digest("hex");
  const context: any = {
    Object, JSON, Buffer, fs, process: { env: {} }, createHash,
    console: { log() {}, error() {} }, log() {},
    PRECISION_ON: true, TRIAGE_BATCH: 1, TRIAGE_MAX_BATCHES: 0,
    TRIAGE_CONCURRENCY: auditConcurrency(String(options.concurrency ?? 2)),
    TRIAGE_MODEL: "fixture-model", TRIAGE_SYSTEM_PROMPT: "fixture triage contract",
    TRIAGE_MAX_TOKENS: 200, TRIAGE_EST_USD_PER_BATCH: 0.1,
    TRIAGE_SNIPPET_RADIUS: 2, AUDIT_OPERATION_TIMEOUT_MS: 1000, AUDIT_TRIAGE_TIMEOUT_MS: 1000,
    AUDIT_PRECISION_RESPONSE_BYTES: 128 * 1024, SUPPRESSIBLE_PATTERNS: new Set(["fk-transitive"]),
    AuditContentError, AuditProvidersExhausted, AuditWorkDeferred, AuditResponseError,
    createAuditPrecisionState, createAuditStateGate, runAuditTaskPool, auditRoutes, runAuditFallback,
    groupPrecisionFindings, matchVerdictToFinding,
    buildSchemaIndex: () => ({ ok: true, index: new Map([["fixture_table", { hasTenantId: true }]]) }),
    scanContractHash: () => ok,
    renderFindingForTriage: (finding: any) => `${finding.file}:${finding.line} ${finding.issue}`,
    precisionState: async (field: string, value?: unknown) => {
      if (value !== undefined) state[field] = JSON.parse(JSON.stringify(value));
      const current = state[field];
      return current === undefined ? undefined : JSON.parse(JSON.stringify(current));
    },
    auditStateGate: createAuditStateGate(),
    auditJobState: async () => {
      fenceCalls++;
      if (options.fence?.(fenceCalls)) throw new Error("lease lost");
      return {};
    },
    withAuditDeadline: async (_label: string, _timeout: number, work: () => Promise<unknown>) => work(),
    prepareAuditCompletion: async () => {},
    auditCompletionAvailable: async () => true,
    auditRouteFailed: async () => {},
    auditRouteSucceeded: async () => {},
    auditCompletion: async (route: any, _system: string, prompt: string) => {
      const file = findings.find(f => prompt.includes(f.file))!.file;
      calls.push({ file, route: route.providerLane });
      if (options.provider) return options.provider(file, route);
      return { raw: JSON.stringify({ verdicts: [{ file, line: 1, verdict: "KEEP", pattern: "none" }] }), model: route.model };
    },
    __fixtureImport: async (specifier: string) => {
      if (specifier === "../server/tenant-constants") return { ADMIN_TENANT_ID: "fixture-tenant" };
      if (specifier === "../server/agentic/autonomous-budget")
        return { claimAutonomousBudget: async () => { budgetClaims++; return { ok: true }; } };
      throw new Error(`Unexpected dynamic import: ${specifier}`);
    },
    stopPrecisionDispatch: undefined,
    providerRecoveryNeeded: false, schedulingYieldNeeded: false,
  };
  const box = vm.createContext({ ...context });
  vm.runInContext(transformSync(`${parseSource}\n${triageSource}\nglobalThis.entry = precisionTriage;`, {
    loader: "ts", format: "cjs",
  }).code, box);
  context.entry = (box as any).entry;
  return {
    dir, state, calls, findings, context: box as any, budgetClaims: () => budgetClaims,
    run: (input = findings) => context.entry(input),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test("precisionTriage overlaps four actual remote calls, merges every receipt, and claims budget once", async () => {
  let active = 0, peak = 0;
  let started!: () => void;
  const allStarted = new Promise<void>(resolve => { started = resolve; });
  const h = createHarness({
    concurrency: 4,
    provider: async (file, route) => {
      active++; peak = Math.max(peak, active);
      if (active === 4) started();
      await allStarted;
      await new Promise(resolve => setTimeout(resolve, file.charCodeAt(file.length - 5) % 4));
      active--;
      return { raw: JSON.stringify({ verdicts: [{ file, line: 1, verdict: "KEEP", pattern: "none" }] }), model: route.model };
    },
  });
  try {
    const result = await h.run();
    assert.equal(peak, 4, "provider work, not just pool callbacks, overlaps");
    assert.equal(h.calls.length, 4);
    assert.equal(h.budgetClaims(), 1);
    assert.equal(Object.keys(h.state.auditPrecision).length, 4, "interleaved updates retain every exact-key receipt");
    assert.equal(result.kept.length, 4);
    assert.equal(result.degraded, false);
  } finally { h.dispose(); }
});

test("exact-input receipts are reused without another budget claim or provider call", async () => {
  const h = createHarness({ concurrency: 2 });
  try {
    await h.run(h.findings.slice(0, 2));
    const calls = h.calls.length, claims = h.budgetClaims();
    const second = await h.run(h.findings.slice(0, 2));
    assert.equal(h.calls.length, calls);
    assert.equal(h.budgetClaims(), claims);
    assert.equal(second.kept.length, 2);
  } finally { h.dispose(); }
});

test("provider exhaustion stops undispatched tasks while an in-flight receipt drains", async () => {
  let finishHeld!: () => void, exhausted!: () => void;
  const held = new Promise<void>(resolve => { finishHeld = resolve; });
  const failureReached = new Promise<void>(resolve => { exhausted = resolve; });
  const h = createHarness({
    concurrency: 2,
    provider: async (file, route) => {
      if (file === h.findings[0]?.file) {
        if (route.providerLane === "cheaperinference") exhausted();
        throw new Error("provider unavailable");
      }
      await held;
      return { raw: JSON.stringify({ verdicts: [{ file, line: 1, verdict: "KEEP", pattern: "none" }] }), model: route.model };
    },
  });
  try {
    const run = h.run();
    await failureReached;
    finishHeld();
    const result = await run;
    assert.equal(result.degraded, true);
    assert.equal(h.context.providerRecoveryNeeded, true);
    assert.equal(h.calls.length, 6, "five exhausted routes plus one already-started provider call");
    assert.equal(Object.keys(h.state.auditPrecision).length, 1, "the in-flight success persisted before return");
    assert.equal(h.calls.some(c => c.file === h.findings[2].file), false, "no task dispatched after stop");
  } finally { h.dispose(); }
});

test("lease failure before a task's provider dispatch stops new work and drains the active success", async () => {
  let finish!: () => void, active!: () => void, failedFence!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const providerStarted = new Promise<void>(resolve => { active = resolve; });
  const fenceFailed = new Promise<void>(resolve => { failedFence = resolve; });
  let leaseLost = false;
  const h = createHarness({
    concurrency: 2,
    fence: () => {
      if (leaseLost) { failedFence(); return true; }
      return false;
    },
    provider: async (file, route) => {
      if (file === h.findings[0].file) {
        await providerStarted;
        leaseLost = true;
        throw new Error("primary provider failed");
      }
      active();
      await held;
      return { raw: JSON.stringify({ verdicts: [{ file, line: 1, verdict: "KEEP", pattern: "none" }] }), model: route.model };
    },
  });
  try {
    const run = h.run();
    await providerStarted;
    await fenceFailed;
    finish();
    const result = await run;
    assert.equal(result.degraded, true);
    assert.equal(h.calls.length, 2, "only the two initially dispatched primary calls ran; no fallback or later task dispatched");
    assert.equal(Object.keys(h.state.auditPrecision).length, 1, "active success remains durable despite lost lease elsewhere");
  } finally { h.dispose(); }
});

test("handoff cursors remain task-local across concurrent fallback attempts", async () => {
  let active = 0, peak = 0, release!: () => void;
  const bothPrimaryCalls = new Promise<void>(resolve => { release = resolve; });
  const h = createHarness({
    concurrency: 2,
    provider: async (file, route) => {
      if (route.providerLane === "profundo") {
        active++; peak = Math.max(peak, active);
        if (active === 2) release();
        await bothPrimaryCalls;
        active--;
        throw new Error("transient provider failure");
      }
      return { raw: JSON.stringify({ verdicts: [{ file, line: 1, verdict: "KEEP", pattern: "none" }] }), model: route.model };
    },
  });
  try {
    const result = await h.run(h.findings.slice(0, 2));
    const cursors = Object.values(h.state.auditHandoff.tasks) as number[];
    assert.equal(result.kept.length, 2);
    assert.equal(peak, 2, "two remote calls overlap at the configured two-worker limit");
    assert.equal(cursors.length, 2);
    assert.deepEqual(cursors, [2, 2]);
    assert.equal(h.calls.filter(c => c.route === "profundo").length, 2);
    assert.equal(h.calls.filter(c => c.route === "standard-compute").length, 2);
  } finally { h.dispose(); }
});
