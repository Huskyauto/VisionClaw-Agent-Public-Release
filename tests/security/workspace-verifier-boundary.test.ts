import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../../server/db";
import { registerWorkspaceVerifierRoutes } from "../../server/routes/workspace-verifier";
import { signWorkspaceRequest, sha256Text } from "../../server/lib/workspace-verifier-contract";
import { captureVerifierSource } from "../../server/lib/workspace-verifier-source";
import { assertWorkspaceLease, workspaceSnapshotDigest, settleWorkspaceVerification, expiredWorkspaceRetryAccounting, claimWorkspaceVerification } from "../../server/lib/workspace-verifier-store";
import { sql } from "drizzle-orm";
import { verifyProposalById } from "../../server/proposal-verifier";
import { webVerifierQueueScope } from "../../server/lib/verifier-job-scope";
import { runWorkspaceVerificationTick } from "../../scripts/workspace-proposal-verifier-worker";
import { isHardHitlSurface, proposalTouchesHardContent } from "../../server/agentic/repo-surgeon-guards";

const snapshot = {
  version: 1 as const, jobId: 3, tenantId: 2, proposalId: 7, attempt: 1,
  leaseUntil: Date.now() + 300_000, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  targetFile: "server/lib/verifier-job-scope.ts", codeDiff: "bounded diff",
  sourceSha256: "a".repeat(64), contextSha256: "b".repeat(64),
};
const job = () => ({
  id: 3, tenant_id: 2, attempts: 1, status: "running",
  lease_until: new Date(snapshot.leaseUntil),
  payload: { workspaceVerifier: { nonce: snapshot.nonce, snapshotDigest: workspaceSnapshotDigest(snapshot) } },
  result: null as any,
});

test("source preflight refuses absent or mismatched worker context before any queue mutation", async () => {
  const original = db.transaction;
  (db as any).transaction = async () => { throw new Error("Queue must remain untouched"); };
  try {
    for (const context of [undefined, "invalid", "f".repeat(64)]) {
      const result = await claimWorkspaceVerification("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", context);
      assert.equal(result.state, "source_required");
      assert.match(result.contextSha256, /^[a-f0-9]{64}$/);
    }
  } finally { (db as any).transaction = original; }
});

test("a matching source claim persists its run budget with the fenced snapshot", async () => {
  const source = captureVerifierSource();
  const original = db.transaction;
  const dialect = new PgDialect();
  let binding: any;
  (db as any).transaction = async (callback: Function) => callback({ execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (/pg_advisory_xact_lock|UPDATE agent_jobs SET\s+status =/.test(q.sql)) return { rows: [] };
    if (/WHERE payload->'workspaceVerifier'->>'requestId'/.test(q.sql)) return { rows: [] };
    if (/SELECT id FROM agent_jobs WHERE status = 'running'/.test(q.sql)) return { rows: [] };
    if (/SELECT id, tenant_id, payload, attempts FROM agent_jobs/.test(q.sql)) {
      assert.match(q.sql, /paused/);
      assert.match(q.sql, /FOR UPDATE SKIP LOCKED LIMIT 1/);
      return { rows: [{ id: 3, tenant_id: 2, attempts: 0, payload: {
        proposalId: 7, workspaceVerifier: { recovery: { contextSha256: source.hash, runs: 2, paused: false } },
      } }] };
    }
    if (/SELECT target_file, code_diff/.test(q.sql)) {
      assert.match(q.sql, /tenant_id=/);
      return { rows: [{ target_file: snapshot.targetFile, code_diff: snapshot.codeDiff }] };
    }
    if (/UPDATE code_proposals/.test(q.sql)) return { rows: [] };
    if (/UPDATE agent_jobs SET status='running'/.test(q.sql)) {
      binding = JSON.parse(q.params.find(p => typeof p === "string" && p.startsWith('{"requestId"')) as string);
      return { rows: [{ id: 3 }] };
    }
    throw new Error("Unexpected claim SQL");
  } });
  try {
    const claimed = await claimWorkspaceVerification("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", source.hash);
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("Expected claim");
    assert.equal(binding.snapshotDigest, workspaceSnapshotDigest(claimed.snapshot));
    assert.deepEqual(binding.recovery, { contextSha256: source.hash, runs: 3, paused: true });
    assert.equal(claimed.snapshot.tenantId, 2);
  } finally { (db as any).transaction = original; }
});

