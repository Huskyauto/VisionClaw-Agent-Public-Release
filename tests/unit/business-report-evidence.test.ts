import test from "node:test";
import assert from "node:assert/strict";
import { validateCompiledReport, businessReportContext, hashReportBytes, type ReportEvidence } from "../../server/lib/business-report-evidence";
import { attachReportInvestigationPackage } from "../../server/lib/jury-package";

const evidence: ReportEvidence = {
  version: 1, capturedAt: "2026-10-14T00:00:00Z",
  sources: [{ id: "S1", title: "Services", url: "https://example.com/services",
    text: "We repair heating systems.", sha256: "fixture", retrievedAt: "2026-10-14T00:00:00Z", kind: "public" }],
  limitations: [],
};
test("published links in a verbatim source quote are not confused with separately retrieved profiles", () => {
  const text = "Published social link: https://social.example.test/company/";
  const retained = { ...evidence, sources: [{ ...evidence.sources[0], text }] };
  const make = (type: string, body: string) => ({ sections: [{ heading: "Summary",
    blocks: [{ type, text: body, sourceIds: ["S1"] },
      { type: "recommendation", text: "Verify the documented information and measure a small pilot before changing the customer workflow. ".repeat(3), sourceIds: [] }] }], unknowns: [] });
  assert.doesNotThrow(() => validateCompiledReport(make("fact", text), ["Summary"], retained));
  assert.throws(() => validateCompiledReport(make("fact", text + " Ownership verified."), ["Summary"], retained), /quotation/);
  assert.throws(() => validateCompiledReport(make("recommendation",
    "Consult https://invented.example.test/company/ for this business."), ["Summary"], retained), /Unretrieved/);
  assert.doesNotThrow(() => validateCompiledReport(make("recommendation",
    "Measure the retained page `https://example.com/services` before changing its workflow."), ["Summary"], retained));
});
test("a Muse compilation must bind factual quotes to the retrieved source, not just cite its ID", () => {
  const draft = { sections: [{ heading: "Summary", blocks: [
    { type: "fact", text: "We doubled profits.", sourceIds: ["S1"] },
  ] }], unknowns: [] };
  assert.throws(() => validateCompiledReport(draft, ["Summary"], evidence), /quotation/i);
});

test("a documented compilation preserves source IDs and labels recommendations without claiming verified profits", () => {
  const result = validateCompiledReport({ sections: [{ heading: "Summary", blocks: [
    { type: "fact", text: "We repair heating systems.", sourceIds: ["S1"] },
    { type: "recommendation", text: "Test a booking follow-up workflow and measure booked jobs before committing to an expansion.", sourceIds: ["S1"] },
  ] }], unknowns: ["Actual conversion rate was not supplied."] }, ["Summary"], evidence);
  assert.match(result.sections[0].body, /Observed source quotation/);
  assert.match(result.sections[0].body, /not a verified outcome/);
  assert.match(result.sections[0].body, /\[S1\]/);
});

test("report business context excludes contact/payment fields and removes contacts embedded inside customer notes", () => {
  const context = businessReportContext({ company: "Example Co", principalName: "Private Person",
    customerEmail: "private@example.com", principalEmail: "other@example.com", phone: "3125550199",
    paymentKey: "payment-private", notes: "Send to private@example.com or 3125550199; monthly gross margin is 25%." });
  assert.equal(context.company, "Example Co");
  assert.match(context.notes, /25%/);
  assert.doesNotMatch(JSON.stringify(context), /Private Person|private@example|3125550199|payment-private/);
});

test("credentials in website userinfo, query parameters and note URLs never enter the report handoff", () => {
  const context = businessReportContext({
    website: "https://alice:privatepass@example.com/?token=private-token#private-fragment",
    notes: "Inspect https://bob:anotherpass@example.com/path?password=hidden for business information.",
  });
  assert.doesNotMatch(JSON.stringify(context), /alice|privatepass|private-token|private-fragment|bob:|anotherpass|hidden/);
  assert.match(context.website, /https:\/\/example.com\//);
});

test("retained-report jury review requires bound snapshot receipts, not unrelated session-history checks", () => {
  const snapshot = JSON.stringify({ sections: ["report"], sources: ["snapshot"] });
  const binding = { jobId: 12, tenantId: 1, inputDigest: "binding", reportSha256: hashReportBytes(snapshot) };
  const votes = ["one", "two", "three"].map((name) => ({
    model: name, reportedModel: name, provider: "fixture", verdict: "REJECT" as const,
    ok: true, rationale: "No material report defect identified.",
    citations: [`${name}:snapshot`], unknowns: ["Sources are shared retained snapshots, not independent live fetches."],
    evidence: { seatId: name, runId: name, actor: "server-owned-juror-evidence-runner" as const,
      receipts: [{ id: `${name}:snapshot`, runId: name, tool: "report_snapshot_read", ok: true,
        startedAt: "now", completedAt: "now", sha256: hashReportBytes(snapshot), excerpt: snapshot,
        reportInspection: binding }] },
  }));
  const decision: any = { votes, verdict: "REJECT", majority: 3, shouldEscalate: false };
  attachReportInvestigationPackage(decision, binding);
  assert.equal(decision.shouldEscalate, false);
  assert.equal(decision.investigation.mode, "retained-report-snapshot-review");
  votes[0].evidence.receipts[0].reportInspection = { ...binding, tenantId: 2 };
  attachReportInvestigationPackage(decision, binding);
  assert.equal(decision.shouldEscalate, true);
});
