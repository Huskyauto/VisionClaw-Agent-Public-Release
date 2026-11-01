import test from "node:test";
import assert from "node:assert/strict";
import { runTenantAuditJob, type TenantAuditRunnerPorts } from "../../server/lib/tenant-audit-runner";
import type { AgentJob } from "../../server/job-queue";
import { TenantAuditLeaseLost } from "../../server/lib/tenant-audit-job-state";
import { readFileSync } from "node:fs";

const sourceHash = "a".repeat(64);
const job = { id: 9, attempts: 1, tenantId: 1, kind: "tenant_isolation_audit",
  payload: { tenantId: 1, window: "2026-10-24", sourceHash,
    dedupeKey: `tenant-audit:2026-10-24:${sourceHash}` } } as AgentJob;
function harness(code: number, report: any = { degraded: true }) {
  const calls: string[] = [];
  const ports: TenantAuditRunnerPorts = {
    state: async () => ({ auditSlices: 1, auditReport: report }),
    acquire: async () => async () => { calls.push("release"); },
    claimSlice: async () => { calls.push("claim"); },
    child: async () => { calls.push("child"); return { code, deadline: false }; },
    continue: async () => { calls.push("continue"); },
    outage: async () => { calls.push("backoff"); },
    recordFailure: async () => { calls.push("failure"); },
    command: () => ({ command: "offline-mock", args: [] }),
  };
  return { ports, calls };
}
test("completed source slices continue the same durable job, never claim full coverage", async () => {
  const h = harness(7);
  assert.deepEqual(await runTenantAuditJob(job, h.ports), { status: "incomplete", continued: true });
  assert.deepEqual(h.calls, ["claim", "child", "continue", "release"]);
});
test("provider failure retains state and records a bounded failure instead of success", async () => {
  const h = harness(5);
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /incomplete or provider unavailable/);
  assert.deepEqual(h.calls, ["claim", "child", "failure", "release"]);
});
test("full coverage with severe findings is distinct from a clean audit", async () => {
  const h = harness(4, { degraded: false, coverage: { scanned: 829, filesAudited: 829,
    chunksAttempted: 325, chunksSucceeded: 325, chunksFailed: 0, chunksPending: 0,
    sourceChangedDuringRun: false, unreadableFiles: [] } });
  assert.equal((await runTenantAuditJob(job, h.ports)).status, "findings_require_attention");
  assert.deepEqual(h.calls, ["claim", "child", "release"]);
});
test("a nondegraded label alone cannot turn missing coverage into success", async () => {
  const h = harness(0, { degraded: false, coverage: { scanned: 829, filesAudited: 0 } });
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /incomplete/);
  assert.ok(h.calls.includes("failure"));
});
test("wrong tenant cannot dispatch even if caller supplies an owner-looking payload", async () => {
  const h = harness(0);
  await assert.rejects(() => runTenantAuditJob({ ...job, tenantId: 2 }, h.ports), /authority/);
  assert.deepEqual(h.calls, []);
});
test("capacity deferral never starts a child or consumes a real failure", async () => {
  const h = harness(0);
  h.ports.acquire = async () => null;
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /Heavy-work lane/);
  assert.deepEqual(h.calls, []);
});
test("admission loss before dispatch stops the child path", async () => {
  const h = harness(0);
  h.ports.acquire = async onLost => { onLost(); return async () => { h.calls.push("release"); }; };
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /admission lost/);
  assert.deepEqual(h.calls, ["claim", "failure", "release"]);
});
test("unavailable admission defers without dispatch or consuming an audit failure", async () => {
  const h = harness(0);
  h.ports.acquire = async () => { throw Error("admission DB unreachable"); };
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /Heavy-work lane/);
  assert.deepEqual(h.calls, []);
});
test("missing bundle stops rather than repeatedly retrying configuration", async () => {
  const h = harness(0);
  h.ports.command = () => { throw Error("unavailable"); };
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /preflight unavailable/);
  assert.deepEqual(h.calls, []);
});
test("transient preflight read failure uses the bounded failure counter without dispatch", async () => {
  const h = harness(0);
  h.ports.state = async () => { throw Error("temporary DB outage"); };
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /temporary DB outage/);
  assert.deepEqual(h.calls, ["failure"]);
});
test("known stale authority fails closed without consuming another claim's failure budget", async () => {
  const h = harness(0);
  h.ports.state = async () => { throw new TenantAuditLeaseLost("stale claim"); };
  await assert.rejects(() => runTenantAuditJob(job, h.ports), /stale claim/);
  assert.deepEqual(h.calls, []);
});

test("exhausted provider ladder backs off on the same job without terminal failure", async () => {
  const h = harness(8);
  h.ports.outage = async () => { h.calls.push("backoff"); };
  assert.deepEqual(await runTenantAuditJob(job, h.ports), { status: "provider_backoff", continued: true });
  assert.deepEqual(h.calls, ["claim", "child", "backoff", "release"]);
});

test("a stuck child hands off after its hard deadline rather than exhausting the old three-failure stop", async () => {
  const h = harness(5);
  h.ports.child = async () => { h.calls.push("child"); return { code: 5, deadline: true }; };
  h.ports.outage = async () => { h.calls.push("backoff"); };
  assert.equal((await runTenantAuditJob(job, h.ports)).status, "provider_backoff");
  assert.deepEqual(h.calls, ["claim", "child", "backoff", "release"]);
});

test("scheduled child preserves an operator's explicit Profundo disable", () => {
  const source = readFileSync("server/lib/tenant-audit-runner.ts", "utf8");
  assert.match(source, /PROFUNDO_ENABLED: process\.env\.PROFUNDO_ENABLED === "0" \? "0" : "1"/);
});