test("lease fence binds tenant, job, attempt, nonce, every snapshot field and deadline", () => {
  const row = job();
  assert.doesNotThrow(() => assertWorkspaceLease(row, snapshot, Date.now()));
  for (const delta of [{ tenant_id: 1 }, { id: 4 }, { attempts: 2 }, { status: "pending" },
    { payload: { workspaceVerifier: { ...row.payload.workspaceVerifier, nonce: "changed" } } }]) {
    assert.throws(() => assertWorkspaceLease({ ...row, ...delta }, snapshot, Date.now()), /fenced/);
  }
  assert.throws(() => assertWorkspaceLease(row, { ...snapshot, codeDiff: "changed" }, Date.now()), /fenced/);
  assert.throws(() => assertWorkspaceLease(row, snapshot, snapshot.leaseUntil), /fenced/);
});

test("expired workspace leases restore the final retry; legacy exhaustion is unchanged", async () => {
  // Read-only execution of the exact SQL expressions used by the reclaim UPDATE.
  // No jobs, proposal rows, production credentials or fixtures are written.
  const result = await db.execute(sql`
    WITH fixtures(payload, attempts, max_attempts) AS (
      VALUES
        ('{"workspaceVerifier":{"nonce":"fixture","snapshotDigest":"fixture"}}'::jsonb, 3, 3),
        ('{}'::jsonb, 3, 3),
        ('{"workspaceVerifier":{"nonce":"fixture","snapshotDigest":"fixture"}}'::jsonb, 1, 3)
    )
    SELECT ${expiredWorkspaceRetryAccounting.status} AS status,
      ${expiredWorkspaceRetryAccounting.attempts} AS restored_attempts
    FROM fixtures
  `);
  assert.deepEqual(result.rows, [
    { status: "pending", restored_attempts: 2 },
    { status: "failed_terminal", restored_attempts: 3 },
    { status: "pending", restored_attempts: 0 },
  ]);
  assert.throws(() => assertWorkspaceLease({ ...job(), status: "pending", attempts: 0 },
    snapshot, Date.now()), /fenced/);
  const bounded = await db.execute(sql`
    WITH fixtures(payload) AS (
      VALUES ('{"workspaceVerifier":{"recovery":{"paused":true,"runs":3}}}'::jsonb), ('{}'::jsonb)
    )
    SELECT (${expiredWorkspaceRetryAccounting.nextRunAt} = '9999-01-01T00:00:00Z'::timestamptz) AS paused FROM fixtures
  `);
  assert.deepEqual(bounded.rows, [{ paused: true }, { paused: false }]);
});

test("signed routes deny before queue work and use authenticated bytes, not mutable parsed body", async () => {
  const handlers = new Map<string, Function>();
  let calls = 0;
  let enabled = true;
  registerWorkspaceVerifierRoutes({ post: (path: string, handler: Function) => handlers.set(path, handler) } as any, {
    enabled: () => enabled, key: () => "fixture-only-no-credential", now: () => 1000,
    claim: async id => { calls++; assert.equal(id, "original"); return { state: "idle" }; },
    settle: async () => { calls++; return {}; },
  });
  const path = "/internal/workspace-verifier/claim";
  const body = '{"requestId":"original"}';
  const request = {
    originalUrl: path, rawBody: Buffer.from(body), body: { requestId: "mutated" },
    headers: { "x-verifier-timestamp": "1000",
      "x-verifier-signature": signWorkspaceRequest("fixture-only-no-credential", path, body, 1000) },
  };
  let status = 200;
  const response = { status: (code: number) => { status = code; return response; }, json: () => response };
  await handlers.get(path)!(request, response);
  assert.equal(calls, 1);
  await handlers.get(path)!({ ...request, headers: {} }, response);
  assert.equal(status, 401); assert.equal(calls, 1);
  await handlers.get(path)!({ ...request, originalUrl: `${path}/` }, response);
  assert.equal(status, 401); assert.equal(calls, 1);
  enabled = false;
  await handlers.get(path)!(request, response);
  assert.equal(status, 404); assert.equal(calls, 1);
});

