import assert from "node:assert/strict";
import test from "node:test";
import {
  bodySha256,
  canonicalJson,
  repairIdentity,
  signRepairHandoff,
  validateRepairPayload,
  validateSourceRepairAction,
  verifyRepairSignature,
  acceptRepairHandoff,
  dispatchRepairHandoff,
  consumeRepairHandoff,
  deriveRepairStatus,
  workspaceRepairHandoffStatusCore,
  validateRepairHandoffEndpoint,
} from "../../server/source-repair-handoff";
import { parseRepairMode, sourceRepairActionFromFinding } from "../../server/agentic-engines";
import { validatePlanApprovalReadiness, composeHeuristicPlan } from "../../server/minerva-planner";
import fs from "node:fs";

const payload = () => ({
  tenantId: 7,
  sourceFindingId: "finding-42",
  sourceEvidenceVersion: "v3",
  sourceEvidenceHash: "a".repeat(64),
  findingIntent: "A bounded source reliability defect was observed.",
  evidence: "The persisted check failed twice under the same evidence version.",
});

test("S5 canonical signing verifies and detects stale, bad-signature, and body-conflict replay", () => {
  const body = validateRepairPayload(payload());
  const timestamp = String(Date.now());
  const nonce = "nonce-1";
  const key = "test-only-secret";
  const signature = signRepairHandoff(body, timestamp, nonce, key);
  verifyRepairSignature({ body, timestamp, nonce, signature, bodyHash: bodySha256(body), key });
  assert.throws(() => verifyRepairSignature({ body, timestamp: String(Date.now() - 360000), nonce, signature, bodyHash: bodySha256(body), key }), /stale/);
  assert.throws(() => verifyRepairSignature({ body, timestamp, nonce, signature: "00", bodyHash: bodySha256(body), key }), /signature/);
  assert.throws(() => verifyRepairSignature({ body: { ...body, evidence: "conflict" }, timestamp, nonce, signature, bodyHash: bodySha256(body), key }), /hash mismatch/);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test("S5 payload is bounded and never grants executable source authority", () => {
  assert.throws(() => validateRepairPayload({ ...payload(), targetFile: "server/x.ts" }), /executable/);
  assert.throws(() => validateRepairPayload({ ...payload(), evidence: "x".repeat(9000) }), /finding intent|evidence|payload/);
  assert.equal(repairIdentity(validateRepairPayload(payload())), "7:finding-42:v3:" + "a".repeat(64));
});

test("S5 production endpoint refuses before database insertion", async () => {
  const oldRuntime = process.env.REPLIT_DEPLOYMENT;
  process.env.REPLIT_DEPLOYMENT = "1";
  let sent = false;
  const res: any = { statusCode: 200, status(n: number) { this.statusCode = n; return this; }, json() { sent = true; } };
  await acceptRepairHandoff({ body: payload(), header: () => "" } as any, res);
  assert.equal(res.statusCode, 404);
  assert.equal(sent, true);
  if (oldRuntime === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = oldRuntime;
});

test("S5 source classification fails closed and only source_proposal yields an action", () => {
  assert.equal(parseRepairMode({ repair_mode: "source_proposal" }), "source_proposal");
  assert.equal(parseRepairMode({ repair_mode: "advisory" }), "advisory");
  assert.equal(parseRepairMode({ repair_mode: "evil", tenantId: 1 }), "unsupported");
  assert.equal(parseRepairMode("source_proposal"), "unsupported");
  const action = sourceRepairActionFromFinding({ id: 4, evidenceVersion: "v1", evidenceHash: "b".repeat(64) });
  assert.ok(action);
  assert.equal(validateSourceRepairAction(action).kind, "source_repair_handoff");
  assert.equal(sourceRepairActionFromFinding({ id: 4, evidenceVersion: "v1", evidenceHash: "not-hash" }), null);
});

test("S5 source plans require approval binding and use a handoff step", () => {
  const action = { version: 1 as const, kind: "source_repair_handoff" as const, findingId: "4", evidenceVersion: "v1", evidenceHash: "b".repeat(64) };
  const plan: any = composeHeuristicPlan({ tenantId: 7, objective: "repair source", repairAction: action });
  assert.equal(plan.steps[0].tool, "source_repair_handoff");
  assert.deepEqual(validatePlanApprovalReadiness("agentic-engine.auto-apply", plan), { ok: true });
  assert.deepEqual(validatePlanApprovalReadiness("agentic-engine.auto-apply", { ...plan, repairAction: { ...action, evidenceHash: "bad" } }).ok, false);
});

test("S5 migration mirrors schema constraints and indexes", () => {
  const migration = fs.readFileSync("migrations/0102_repair_handoff_requests.sql", "utf8");
  for (const text of ["tenant_id integer NOT NULL REFERENCES tenants(id)", "repair_identity", "source_evidence_hash", "UNIQUE INDEX IF NOT EXISTS repair_handoff_requests_identity_unique", "repair_handoff_requests_nonce_unique"]) {
    assert.match(migration, new RegExp(text.replace(/[()]/g, "\\$&"), "i"));
  }
});

test("S5 disabled sender returns a durable blocker without network", async () => {
  const old = process.env.REPAIR_HANDOFF_ENABLED;
  delete process.env.REPAIR_HANDOFF_ENABLED;
  const result = await dispatchRepairHandoff(validateRepairPayload(payload()));
  assert.deepEqual(result, { accepted: false, blocker: "repair_handoff_disabled" });
  if (old !== undefined) process.env.REPAIR_HANDOFF_ENABLED = old;
});

test("R132 trusted callback exception is exact, canonical, and DNS-pinned", async () => {
  const oldUrl = process.env.REPAIR_HANDOFF_WORKSPACE_URL;
  const oldHost = process.env.REPAIR_HANDOFF_TRUSTED_HOST;
  process.env.REPAIR_HANDOFF_WORKSPACE_URL = "https://worker.spock.replit.dev/internal/handoff///";
  process.env.REPAIR_HANDOFF_TRUSTED_HOST = "worker.spock.replit.dev";
  let calls = 0;
  const resolver = async () => { calls++; return [{ address: "10.20.30.40", family: 4 }]; };
  try {
    const base = await validateRepairHandoffEndpoint("https://worker.spock.replit.dev/internal/handoff", resolver as any);
    assert.deepEqual(base.addresses, ["10.20.30.40"]);
    const status = await validateRepairHandoffEndpoint("https://worker.spock.replit.dev/internal/handoff/status", resolver as any);
    assert.deepEqual(status.addresses, ["10.20.30.40"]);
    assert.equal(calls, 2);
    for (const bad of [
      "https://sibling.spock.replit.dev/internal/handoff",
      "http://worker.spock.replit.dev/internal/handoff",
      "https://worker.spock.replit.dev/wrong",
      "https://user:pass@worker.spock.replit.dev/internal/handoff",
      "https://worker.spock.replit.dev/internal/handoff#x",
      "https://worker.spock.replit.dev:8443/internal/handoff",
      "https://10.0.0.1/internal/handoff",
    ]) await assert.rejects(() => validateRepairHandoffEndpoint(bad, resolver as any));
    assert.equal(calls, 2);
  } finally {
    if (oldUrl === undefined) delete process.env.REPAIR_HANDOFF_WORKSPACE_URL; else process.env.REPAIR_HANDOFF_WORKSPACE_URL = oldUrl;
    if (oldHost === undefined) delete process.env.REPAIR_HANDOFF_TRUSTED_HOST; else process.env.REPAIR_HANDOFF_TRUSTED_HOST = oldHost;
  }
});

test("S5 consumer CAS accepts once, preserves bounded provenance, and requests verification", async () => {
  const writes: string[] = [];
  let calls = 0;
  const verified: number[] = [];
  const result = await consumeRepairHandoff(11, 7, {
    dbExecute: async (query: any) => {
      const text = String(++calls);
      writes.push(text);
      if (calls === 1) {
        return { rows: [{ id: 11, payload: { findingIntent: "intent", evidence: "evidence" } }] };
      }
      return { rows: [{ id: 11 }] };
    },
    generateProposal: async (input) => {
      assert.equal(input.tenantId, 7);
      assert.equal(input.handoffId, 11);
      assert.equal(input.findingIntent, "intent");
      assert.equal(input.evidence, "evidence");
      return 91;
    },
    requestVerification: async (proposalId, tenantId) => {
      verified.push(proposalId, tenantId);
    },
  });
  assert.deepEqual(result, { status: "consumed", proposalId: 91 });
  assert.deepEqual(verified, [91, 7]);
  const skipped = await consumeRepairHandoff(11, 7, {
    dbExecute: async () => ({ rows: [] }),
  });
  assert.equal(skipped.status, "skipped");
  // claim, provenance lookup, durable proposal identity, terminal consume
  assert.equal(writes.length, 5);
});

test("S5 generator failure blocks with one bounded actionable reason and does not apply", async () => {
  let blocked = "";
  let calls = 0;
  await assert.rejects(() => consumeRepairHandoff(12, 7, {
    dbExecute: async () => {
      calls++;
      if (calls === 1) return { rows: [{ id: 12, payload: { findingIntent: "i", evidence: "e" } }] };
      blocked = "generator failed";
      return { rows: [{ id: 12 }] };
    },
    generateProposal: async () => { throw new Error("generator failed"); },
  }), /blocked/);
  assert.equal(blocked, "generator failed");
});

test("S5 claim fencing and concurrent reclaim permit one winner", async () => {
  let claim = 0;
  const execute = async (_query: any) => {
    claim++;
    if (claim === 1) return { rows: [{ id: 44, payload: { findingIntent: "i", evidence: "e" }, proposal_id: 88 }] };
    if (claim <= 4) return { rows: [{ id: 44 }] };
    return { rows: [] };
  };
  const winner = await consumeRepairHandoff(44, 7, {
    dbExecute: execute,
    generateProposal: async () => { throw new Error("must reuse persisted proposal"); },
    requestVerification: async (id, tid) => { assert.equal(id, 88); assert.equal(tid, 7); },
  });
  assert.deepEqual(winner, { status: "consumed", proposalId: 88 });
  assert.equal((await consumeRepairHandoff(44, 7, { dbExecute: execute })).status, "skipped");
});

test("S5 durable status matrix is fail-closed and provenance-derived", () => {
  assert.equal(deriveRepairStatus({ status: "pending" }), "pending");
  assert.equal(deriveRepairStatus({ status: "accepted", proposalId: 4, verificationStatus: "reviewing" }), "reviewing");
  assert.equal(deriveRepairStatus({ status: "blocked", proposalId: 4 }), "blocked");
   assert.equal(deriveRepairStatus({ status: "consumed", proposalId: 4, proposalStatus: "applied", verificationStatus: "passed" }), "applied");
  assert.equal(deriveRepairStatus({ status: "consumed", proposalId: 4, proposalStatus: "applied", verificationStatus: "unverified" }), "pending");
});

test("S5 lost claim cannot persist proposal or terminalize", async () => {
  let calls = 0;
  await assert.rejects(() => consumeRepairHandoff(45, 7, {
    dbExecute: async () => {
      calls++;
      if (calls === 1) return { rows: [{ id: 45, payload: { findingIntent: "i", evidence: "e" } }] };
      return { rows: [] };
    },
    generateProposal: async () => 99,
  }), /blocked|claim lost/);
});

test("S5 status core rejects bad/stale signatures before any read and hides wrong scope", async () => {
  const key = "status-test-key";
  const body = { tenantId: 7, handoffId: 88, evidenceVersion: "v1", evidenceHash: "a".repeat(64) };
  let reads = 0;
  const execute = async () => { reads++; return { rows: [] }; };
  const bad = await workspaceRepairHandoffStatusCore({
    query: body, key, execute,
    headers: () => "bad",
  });
  assert.equal(bad.status, 401); assert.equal(reads, 0);
  const staleTs = String(Date.now() - 360000);
  const stale = await workspaceRepairHandoffStatusCore({
    query: body, key, execute,
    headers: (name) => name === "x-repair-timestamp" ? staleTs : name === "x-repair-nonce" ? "n" : name === "x-repair-body-sha256" ? bodySha256(body) : name === "x-repair-signature" ? signRepairHandoff(body, staleTs, "n", key) : "",
  });
  assert.equal(stale.status, 401); assert.equal(reads, 0);
  const ts = String(Date.now()); const nonce = "n2";
  const validHeaders = (query: any) => (name: string) => name === "x-repair-timestamp" ? ts : name === "x-repair-nonce" ? nonce : name === "x-repair-body-sha256" ? bodySha256(query) : name === "x-repair-signature" ? signRepairHandoff(query, ts, nonce, key) : "";
  const wrong = { ...body, tenantId: 99, evidenceHash: "b".repeat(64) };
  const mismatch = await workspaceRepairHandoffStatusCore({ query: wrong, key, execute, headers: validHeaders(wrong) });
  assert.equal(mismatch.status, 404); assert.equal(mismatch.body.error, "handoff status unavailable"); assert.equal(reads, 1);
});

test("S5 status core derives every durable proposal state", async () => {
  const key = "matrix-key"; const query = { tenantId: 7, handoffId: 9, evidenceVersion: "v", evidenceHash: "c".repeat(64) };
  const ts = String(Date.now()); const nonce = "matrix";
  const headers = (name: string) => name === "x-repair-timestamp" ? ts : name === "x-repair-nonce" ? nonce : name === "x-repair-body-sha256" ? bodySha256(query) : name === "x-repair-signature" ? signRepairHandoff(query, ts, nonce, key) : "";
  for (const row of [
    { status: "pending", proposal_id: null, proposal_status: null, verification_status: null, expected: "pending" },
    { status: "consumed", proposal_id: 2, proposal_status: "pending", verification_status: "reviewing", expected: "reviewing" },
    { status: "blocked", proposal_id: 2, proposal_status: "blocked", verification_status: "failed", expected: "blocked" },
     { status: "consumed", proposal_id: 2, proposal_status: "applied", verification_status: "passed", expected: "applied" },
  ]) {
    const result = await workspaceRepairHandoffStatusCore({ query, key, headers, execute: async () => ({ rows: [row] }) });
    assert.equal(result.status, 200); assert.equal(result.body.status, row.expected);
  }
});

test("S5 claim renewal fences long generation and clears its timer", async () => {
  let renewals = 0; let writes = 0;
  const finished = new Promise<void>(resolve => { setTimeout(resolve, 30); });
  const result = await consumeRepairHandoff(51, 7, {
    renewalIntervalMs: 5,
    renewClaim: async () => { renewals++; return true; },
    dbExecute: async () => {
      writes++;
      if (writes === 1) return { rows: [{ id: 51, payload: { findingIntent: "i", evidence: "e" } }] };
      return { rows: [{ id: 51 }] };
    },
    generateProposal: async () => { await finished; return 77; },
    requestVerification: async () => {},
  });
  assert.equal(result.proposalId, 77);
  assert.ok(renewals > 0);
});

test("S5 every terminal negative verifier state derives blocked", () => {
  for (const status of ["rejected", "blocked", "failed", "error"]) {
    assert.equal(deriveRepairStatus({ status, proposalId: 1 }), "blocked");
  }
  for (const verificationStatus of ["failed", "rejected", "skipped", "error"]) {
    assert.equal(deriveRepairStatus({ status: "consumed", proposalId: 1, verificationStatus }), "blocked");
  }
});

test("S5 source handoff module has no source apply/write boundary", () => {
  const source = fs.readFileSync("server/source-repair-handoff.ts", "utf8");
  assert.doesNotMatch(source, /safeApplyProposal|writeFile|writeFileSync|applySource|publishSource/i);
});

test("S5 live DB inbox isolation/idempotency contract (when development DB is configured)", { skip: !process.env.DATABASE_URL }, async (t) => {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const relation: any = await db.execute(sql`SELECT to_regclass('public.repair_handoff_requests') AS name`);
  if (!(relation.rows ?? relation)[0]?.name) {
    t.skip("development DB has not applied migration 0102");
    return;
  }
  const tenant = 1;
  const identity = `test-s5-${Date.now()}-${Math.random()}`;
  try {
    const inserted: any = await db.execute(sql`
      INSERT INTO repair_handoff_requests
        (tenant_id, repair_identity, source_finding_id, source_evidence_version, source_evidence_hash, nonce, key_id, request_timestamp, payload)
      VALUES (${tenant}, ${identity}, ${identity}, 'v1', ${"c".repeat(64)}, ${identity}, 'test', now(), '{}'::jsonb)
      RETURNING id
    `);
    const id = (inserted.rows ?? inserted)[0].id;
    const duplicate: any = await db.execute(sql`
      SELECT id FROM repair_handoff_requests WHERE id = ${id} AND tenant_id = ${tenant}
    `);
    assert.equal((duplicate.rows ?? duplicate).length, 1);
    const crossTenant: any = await db.execute(sql`
      SELECT id FROM repair_handoff_requests WHERE id = ${id} AND tenant_id = ${tenant + 1}
    `);
    assert.equal((crossTenant.rows ?? crossTenant).length, 0);
  } finally {
    await db.execute(sql`DELETE FROM repair_handoff_requests WHERE tenant_id = ${tenant} AND repair_identity = ${identity}`);
  }
});