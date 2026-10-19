import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { attachReportInvestigationPackage } from "../../server/lib/jury-package";

test("failed attempts remain audit evidence but do not invalidate three fully proven replacement votes", () => {
  const excerpt = "Fixed retained report and source snapshot.";
  const sha = createHash("sha256").update(excerpt).digest("hex");
  const binding = { jobId: 123, tenantId: 1, inputDigest: "digest", reportSha256: sha };
  const valid = [1, 2, 3].map(n => {
    const runId = `owned-run-${n}`, id = `${runId}:report-snapshot`;
    return { model: `model-${n}`, reportedModel: `served-model-${n}`, ok: true,
      verdict: "FIX", rationale: "Correct the unsupported claim.", citations: [id],
      unknowns: ["Shared retained evidence only; no independent live investigation."],
      evidence: { seatId: `model-${n}`, runId, actor: "server-owned-juror-evidence-runner",
        receipts: [{ id, runId, tool: "report_snapshot_read", ok: true,
          excerpt, sha256: sha, reportInspection: binding }] } };
  });
  const failed = { model: "original-down", ok: false, verdict: "ESCALATE", rationale: "503" };
  function certify(votes: any[]) {
    const decision = { votes, verdict: "FIX", shouldEscalate: false } as any;
    attachReportInvestigationPackage(decision, binding);
    return decision;
  }
  const complete = certify([failed, ...valid]);
  assert.equal(complete.investigation.requirementCoverage, 1);
  assert.equal(complete.shouldEscalate, false);
  assert.equal(complete.votes.length, 4, "never erase failed attempts");
  assert.equal(certify([failed, ...valid.slice(0, 2)]).shouldEscalate, true);
  assert.equal(certify(valid.map(v => ({ ...v, reportedModel: "same-model" }))).shouldEscalate, true);
  const forged = valid.map((v, i) => i !== 2 ? v :
    { ...v, evidence: { ...v.evidence, receipts: [{ ...v.evidence.receipts[0], sha256: "forged" }] } });
  assert.equal(certify(forged).shouldEscalate, true);
});