test("new evaluator controls and hidden aggregator edits always require owner approval", () => {
  for (const path of [
    "server/lib/workspace-verifier-store.ts", "server/routes/workspace-verifier.ts",
    "server/lib/workspace-verifier-baseline.ts", "server/lib/workspace-verifier-recovery.ts",
    "server/lib/workspace-verifier-source-artifact.ts", "scripts/provision-verifier-baseline.ts",
    "scripts/build.ts",
    "scripts/workspace-proposal-verifier-worker.ts", "server/lib/verifier-job-scope.ts",
    "server/proposal-verifier.ts", "server/lib/artifact-authority.ts", "server/research-proposals.ts",
  ]) assert.equal(isHardHitlSurface([path]).hard, true, path);
  assert.equal(proposalTouchesHardContent({
    diagnosis: "fixture", rootCause: "fixture", precedent: "fixture",
    edits: [{ path: "server/index.ts", find: 'app.use("/internal/workspace-verifier", guard)',
      replace: "app.use(parser)" }],
  }).hard, true);
});

test("snapshot computation never selects or persists development proposal rows", async () => {
  const original = db.execute;
  (db as any).execute = async () => { throw new Error("Forbidden local DB access"); };
  try {
    const result = await verifyProposalById(7, 2, { snapshot });
    assert.equal(result.status, "skipped");
    assert.match(result.details, /markers/);
    await assert.rejects(verifyProposalById(7, 1, { snapshot }), /identity/);
  } finally { (db as any).execute = original; }
});

test("workspace opt-in excludes only production queue and requires exact enabling value", () => {
  assert.equal(webVerifierQueueScope(undefined, "1", true), "exclude-verifier");
  assert.equal(webVerifierQueueScope(undefined, "1", false), "all");
  const original = process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED;
  delete process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED;
  try {
    for (const flag of [undefined, "", "true", 1, true, "1 "]) {
      assert.equal(webVerifierQueueScope(undefined, flag, true), "all");
    }
  } finally {
    if (original !== undefined) process.env.PROPOSAL_VERIFIER_WORKSPACE_ENABLED = original;
  }
});

test("consumer source and execution failures defer, clean staging and never synthesize a pass", async () => {
  let completed = 0, cleaned = 0, verified = 0, deferred = "";
  const deps = {
    ready: () => false, stopping: () => false,
    context: (): string | undefined => undefined,
    claim: async () => ({ state: "claimed", snapshot }),
    stage: () => ({ root: "fixture", cleanup: () => { cleaned++; }, assertUnchanged: () => {} }),
    verify: async () => { verified++; throw new Error("fixture timeout"); },
    settle: async (input: any) => { if (input.result) completed++; deferred = input.deferred; },
  };
  assert.equal(await runWorkspaceVerificationTick(deps), "waiting_for_memory");
  assert.equal(verified, 0);
  deps.ready = () => true;
  assert.equal(await runWorkspaceVerificationTick(deps), "waiting_for_baseline");
  deps.context = () => snapshot.contextSha256;
  assert.equal(await runWorkspaceVerificationTick(deps), "execution_deferred");
  assert.equal(deferred, "indeterminate"); assert.equal(cleaned, 1); assert.equal(completed, 0);
  deps.stage = () => { throw new Error("source mismatch"); };
  assert.equal(await runWorkspaceVerificationTick(deps), "source_deferred");
  assert.equal(deferred, "source"); assert.equal(verified, 1);
});

test("dependency drift after computation cannot settle a passing result", async () => {
  let cleaned = false, passes = 0, reason = "";
  const state = await runWorkspaceVerificationTick({
    ready: () => true, context: () => snapshot.contextSha256,
    stopping: () => false, claim: async (_id, context) => {
      assert.equal(context, snapshot.contextSha256);
      return { state: "claimed", snapshot };
    },
    stage: () => ({
      root: "fixture", cleanup: () => { cleaned = true; },
      assertUnchanged: () => { throw new Error("Changed installed dependency bytes"); },
    }),
    verify: async () => ({ status: "passed", details: "fixture", durationMs: 1 }),
    settle: async input => { if (input.result) passes++; reason = input.deferred ?? ""; },
  });
  assert.equal(state, "execution_deferred");
  assert.equal(passes, 0); assert.equal(reason, "indeterminate"); assert.equal(cleaned, true);
});

