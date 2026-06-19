// R101 — Causality graphs unit tests (node:test runner).
//
// Coverage:
//  1. withRootSpan opens a root span and persists ok status on success
//  2. withSpan under a root creates a child span linked by parent_span_id
//  3. fetchTraceTree returns a tree with the correct shape
//  4. Tenant isolation: tenant B cannot read tenant A's trace
//  5. withSpan tagged "declined" when result has policy-style error envelope
//  6. withSpanOrRoot opens implicit root when no trace context active

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../server/db";
import { withTenantContext } from "../../server/lib/tenant-context";
import {
  withRootSpan,
  withSpan,
  withSpanOrRoot,
  fetchTraceTree,
  _flushTracesForTests,
} from "../../server/lib/agent-trace";

const TENANT_A = 9_910_000 + Math.floor(Math.random() * 90_000);
const TENANT_B = TENANT_A + 1;

after(async () => {
  await pool.query(`DELETE FROM agent_trace_spans WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]).catch(() => {});
});

test("R101 withRootSpan persists root span with ok status", async () => {
  const traceId = await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
    withRootSpan({ agentName: "Felix", summary: "test root" }, async (tid) => {
      return tid;
    }),
  );
  assert.match(traceId, /^[0-9a-f-]{36}$/i);
  await _flushTracesForTests();
  const r: any = await pool.query(
    `SELECT kind, status, agent_name, summary FROM agent_trace_spans WHERE tenant_id=$1 AND trace_id=$2`,
    [TENANT_A, traceId],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].kind, "chat");
  assert.equal(r.rows[0].status, "ok");
  assert.equal(r.rows[0].agent_name, "Felix");
});

test("R101 withSpan creates child linked by parent_span_id, fetchTraceTree returns tree", async () => {
  let capturedTraceId = "";
  await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
    withRootSpan({ agentName: "Felix", summary: "tree test" }, async (tid) => {
      capturedTraceId = tid;
      await withSpan({ kind: "tool", toolName: "list_files", summary: "list" }, async () => ({ files: [] }));
      await withSpan({ kind: "tool", toolName: "read_file", summary: "read" }, async () => ({ content: "abc" }));
      return tid;
    }),
  );

  await _flushTracesForTests();
  const { spans, tree } = await fetchTraceTree(TENANT_A, capturedTraceId);
  assert.equal(spans.length, 3);
  assert.ok(tree, "tree should be non-null");
  assert.equal(tree.kind, "chat");
  assert.equal(tree.children.length, 2);
  const toolNames = tree.children.map((c: any) => c.toolName).sort();
  assert.deepEqual(toolNames, ["list_files", "read_file"]);
});

test("R101 fetchTraceTree is tenant-scoped (B cannot read A)", async () => {
  let traceId = "";
  await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
    withRootSpan({ summary: "tenant-A-only" }, async (tid) => { traceId = tid; }),
  );
  await _flushTracesForTests();
  const { spans } = await fetchTraceTree(TENANT_B, traceId);
  assert.equal(spans.length, 0, "tenant B must not see tenant A spans");
});

test("R101 withSpan tags status='declined' when result.error mentions policy", async () => {
  let traceId = "";
  await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
    withRootSpan({ summary: "decline test" }, async (tid) => {
      traceId = tid;
      await withSpan({ kind: "tool", toolName: "stripe_create_payout" }, async () => ({ error: "policy_block: requires approval" }));
    }),
  );
  await _flushTracesForTests();
  const r: any = await pool.query(
    `SELECT status, summary FROM agent_trace_spans WHERE tenant_id=$1 AND trace_id=$2 AND tool_name='stripe_create_payout'`,
    [TENANT_A, traceId],
  );
  assert.equal(r.rows[0].status, "declined");
  assert.match(String(r.rows[0].summary), /policy/i);
});

test("R101 withSpanOrRoot opens implicit root when no trace context active", async () => {
  let traceIdSeenInside = "";
  const result: any = await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
    withSpanOrRoot({ kind: "tool", toolName: "standalone_call", summary: "no-parent" }, async () => {
      // Imitate any tool call producing a result envelope.
      return { ok: true };
    }),
  );
  assert.ok(result.__trace?.traceId, "implicit root must surface __trace.traceId");
  traceIdSeenInside = result.__trace.traceId;
  await _flushTracesForTests();
  const { spans } = await fetchTraceTree(TENANT_A, traceIdSeenInside);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].toolName, "standalone_call");
  assert.equal(spans[0].status, "ok");
});

test("R101 withSpan auto-marks status='error' on thrown exception", async () => {
  let traceId = "";
  try {
    await withTenantContext({ tenantId: TENANT_A, source: "explicit" }, async () =>
      withRootSpan({ summary: "error test" }, async (tid) => {
        traceId = tid;
        await withSpan({ kind: "tool", toolName: "throwing_tool" }, async () => {
          throw new Error("simulated tool crash");
        });
      }),
    );
  } catch (_e) { /* expected */ }
  await _flushTracesForTests();
  const r: any = await pool.query(
    `SELECT status, summary FROM agent_trace_spans WHERE tenant_id=$1 AND trace_id=$2 AND tool_name='throwing_tool'`,
    [TENANT_A, traceId],
  );
  assert.equal(r.rows[0].status, "error");
  assert.match(String(r.rows[0].summary), /simulated tool crash/);
});
