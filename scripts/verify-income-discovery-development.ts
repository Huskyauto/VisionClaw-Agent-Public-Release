/** One authorized development run; no retries, deployment or customer action. */
import assert from "node:assert/strict";
import { isProductionRuntime } from "../server/lib/runtime-env";

async function main() {
  if (isProductionRuntime()) throw new Error("Income acceptance refuses production");
  const { storage } = await import("../server/storage");
  const { ADMIN_TENANT_ID } = await import("../server/auth");
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  // Validate the real receipt schema before inference can incur any spend.
  await db.execute(sql`SELECT id, proposer_details_json, aggregated_answer
    FROM moa_responses WHERE tenant_id=${ADMIN_TENANT_ID} LIMIT 0`);
  if (process.argv[2] === "--receipt-only") {
    const receiptId = Number(process.argv[3]), conversationId = Number(process.argv[4]);
    assert.ok([receiptId, conversationId].every(id => Number.isSafeInteger(id) && id > 0));
    const saved = await db.execute(sql`SELECT proposer_details_json, aggregated_answer
      FROM moa_responses WHERE id=${receiptId} AND tenant_id=${ADMIN_TENANT_ID}`);
    assert.equal(saved.rows.length, 1);
    const result = JSON.parse(String(saved.rows[0].proposer_details_json)) as import("../server/lib/income-discovery").IncomeDiscoveryResult;
    const report = String(saved.rows[0].aggregated_answer);
    const messages = await storage.getMessages(conversationId, ADMIN_TENANT_ID);
    const assistant = [...messages].reverse().find(m => m.role === "assistant");
    const fullReportRetained = !!assistant?.content.includes(report);
    console.log("[income-acceptance] retained", JSON.stringify({ receiptId, conversationId,
      status: result.status, coverage: result.requirementCoverage, fullReportRetained,
      reportBytes: Buffer.byteLength(report), answerBytes: Buffer.byteLength(assistant?.content ?? ""),
      route: result.claudeRoute, concepts: result.candidates.length, assessments: result.assessments.length,
      requirements: result.requirements,
      phases: Object.fromEntries(Object.entries(result.phases).map(([phase, seats]) =>
        [phase, seats.map(p => ({ lane: p.providerLane, requested: p.requestedModel ?? p.modelId,
          reported: p.reportedModel, ok: p.ok, usageReported: p.usageReported,
          ledgerConfirmed: p.usagePersisted === true, input: p.tokensIn, output: p.tokensOut }))])) }));
    assert.ok(fullReportRetained, "Full durable report must survive native saved-answer delivery");
    assert.equal(result.status, "COMPLETE", "Persisted INCOMPLETE evidence is not a complete live jury");
    return;
  }
  const { processMessage } = await import("../server/chat-engine");
  const request = "Run an income jury to discover six novel evidence-backed income opportunities for small businesses. Research first, generate two concepts per juror, cross-score every concept, compare the existing catalog, rank three with proposed low-cost validation steps, and retain the complete report. Analysis only: no outreach, billing, deployment or execution.";
  const conv = await storage.createConversation({ tenantId: ADMIN_TENANT_ID,
    personaId: 2, title: "Development income-jury API acceptance", model: "openference/deepseek-v4-pro" });
  console.log("[income-acceptance] conversation", conv.id);
  const answer = await processMessage(conv.id, request, { tenantId: ADMIN_TENANT_ID,
    source: "api-v1", enableTools: true });
  const tool = answer.toolsUsed.find(t => t.name === "jury_triage");
  const decision = tool?.output as import("../server/lib/jury-triage").JuryDecision | undefined;
  assert.ok(decision?.incomeDiscovery, "Full native income result required");
  const result = decision.incomeDiscovery;
  assert.ok(decision.loggedAs, "Durable MoA receipt required");
  const saved = await db.execute(sql`SELECT id, proposer_details_json, aggregated_answer FROM moa_responses
    WHERE id=${decision.loggedAs} AND tenant_id=${ADMIN_TENANT_ID}`);
  assert.equal(saved.rows.length, 1, "Owner-scoped durable report row required");
  assert.equal(saved.rows[0].aggregated_answer, result.report, "Full report bytes must match durable receipt");
  const messages = await storage.getMessages(conv.id, ADMIN_TENANT_ID);
  const assistant = [...messages].reverse().find(m => m.role === "assistant");
  assert.ok(assistant?.content.includes(result.report), "Native saved answer must retain full report bytes");
  console.log("[income-acceptance]", JSON.stringify({
    conversationId: conv.id, receiptId: decision.loggedAs,
    status: result.status, coverage: result.requirementCoverage,
    route: result.claudeRoute, candidates: result.candidates.length,
    assessments: result.assessments.length, shortlist: result.rankings.length,
    savedReportBytes: Buffer.byteLength(result.report), savedAnswerBytes: Buffer.byteLength(assistant.content),
    requirements: result.requirements,
    phases: Object.fromEntries(Object.entries(result.phases).map(([phase, seats]) =>
      [phase, seats.map(p => ({ requested: p.modelId, reported: p.reportedModel,
        lane: p.providerLane, ok: p.ok, usageReported: p.usageReported,
        usagePersisted: p.usagePersisted, tokensIn: p.tokensIn, tokensOut: p.tokensOut,
        failure: p.failureKind }))])),
  }));
  assert.equal(result.status, "COMPLETE", "Persisted INCOMPLETE evidence is not a complete live jury");
}
main().then(() => process.exit(0)).catch(error => {
  console.error("[income-acceptance] NOT CERTIFIED:", error.message);
  process.exit(1);
});