test("third inconclusive settlement is durably paused and replay does not mutate it", async () => {
  const row = job();
  Object.assign(row.payload.workspaceVerifier, {
    recovery: { contextSha256: snapshot.contextSha256, runs: 3, paused: true },
  });
  const original = db.transaction;
  const dialect = new PgDialect();
  let updates = 0;
  (db as any).transaction = async (callback: Function) => callback({ execute: async (query: any) => {
    const q = dialect.sqlToQuery(query);
    if (/SELECT id, tenant_id, attempts/.test(q.sql)) return { rows: [row] };
    assert.match(q.sql, /UPDATE agent_jobs/);
    assert.match(q.sql, /'9999-01-01T00:00:00Z'::timestamptz/);
    assert.match(q.sql, /WHERE id=.*AND tenant_id=/s);
    assert.ok(q.params.some(p => typeof p === "string" && p.includes('"paused":true')));
    row.status = "pending";
    row.result = JSON.parse(q.params.find(p => typeof p === "string" && p.startsWith('{"workspaceOutcomeDigest"')) as string);
    updates++;
    return { rows: [] };
  } });
  try {
    const input = { snapshot, deferred: "indeterminate" as const };
    assert.deepEqual(await settleWorkspaceVerification(input), { state: "paused" });
    assert.deepEqual(await settleWorkspaceVerification(input), { state: "already_settled" });
    assert.equal(updates, 1);
  } finally { (db as any).transaction = original; }
});

test("verdict and job completion share one transaction; failed fencing rolls both back", async () => {
  const source = captureVerifierSource();
  const exact = { ...snapshot, contextSha256: source.hash,
    sourceSha256: sha256Text(source.files.get(snapshot.targetFile)!.toString("utf8")) };
  const row = { ...job(), payload: { workspaceVerifier: {
    nonce: exact.nonce, snapshotDigest: workspaceSnapshotDigest(exact),
  } } };
  let verdict = "unverified", completionAllowed = false;
  const original = db.transaction;
  const dialect = new PgDialect();
  (db as any).transaction = async (callback: Function) => {
    const saved = { verdict, status: row.status, result: row.result };
    try {
      return await callback({ execute: async (query: any) => {
        const q = dialect.sqlToQuery(query);
        if (/SELECT id, tenant_id, attempts/.test(q.sql)) return { rows: [row] };
        if (/UPDATE code_proposals/.test(q.sql)) { verdict = q.params[0] as string; return { rows: [{ id: 7 }] }; }
        if (/UPDATE agent_jobs/.test(q.sql)) {
          assert.match(q.sql, /attempts=.*lease_until>NOW\(\)/s);
          if (!completionAllowed) return { rows: [] };
          row.status = "succeeded";
          row.result = JSON.parse(q.params.find((p: any) => typeof p === "string" && p.startsWith('{"status"')) as string);
          return { rows: [{ id: 3 }] };
        }
        throw new Error("Unexpected SQL in isolated transaction fixture");
      } });
    } catch (error) { verdict = saved.verdict; row.status = saved.status; row.result = saved.result; throw error; }
  };
  try {
    const input = { snapshot: exact, result: { status: "failed" as const, details: "fixture type error", durationMs: 1 } };
    await assert.rejects(settleWorkspaceVerification(input), /fenced/);
    assert.equal(verdict, "unverified"); assert.equal(row.status, "running");
    completionAllowed = true;
    assert.deepEqual(await settleWorkspaceVerification(input), { state: "completed" });
    assert.equal(verdict, "failed"); assert.equal(row.status, "succeeded");
    assert.deepEqual(await settleWorkspaceVerification(input), { state: "already_settled" });
  } finally { (db as any).transaction = original; }
});
