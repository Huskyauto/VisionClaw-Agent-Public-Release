/**
 * Explicit development-only self-pilot. No model calls, sends or publication.
 * Creates one temporary owner conversation and exact synthetic run IDs, exercises
 * the guarded executor + real private store, then removes only those fixtures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool } from "../server/db";
import { conversations } from "../shared/schema";
import { and, eq } from "drizzle-orm";
import { executeGuardedTool } from "../server/guarded-tool-executor";
import { executeTool } from "../server/tools";
import { withPilotStore } from "../server/lib/business-pilot-store";
import { deletePilotRun } from "../server/lib/business-pilot-state";
import { RELEASE_AREAS } from "../shared/business-pilots/release";
import { GOVERNANCE_CONTROLS } from "../shared/business-pilots/governance";
import type { PilotKind } from "../shared/business-pilots";

if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
  throw new Error("Self-pilot is development only");
const tenantId = Number(process.env.ADMIN_TENANT_ID || 1);
const ids: { kind: PilotKind; id: string }[] = [];
let conversationId: number | undefined;
async function main() {
  const [conversation] = await db.insert(conversations).values({
    tenantId, personaId: 2, title: `Temporary business-pilot diagnostics ${randomUUID()}`,
  }).returning({ id: conversations.id });
  conversationId = conversation.id;
  const ctx = { tenantId, personaId: 2, conversationId, personaName: "Felix", personaRole: "Chief Executive Officer",
    invokedVia: "main_chat" as const, allowedToolNames: ["business_pilot"] };
  const invoke = async (args: Record<string, unknown>) => {
    const result = await executeGuardedTool("business_pilot", args, ctx);
    assert.equal(result?.error, undefined, JSON.stringify(result));
    assert.equal(result?.ok, true);
    return result;
  };
  const today = new Date().toISOString().slice(0, 10);
  const baseHealth = { business: "Synthetic self-pilot — not business records", reference: "diagnostic-fixture",
    currency: "USD", start: "2026-08-01", end: "2026-08-31", calls: 100, missedCalls: 20 };
  const inputs = {
    health: baseHealth,
    release: { product: "Synthetic diagnostic candidate", version: "fixture",
      checks: RELEASE_AREAS.map(area => ({ area: area.id, status: "unknown", evidence: "", checkedAt: today })) },
    governance: { organization: "Synthetic diagnostic fixture", scope: "No certification",
      controls: GOVERNANCE_CONTROLS.map(control => ({ control: control.id, status: "unknown", owner: "", evidence: "", reviewedAt: today })) },
    cost: { business: "Synthetic calculation fixture", start: today, end: today, currency: "USD",
      rows: [{ workload: "Fixture", model: "Synthetic A", inputTokens: 1_000_000, outputTokens: 500_000,
        inputRate: 2, outputRate: 8, rateDate: today, rateSource: "Synthetic fixture, not a vendor quote" }] },
  };
  for (const kind of ["health", "release", "governance", "cost"] as const) {
    const description = await invoke({ action: "describe", kind });
    assert.ok(description.inputSchema);
    const requestId = randomUUID(); ids.push({ kind, id: requestId });
    const args = { action: "run", kind, requestId, input: inputs[kind] };
    const result = await invoke(args);
    const retrieved = await invoke({ action: "get", kind, runId: requestId });
    assert.deepEqual(retrieved.run, result.run);
    if (kind === "health") {
      assert.equal(result.run.result.metrics[0].value, 20);
      assert.deepEqual((await invoke(args)).run, result.run);
    }
    if (kind === "release" || kind === "governance")
      assert.ok(result.run.result.findings.every((finding: any) => finding.status !== "reported"));
    if (kind === "cost") assert.equal(result.run.result.metrics[0].value, 6);
    console.log(`PASS ${kind}: guarded run, real private persistence and retrieval`);
  }
  const rescanId = randomUUID(); ids.push({ kind: "health", id: rescanId });
  const rescan = await invoke({ action: "run", kind: "health", requestId: rescanId, baselineId: ids[0].id,
    input: { ...baseHealth, start: "2026-09-01", end: "2026-09-30", missedCalls: 10 } });
  assert.equal(rescan.run.result.metrics[0].delta, -10);
  console.log("PASS health re-scan: saved baseline and -10 percentage-point delta");
  const readiness = await invoke({ action: "run", kind: "readiness", input: { url: "https://agenticcorporation.net/" } });
  assert.equal(readiness.result.checks.length, 5);
  console.log("PASS readiness: real public website; " + JSON.stringify({
    pages: readiness.result.pages, checks: readiness.result.checks.map((c: any) => ({ id: c.id, status: c.status })),
  }));
  const direct = await executeTool("business_pilot", { action: "list", kind: "health",
    _tenantId: tenantId, _personaId: 2, _conversationId: conversationId, _invokedVia: "main_chat" });
  assert.ok(direct.error);
  for (const change of [{ tenantId: tenantId + 1 }, { invokedVia: "system" as const }, { personaId: 1 }]) {
    const result = await executeGuardedTool("business_pilot", { action: "list", kind: "health",
      _tenantId: tenantId, _personaId: 2, _invokedVia: "main_chat" }, { ...ctx, ...change });
    assert.ok(result.error);
  }
  console.log("PASS forged direct dispatch, other tenant, background channel and wrong persona refused");
}
let exitCode = 0;
try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : "Self-pilot failed"); exitCode = 1; }
finally {
  for (const { kind, id } of [...ids].reverse())
    await withPilotStore(tenantId, kind, runs => ({ runs: runs.some(r => r.id === id) ? deletePilotRun(runs, id) : runs, value: true }));
  if (conversationId) await db.delete(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));
  await pool.end();
  console.log("Self-pilot temporary runs and conversation cleaned up");
}
// App imports own background timers; this bounded diagnostic is not a worker.
process.exit(exitCode);
