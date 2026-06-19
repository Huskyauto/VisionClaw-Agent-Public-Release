import { db } from "server/db";
import { sql } from "drizzle-orm";
import { pinHypothesis, attachEvidence, listEvidence, renderPinnedBlock } from "server/lib/pinned-hypotheses";
import { applyPlanEdits, queryPlan } from "server/lib/plan-graph";

async function main() {
  const TENANT = 9999;
  const PLAN = `r108-smoke-${Date.now()}`;
  console.log("=== R108 smoke test ===");

  // Cleanup any prior smoke rows.
  await db.execute(sql`DELETE FROM hypothesis_evidence_edges WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM pinned_hypotheses WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM plan_nodes WHERE tenant_id = ${TENANT}`);

  // (A) plan_graph_edit with maxSteps
  const r1 = await applyPlanEdits({ tenantId: TENANT, planId: PLAN, ops: [
    { op: "ADD_NODE", nodeId: "n1", label: "easy fetch", maxSteps: 3 },
    { op: "ADD_NODE", nodeId: "n2", label: "hard explore", dependsOn: ["n1"], maxSteps: 80 },
    { op: "ADD_NODE", nodeId: "n3", label: "default budget", dependsOn: ["n2"] }, // null
  ]});
  console.log("[A] applied:", r1.applied, "size:", r1.planSize);
  const q1 = await queryPlan({ tenantId: TENANT, planId: PLAN });
  const budgets = q1.nodes.map((n: any) => `${n.nodeId}=${n.maxSteps ?? "null"}`).join(",");
  console.log("[A] budgets:", budgets);
  if (!/n1=3,n2=80,n3=null/.test(budgets)) throw new Error("maxSteps roundtrip failed");

  // Update maxSteps via UPDATE_NODE
  await applyPlanEdits({ tenantId: TENANT, planId: PLAN, ops: [
    { op: "UPDATE_NODE", nodeId: "n1", maxSteps: 5 },
    { op: "UPDATE_NODE", nodeId: "n3", maxSteps: null }, // explicit null
  ]});
  const q2 = await queryPlan({ tenantId: TENANT, planId: PLAN });
  const b2 = q2.nodes.map((n: any) => `${n.nodeId}=${n.maxSteps ?? "null"}`).join(",");
  console.log("[A] post-update budgets:", b2);
  if (!/n1=5/.test(b2)) throw new Error("UPDATE_NODE maxSteps failed");

  // (B) pin + attach evidence + render
  const TTL_MIN = 10;
  const beforeMs = Date.now();
  const h = await pinHypothesis({ tenantId: TENANT, hypothesis: "Smoke test hypothesis A", confidence: 0.8, ttlMinutes: TTL_MIN });
  const afterMs = Date.now();
  console.log("[B] pinned id:", h.id);
  // Verify ttlMinutes actually applied (not silently dropped to default 240).
  const ttlRow = await db.execute(sql`SELECT expires_at FROM pinned_hypotheses WHERE id = ${h.id} AND tenant_id = ${TENANT}`);
  const expRow: any = ((ttlRow as any).rows || ttlRow)[0];
  if (!expRow?.expires_at) throw new Error("pin missing expires_at");
  const expMs = new Date(expRow.expires_at).getTime();
  const expectedMin = beforeMs + (TTL_MIN * 60_000) - 5_000; // 5s tolerance
  const expectedMax = afterMs + (TTL_MIN * 60_000) + 5_000;
  console.log("[B] ttl window: actual_expires=", new Date(expMs).toISOString(), " want ~", TTL_MIN, "min from now");
  if (expMs < expectedMin || expMs > expectedMax) {
    throw new Error(`ttlMinutes not honored: got ${(expMs - beforeMs) / 60_000}min, want ~${TTL_MIN}min (likely silent default 240min)`);
  }
  const e1 = await attachEvidence({ tenantId: TENANT, hypothesisId: h.id, evidenceKind: "free_text", evidenceRef: "Observed log line X confirms it", confidence: 0.9, note: "high-signal" });
  const e2 = await attachEvidence({ tenantId: TENANT, hypothesisId: h.id, evidenceKind: "memory_entry", evidenceRef: "12345", confidence: 0.7 });
  console.log("[B] attached edges:", e1.id, e2.id);
  const list = await listEvidence({ tenantId: TENANT, hypothesisId: h.id });
  console.log("[B] listEvidence count:", list.length, "top conf:", list[0]?.confidence);
  if (list.length !== 2 || list[0].confidence !== 0.9) throw new Error("evidence chain ordering wrong");

  const block = await renderPinnedBlock({ tenantId: TENANT });
  console.log("[B] rendered block (truncated):");
  console.log(block.split("\n").slice(0, 12).join("\n"));
  if (!block.includes("evidence [90% via free_text]")) throw new Error("renderPinnedBlock missing evidence line");

  // Cross-tenant attach must fail
  let crossOk = false;
  try { await attachEvidence({ tenantId: 8888, hypothesisId: h.id, evidenceKind: "free_text", evidenceRef: "leak attempt" }); }
  catch (e: any) { crossOk = /not found in this tenant/.test(e.message); }
  console.log("[B] cross-tenant rejected:", crossOk);
  if (!crossOk) throw new Error("cross-tenant attach was NOT rejected");

  // Bad evidence_kind must fail
  let badKindOk = false;
  try { await attachEvidence({ tenantId: TENANT, hypothesisId: h.id, evidenceKind: "bogus", evidenceRef: "x" }); }
  catch (e: any) { badKindOk = /evidenceKind must be one of/.test(e.message); }
  console.log("[B] bad-kind rejected:", badKindOk);
  if (!badKindOk) throw new Error("bad evidence_kind not rejected");

  // maxSteps clamping
  await applyPlanEdits({ tenantId: TENANT, planId: PLAN, ops: [
    { op: "ADD_NODE", nodeId: "n4", label: "clamp test", maxSteps: 99999 },
    { op: "ADD_NODE", nodeId: "n5", label: "clamp low", maxSteps: -5 },
  ]});
  const q3 = await queryPlan({ tenantId: TENANT, planId: PLAN });
  const n4 = q3.nodes.find((n: any) => n.nodeId === "n4");
  const n5 = q3.nodes.find((n: any) => n.nodeId === "n5");
  console.log("[A] clamp n4:", n4?.maxSteps, "n5:", n5?.maxSteps);
  if (n4?.maxSteps !== 200) throw new Error("upper clamp failed");
  if (n5?.maxSteps !== 1) throw new Error("lower clamp failed");

  // Cleanup
  await db.execute(sql`DELETE FROM hypothesis_evidence_edges WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM pinned_hypotheses WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM plan_nodes WHERE tenant_id = ${TENANT}`);

  console.log("=== R108 smoke test: ALL PASS ===");
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
