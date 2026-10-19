import test from "node:test";
import assert from "node:assert/strict";
import { parseReportVote } from "../../server/lib/report-vote-contract";
import { juryTriage } from "../../server/lib/jury-triage";
import { hashReportBytes } from "../../server/lib/business-report-evidence";

test("hash-decorated citations normalize only against the exact successful owned receipt", () => {
  const id = "owned:report-snapshot", sha256 = hashReportBytes("owned snapshot");
  const receipt = { id, sha256, ok: true };
  const answer = (citation: string) => JSON.stringify({ verdict: "REJECT",
    rationale: "No material defect in the shared evidence.", fixProposal: "",
    citations: [citation], unknowns: ["Shared retained sources only."] });
  const decorated = `${id} (sha256 ${sha256})`;
  assert.deepEqual(parseReportVote(answer(decorated), [receipt]).citations, [id]);
  assert.deepEqual(parseReportVote(answer(`${id} (SHA256 ${sha256})`), [receipt]).citations, [id]);
  for (const [citation, receipts] of [
    [decorated, []],
    [decorated, [{ ...receipt, ok: false }]],
    [`${id} (sha256 ${"0".repeat(64)})`, [receipt]],
    [`foreign:report-snapshot (sha256 ${sha256})`, [receipt]],
    [`${decorated} extra`, [receipt]],
  ] as const) assert.deepEqual(parseReportVote(answer(citation), receipts).citations, []);
});

test("one complete Markdown JSON wrapper preserves strict report-vote validation", () => {
  const receipt = "fixture:report-snapshot";
  const vote = { verdict: "FIX", rationale: "Shared snapshot contains unsupported claims.",
    fixProposal: "Label inferred benefits as conditional.", citations: [receipt], unknowns: ["No live refetch."] };
  const json = JSON.stringify(vote);
  const expected = parseReportVote(json);
  for (const newline of ["\n", "\r\n"]) {
    for (const language of ["json", ""]) {
      assert.deepEqual(parseReportVote(`\`\`\`${language}${newline}${json}${newline}\`\`\``), expected);
    }
  }
  for (const invalid of [
    `Here is my answer:\n\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`json\n${json}\n\`\`\`\nCITATIONS: ${receipt}`,
    `\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\``,
    `\`\`\`json\n${json}`,
    `\`\`\`json\n${JSON.stringify({ ...vote, unknowns: [] })}\n\`\`\``,
    `\`\`\`json\n${JSON.stringify({ ...vote, citations: [] })}\n\`\`\``,
  ]) {
    assert.deepEqual(parseReportVote(invalid).citations, []);
  }
});

test("report receipt parsing accepts inline labels, not invented or ambiguous evidence", () => {
  const receipt = "bcd1b3c3-ae83-47db-9fa8-dcf6fab8841f:report-snapshot";
  const answer = `VERDICT: REJECT\nRATIONALE: Shared retained evidence only. CITATIONS: ${receipt} UNKNOWNS: No live refetch.`;
  assert.deepEqual(parseReportVote(answer).citations, [receipt]);
  assert.deepEqual(parseReportVote(answer.replace(receipt, "invented:report-snapshot")).citations,
    ["invented:report-snapshot"]);
  assert.deepEqual(parseReportVote(answer + `\nCITATIONS: ${receipt}`).citations, []);
  assert.deepEqual(parseReportVote(`VERDICT: FIX\nFIX_PROPOSAL: Improve citations:** add source references.\nCITATIONS: ${receipt}`).citations, [receipt]);
  assert.deepEqual(parseReportVote(JSON.stringify({
    verdict: "FIX", rationale: "Missing effort estimate.", fixProposal: "Add an explicitly conditional estimate.",
    citations: [receipt], unknowns: ["Shared retained sources only."],
  })).citations, [receipt]);
});

test("three JSON jurors must explicitly disclose limits; no default sentence may satisfy coverage", async () => {
  const excerpt = "A fixed retained public-source report snapshot.";
  const binding = { jobId: 12, tenantId: 1, inputDigest: hashReportBytes("input"),
    reportSha256: hashReportBytes(excerpt) };
  const run = (disclose: boolean, fenced = false, forgeReceipt = false, decorateReceipt = false) => juryTriage({
    tenantId: 1, invokedVia: "business-report-evidence-review", retainedReportBinding: binding,
    issueText: "Evaluate this retained public-source advisory report.",
    collectProposerEvidence: async () => { throw new Error("No live collection in this fixture"); },
    runPaidReportJury: async (options) => {
      assert.equal(options.evidenceFormat, "report-json");
      assert.doesNotMatch(options.question, /Respond in this EXACT format|concrete files \/ lines \/ changes/);
      assert.match(options.question, /Return only JSON/);
      return ({
      proposers: [1, 2, 3].map(index => {
        const runId = `fixture-${index}`, id = `${runId}:report-snapshot`;
        const answer = JSON.stringify({ verdict: "REJECT", rationale: "No material report defect in retained evidence.",
           fixProposal: "", citations: [forgeReceipt && index === 3 ? "other-seat:report-snapshot" :
             decorateReceipt && index === 3 ? `${id} (sha256 ${binding.reportSha256})` : id],
          ...(disclose ? { unknowns: ["Shared retained sources; no private data or live investigation."] } : {}) });
        return { modelId: runId, reportedModel: runId, role: "proposer", ok: true,
          answer: fenced && index === 3 ? `\`\`\`json\n${answer}\n\`\`\`` : answer,
          evidence: { seatId: runId, runId, actor: "server-owned-juror-evidence-runner",
            receipts: [{ id, runId, tool: "report_snapshot_read", ok: true,
              startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
              excerpt, sha256: binding.reportSha256, reportInspection: binding }] },
        };
      }), aggregated: "", concordance: null, jurySeatCount: 3, totalLatencyMs: 0,
    } as any);
    },
  });
  assert.equal((await run(false)).shouldEscalate, true);
  const complete = await run(true);
  assert.equal(complete.verdict, "REJECT");
  assert.equal(complete.shouldEscalate, false);
  const wrapped = await run(true, true);
  assert.equal(wrapped.verdict, "REJECT");
  assert.equal(wrapped.shouldEscalate, false);
  assert.equal((await run(true, true, true)).shouldEscalate, true);
  assert.equal((await run(false, true)).shouldEscalate, true);
  const hashDecorated = await run(true, false, false, true);
  assert.equal(hashDecorated.verdict, "REJECT");
  assert.equal(hashDecorated.shouldEscalate, false);
  assert.equal(hashDecorated.investigation?.requirementCoverage, 1);
});
