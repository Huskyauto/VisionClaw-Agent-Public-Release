import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validReportBallot } from "../../server/lib/report-ballot-runner";

function fixture(verdict = "FIX") {
  const excerpt = "Complete immutable report, public evidence, and explicit limitations.";
  const sha = createHash("sha256").update(excerpt).digest("hex");
  const binding = { jobId: 10, tenantId: 1, inputDigest: "exact-revision", reportSha256: sha };
  const runId = "owned-run", id = `${runId}:snapshot`;
  const result: any = { modelId: "requested", reportedModel: "served", provider: "fixture",
    ok: true, latencyMs: 0, finishReason: "stop",
    answer: JSON.stringify({ verdict, rationale: "Correct company-stated credentials.",
      fixProposal: "Attribute credentials to the company, not independent verification.",
      citations: [id], unknowns: ["Retained public evidence only."] }),
    evidence: { runId, seatId: "requested", actor: "server-owned-juror-evidence-runner",
      receipts: [{ id, runId, tool: "report_snapshot_read", ok: true, sha256: sha,
        excerpt, reportInspection: binding }] } };
  return { result, binding };
}

test("a valid FIX or ESCALATE fills a review seat without becoming approval", () => {
  for (const verdict of ["FIX", "REJECT", "ESCALATE"]) {
    const { result, binding } = fixture(verdict);
    assert.equal(validReportBallot(result, binding), true);
  }
});

test("truncation, malformed votes and each wrong authority binding fail closed", () => {
  const { result, binding } = fixture();
  assert.equal(validReportBallot({ ...result, finishReason: "length" }, binding), false);
  assert.equal(validReportBallot({ ...result, answer: "garbled nonempty response" }, binding), false);
  assert.equal(validReportBallot({ ...result, answer:
    "nonsense\nCITATIONS: owned-run:snapshot\nUNKNOWNS: retained only" }, binding), false);
  assert.equal(validReportBallot({ ...result, reportedModel: undefined }, binding), false);
  for (const patch of [{ jobId: 11 }, { tenantId: 2 }, { inputDigest: "other" }, { reportSha256: "0".repeat(64) }]) {
    assert.equal(validReportBallot(result, { ...binding, ...patch }), false);
  }
  const forged = structuredClone(result);
  forged.evidence.receipts[0].excerpt += "unreviewed addition";
  assert.equal(validReportBallot(forged, binding), false);
  forged.evidence.receipts[0].excerpt = result.evidence.receipts[0].excerpt;
  forged.evidence.receipts[0].runId = "someone-else";
  assert.equal(validReportBallot(forged, binding), false);
});
