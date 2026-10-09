/** One bounded development-only acceptance run; never run against a deployment. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { isProductionRuntime } from "../server/lib/runtime-env";

async function main() {
  if (isProductionRuntime()) throw new Error("Development acceptance refuses production");
  const { storage } = await import("../server/storage");
  const { ADMIN_TENANT_ID } = await import("../server/auth");
  const { processMessage } = await import("../server/chat-engine");
  const { isInvestigatedJuryDecision } = await import("../server/lib/jury-package");
  const fixture = await readFile("tests/unit/jury-evidence.test.ts", "utf8");
  const request = fixture.match(/const request = `([\s\S]*?)`;/)?.[1];
  assert.ok(request, "Exact Spark request fixture required");
  const conv = await storage.createConversation({
    tenantId: ADMIN_TENANT_ID, personaId: 2, title: "Development independent jury acceptance",
    model: "openference/deepseek-v4-pro",
  });
  console.log("[jury-acceptance] Development conversation:", conv.id);
  const result = await processMessage(conv.id, request, {
    tenantId: ADMIN_TENANT_ID, source: "api-v1", enableTools: true,
  });
  const tool = result.toolsUsed.find(t => t.name === "jury_triage");
  assert.ok(tool && isInvestigatedJuryDecision(tool.output), "Investigative package required");
  const decision = tool.output;
  const p = decision.investigation!;
  const rows = await storage.getMessages(conv.id, ADMIN_TENANT_ID);
  const saved = [...rows].reverse().find(row => row.role === "assistant");
  assert.ok(saved, "Persisted assistant answer required");
  const receiptIds = decision.votes.flatMap(v => v.evidence?.receipts.map(r => r.id) ?? []);
  const primaryResponses = decision.votes[0]?.evidence?.receipts.find(r =>
    r.tool === "sessions_history")?.contextInspection?.primaryInferenceReceipts ?? [];
  const report = {
    environment: "development", conversationId: conv.id, verdict: decision.verdict,
    requirementCoverage: p.requirementCoverage, needsHumanReview: p.needsHumanReview,
    requirements: p.requirements, primaryRoute: result.model, primaryResponses,
    jurors: decision.votes.map(v => ({
      model: v.reportedModel ?? null, lane: v.providerLane, verdict: v.verdict,
      evidenceRun: v.evidence?.runId, receipts: v.evidence?.receipts.map(r => ({
        id: r.id, tool: r.tool, ok: r.ok, startedAt: r.startedAt, completedAt: r.completedAt,
      })),
    })),
    aggregate: p.aggregateIdentity, toolNames: result.toolsUsed.map(t => t.name),
    allReceiptsInSavedAnswer: receiptIds.every(id => saved.content.includes(id)),
    savedAnswerBytes: Buffer.byteLength(saved.content),
  };
  await mkdir(".local/jury-acceptance", { recursive: true });
  await writeFile(`.local/jury-acceptance/${conv.id}.json`, JSON.stringify(report, null, 2));
  console.log("[jury-acceptance] Evidence:", JSON.stringify(report));
  assert.equal(decision.votes.length, 3);
  assert.equal(new Set(decision.votes.map(v => v.evidence?.runId)).size, 3);
  assert.equal(receiptIds.length, 6);
  assert.equal(new Set(receiptIds).size, 6);
  assert.deepEqual(result.toolsUsed.map(t => t.name), ["jury_triage"]);
  assert.equal(p.requirementCoverage, 1, "Every requirement must be evidenced, not inferred");
  assert.ok(primaryResponses.length > 0 && primaryResponses.every(r =>
    r.requestedModel === "gpt-5.4" && r.responseModel?.startsWith("gpt-5.4")),
    "Primary pin requires native response evidence, not the saved model or requested route");
  assert.equal(report.allReceiptsInSavedAnswer, true);
  assert.ok(decision.votes.every(v => v.evidence?.receipts.every(r =>
    saved.content.includes(r.sha256))), "Receipt digests must survive mandatory egress");
  for (const section of ["### Disagreements", "### Explicit unknowns", "### Context provenance findings", "### Aggregate analysis"]) {
    assert.ok(saved.content.includes(section), `Persisted response lost ${section}`);
  }
  console.log("[jury-acceptance] PASS: exact request, three separate runs, six receipts, response identities, full persisted package.");
}

main().then(() => process.exit(0)).catch(error => {
  console.error("[jury-acceptance] FAIL:", error.message);
  process.exit(1);
});
