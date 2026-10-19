import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { registerBusinessReportConnector } from "../../server/routes/business-report-connector";
import { hashReportBytes } from "../../server/lib/business-report-evidence";
import { initialBusinessReportReview, type BusinessReportReviewInput } from "../../server/lib/business-report-review";

test("HTTP connector accepts complete v1 replies and refuses malformed/unauthorized revisions without scheduling review", async () => {
  const input: BusinessReportReviewInput = {
    compilerMode: "muse-legacy",
    tenantId: 1, kind: "readiness", orderId: "http-fixture", customerEmail: "", modelId: "fixture",
    qualityContractVersion: 1, intake: { company: "Example Company", website: "https://example.com" },
    evidence: { version: 1, capturedAt: new Date().toISOString(), limitations: [], sources: [{
      id: "S1", title: "Services", url: "https://example.com",
      text: "We supply industrial products.", sha256: hashReportBytes("We supply industrial products."),
      kind: "public", retrievedAt: new Date().toISOString(),
    }] }, sections: [{ heading: "Summary", body: "Draft for review." }],
  };
  const state = { ...initialBusinessReportReview(input), phase: "wait_muse" as const,
    correctionChecklist: [{ id: "C1", text: "Remove an unsupported CRM diagnosis." }] };
  const original = { input, state };
  let payload: any = structuredClone(original), writes = 0;
  const dialect = new PgDialect();
  const tx = { execute: async (query: any) => {
    const { sql, params } = dialect.sqlToQuery(query);
    assert.match(sql, /tenant_id/);
    if (sql.startsWith("SELECT")) return { rows: [{ payload, status: "pending" }] };
    writes++;
    payload.state = JSON.parse(params.find((value: any) => typeof value === "string" && value.startsWith('{"phase"')) as string);
    return { rows: [] };
  } };
  const store = { ...tx, transaction: async (fn: any) => fn(tx) };
  const app = express();
  app.use(express.json({ limit: "200kb" }));
  const tenant = (req: express.Request) => req.headers.authorization === "Bearer owner-fixture" ? 1 :
    req.headers.authorization === "Bearer customer-fixture" ? 2 : null;
  registerBusinessReportConnector(app, (req, res, next) => {
    if (!tenant(req)) { res.sendStatus(401); return; }
    (req as any).apiKeyScopes = req.headers["x-fixture-scope"] === "read" ? ["read"] : ["chat"];
    next();
  }, (_req, _res, next) => next(), tenant, store as any);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/spark/reports/12/reply`;
  const action = {
    action: "Pilot a product-selection enquiry form", sourceIds: ["S1"],
    benefit: "Reduce avoidable customer back-and-forth.",
    effort: "Planning estimate: one week, subject to technical review.",
    cost: "Obtain an implementation quote before committing.",
    risk: "Misrouted questions; retain human escalation.",
    dependency: "Confirm who handles incoming enquiries.",
    owner: "Web owner", measurement: "Compare qualified enquiries and response time during the pilot.",
  };
  const report = { sections: [{ heading: "Summary", blocks: [
    { type: "fact", text: "We supply industrial products.", sourceIds: ["S1"] },
    { type: "recommendation", text: "Test clearer product-selection guidance with a small enquiry pilot and measure customer response before making a larger commitment.", sourceIds: ["S1"] },
  ] }], unknowns: ["Internal CRM usage has not been independently established."],
  actionPlan: [1, 2, 3].map(priority => ({ ...action, priority })),
  corrections: [{ id: "C1", disposition: "removed", resolution: "Removed the unsupported CRM assertion from Summary." }] };
  const envelope = { requestId: state.requestId, digest: state.digest, report };
  const post = (body: any, token = "owner-fixture", scope = "chat") => fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Fixture-Scope": scope },
    body: JSON.stringify(body),
  });
  try {
    const contractResponse = await fetch(url.replace("/12/reply", "/schema"), {
      headers: { Authorization: "Bearer owner-fixture" },
    });
    assert.equal(contractResponse.status, 200);
    const contract = await contractResponse.json();
    assert.equal(contract.versions["1"].properties.report.properties.actionPlan.items.properties.owner.minLength, 1);
    assert.ok(contract.versions["1"].properties.report.required.includes("actionPlan"));
    assert.ok(!contract.versions["0"].properties.report.required.includes("actionPlan"));
    const requestGet = () => fetch(url.replace("/reply", ""), {
      headers: { Authorization: "Bearer owner-fixture" },
    });
    const pendingPacket = await (await requestGet()).json();
    assert.equal(pendingPacket.status, "pending");
    assert.deepEqual(pendingPacket.replyContract, contract.versions["1"]);
    assert.match(pendingPacket.instruction, /INSIDE report/);
    assert.doesNotMatch(pendingPacket.instruction, /top-level actionPlan/);
    assert.equal((await post(envelope, "none")).status, 401);
    assert.equal((await post(envelope, "customer-fixture")).status, 403);
    assert.equal((await post(envelope, "owner-fixture", "read")).status, 403);
    assert.equal((await post({ ...envelope, digest: "b".repeat(64) })).status, 409);
    assert.equal((await post({ ...envelope, report: { ...report, actionPlan: undefined } })).status, 422);
    assert.equal((await post({ ...envelope, report: { ...report, actionPlan: [] } })).status, 400);
    const malformed = await post({ ...envelope, report: {
      ...report,
      sections: [{ heading: "Summary", blocks: [{
        type: "private-enum-value", text: "private-report-text-".repeat(200), sourceIds: ["S1"],
      }] }],
      "private-unrecognized-key": "private-unrecognized-value",
    } });
    assert.equal(malformed.status, 400);
    const diagnostics = await malformed.json();
    assert.ok(Array.isArray(diagnostics.issues), "Malformed replies need safe field diagnostics");
    assert.ok(diagnostics.issues.some((issue: any) =>
      issue.path === "report.sections.0.blocks.0.text" && issue.code === "too_big" && issue.maximum === 3000));
    assert.ok(diagnostics.issues.some((issue: any) =>
      issue.path === "report.sections.0.blocks.0.type" && issue.code === "invalid_enum_value"));
    assert.ok(diagnostics.issues.length <= 12);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-|"received":|"options":|"keys":/);
    const manyErrors = await post({ ...envelope, report: {
      ...report, unknowns: Array.from({ length: 25 }, () => ({ "private-key": "private-value" })),
    } });
    assert.equal(manyErrors.status, 400);
    const boundedDiagnostics = await manyErrors.json();
    assert.equal(boundedDiagnostics.issues.length, 25);
    assert.equal(boundedDiagnostics.issueCount, 25);
    assert.equal(boundedDiagnostics.issuesTruncated, false);
    assert.doesNotMatch(JSON.stringify(boundedDiagnostics), /private-/);
    const tooMany = await (await post({ ...envelope, report: {
      ...report, unknowns: Array.from({ length: 90 }, () => null),
    } })).json();
    assert.equal(tooMany.issues.length, 64);
    assert.ok(tooMany.issueCount > 64);
    assert.equal(tooMany.issuesTruncated, true);
    for (const field of ["action", "benefit", "effort", "cost", "risk", "dependency", "owner", "measurement"]) {
      const invalid = await post({ ...envelope, report: { ...report,
        actionPlan: report.actionPlan.map((item, i) => i === 2 ? { ...item, [field]: "" } : item),
      } });
      assert.equal(invalid.status, 400);
      assert.ok((await invalid.json()).issues.some((issue: any) =>
        issue.path === `report.actionPlan.2.${field}` && issue.code === "too_small"));
    }
    const semantic = await post({ ...envelope, report: { ...report,
      actionPlan: report.actionPlan.map((item, i) => i === 0 ? {
        ...item, owner: " ", risk: "The jury found this risk.", measurement: "Read https://example.com for measurements.",
      } : item),
    } });
    assert.equal(semantic.status, 422);
    const semanticIssues = (await semantic.json()).issues;
    assert.ok(semanticIssues.some((issue: any) => issue.path === "report.actionPlan.0.owner"));
    assert.ok(semanticIssues.some((issue: any) => issue.path === "report.actionPlan.0.risk"));
    assert.ok(semanticIssues.some((issue: any) => issue.path === "report.actionPlan.0.measurement"));
    assert.equal((await post({ ...envelope, report: { ...report, corrections: [
      { ...report.corrections[0], id: "forged" },
    ] } })).status, 422);
    assert.equal(writes, 0);
    const response = await post(envelope);
    const accepted = await response.json();
    assert.equal(response.status, 202, JSON.stringify(accepted));
    assert.equal(accepted.receipt.jobId, 12);
    assert.equal(accepted.receipt.requestId, envelope.requestId);
    assert.equal(accepted.receipt.status, "accepted");
    assert.ok(Number.isFinite(Date.parse(accepted.receipt.acceptedAt)));
    assert.deepEqual(payload.state.reply.actionPlan, report.actionPlan);
    assert.equal(writes, 1);
    const duplicate = await post(envelope);
    assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).receipt, accepted.receipt);
    const acceptedGet = await fetch(url.replace("/reply", ""), {
      headers: { Authorization: "Bearer owner-fixture" },
    });
    assert.equal(acceptedGet.status, 200);
    assert.equal((await acceptedGet.json()).status, "accepted");
    assert.equal(writes, 1, "Identical reply does not schedule duplicate work");
    delete payload.input.compilerMode;
    assert.equal((await post(envelope)).status, 200, "Keep historical identical-acceptance evidence after the native transition");
    payload.input.compilerMode = "muse-legacy";
    assert.equal((await post({ ...envelope, report: { ...report, unknowns: ["Changed after acceptance."] } })).status, 409);
    // The worker may issue a second revision before a lost-response retry arrives.
    payload.state.requestId = "92eb25e8-f314-4f41-bfa0-65d0cdd06948";
    payload.state.digest = "c".repeat(64);
    delete payload.state.replyHash;
    delete payload.state.reply;
    const oldRevisionRetry = await post(envelope);
    assert.equal(oldRevisionRetry.status, 200);
    assert.deepEqual((await oldRevisionRetry.json()).receipt, accepted.receipt);
    assert.equal(writes, 1);
    payload = structuredClone(original);
    payload.state.expiresAt = new Date(Date.now() - 1000).toISOString();
    const expiredGet = await requestGet();
    assert.equal(expiredGet.status, 410);
    assert.equal((await expiredGet.json()).status, "expired");
    for (const role of ["IT", "Sales"]) {
      payload = structuredClone(original);
      const shortRoleReply = await post({ ...envelope, report: { ...report,
        actionPlan: report.actionPlan.map(item => ({ ...item, owner: role })),
      } });
      assert.equal(shortRoleReply.status, 202);
    }
    payload = { ...structuredClone(original), input: { ...input, qualityContractVersion: undefined } };
    const { actionPlan: _plan, corrections: _corrections, ...legacy } = report;
    assert.equal((await post({ ...envelope, report: legacy })).status, 202);
    delete payload.state.replyAcceptances;
    const legacyGet = await (await requestGet()).json();
    assert.equal(legacyGet.status, "accepted");
    assert.equal(legacyGet.legacyAcceptance, true);
    assert.equal(legacyGet.receipt, null);
    const legacyRetry = await post({ ...envelope, report: legacy });
    assert.equal(legacyRetry.status, 200);
    assert.equal((await legacyRetry.json()).legacyAcceptance, true);
    payload = structuredClone(original);
    delete payload.input.compilerMode;
    assert.equal((await post(envelope)).status, 409, "Native report cannot accept an external compilation");
    assert.equal((await requestGet()).status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
