// Query-free regression guard for the internal-resolver tenant-scoping fix
// (tenant-isolation triage campaign 2026-07-31, completion-review finding).
//
// The resolver receives only an eventId + planId. The fix derives the tenant
// from the event_log row itself and enforces it at the database boundary, so
// a corrupted or mis-associated planId can never read or flip another
// tenant's plan through this internal pathway.
//
// A live-DB test would keep the pg pool open and hang the suite (see
// .agents/memory/node-test-db-pool-hang.md), so this pins the source contract
// statically: the specific predicates and the decidePlan tenant pass-through
// must stay present. Comments are stripped first (static-guard-comment-trip).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const SRC_PATH = "server/internal-resolver.ts";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const src = stripComments(fs.readFileSync(SRC_PATH, "utf8"));

test("resolvePlanProposed derives the tenant from the event_log row", () => {
  assert.match(
    src,
    /SELECT tenant_id FROM event_log WHERE id = \$\{eventId\}/,
    "resolver must load the event's tenant before touching the plan",
  );
});

test("resolvePlanProposed fails closed when the event row or its tenant is missing", () => {
  assert.match(
    src,
    /evRow\.tenant_id == null[\s\S]{0,400}?resolved:\s*false/,
    "missing event/tenant must abort resolution, not fall back to id-only reads",
  );
});

test("the plan SELECT is constrained to the event's tenant", () => {
  assert.match(
    src,
    /FROM plans WHERE id = \$\{planId\} AND tenant_id = \$\{tenantId\}/,
    "plan lookup must carry AND tenant_id — a foreign planId must resolve as orphan",
  );
});

test("decidePlan is called WITH the event tenant (no id-only CAS)", () => {
  // Note: a non-greedy match to `});` would stop early inside the template
  // literal reason (it contains `);`), so slice a fixed window instead.
  const start = src.indexOf("await decidePlan({");
  assert.ok(start >= 0, "decidePlan call not found");
  const callBlock = src.slice(start, start + 500);
  assert.match(callBlock, /actor:\s*RESOLVER_ACTOR,\s*tenantId/, "decidePlan must receive tenantId so the CAS UPDATE is tenant-scoped");
});

test("finalizeEvent supports and receives tenant scoping on the plan path", () => {
  assert.match(
    src,
    /function finalizeEvent\(eventId: number, terminalStatus: string, result: any, tenantId\?: number\)/,
    "finalizeEvent must accept a tenantId",
  );
  assert.match(
    src,
    /AND tenant_id = \$\{tenantId\}/,
    "finalizeEvent must apply AND tenant_id when a tenant is provided",
  );
  // Every finalizeEvent call inside resolvePlanProposed must pass tenantId.
  const fnBody = src.slice(src.indexOf("async function resolvePlanProposed"), src.indexOf("async function resolveExperimentFailed"));
  const calls = fnBody.match(/finalizeEvent\([\s\S]*?\);/g) || [];
  assert.ok(calls.length >= 4, `expected ≥4 finalizeEvent calls in resolvePlanProposed, found ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /,\s*tenantId\s*\)\s*;$/, `finalizeEvent call missing tenantId: ${c.slice(0, 80)}`);
  }
});
