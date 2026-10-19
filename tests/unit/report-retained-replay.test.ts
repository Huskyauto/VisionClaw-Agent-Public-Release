import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { juryTriage } from "../../server/lib/jury-triage";

process.env.NODE_ENV = "test";
const fixture = process.env.REPORT_RETAINED_EVALUATION;
test("retained live report answers recover formatting-only invalid votes without new inference", { skip: !fixture }, async () => {
  const rows = JSON.parse(fs.readFileSync(fixture!, "utf8"));
  let groups = 0;
  for (const row of rows.filter((value: any) => value.kind)) {
    for (const [phase, audit] of Object.entries(row.audits) as [string, any][]) {
      const binding = audit.proposers.flatMap((p: any) => p.evidence?.receipts || [])
        .find((receipt: any) => receipt.reportInspection)?.reportInspection;
      assert.ok(binding, "Actual server-owned receipt binding is required");
      let calls = 0;
      const result = await juryTriage({
        issueText: "Offline replay of the exact retained report review answers.",
        tenantId: 1, invokedVia: "business-report-evidence-review", retainedReportBinding: binding,
        collectProposerEvidence: async () => { throw new Error("Replay must not gather new evidence"); },
        runPaidReportJury: async () => { calls++; return structuredClone(audit); },
      });
      assert.equal(calls, 1);
      const expected = phase.startsWith("final") && row.kind === "executive" ? 2 : 3;
      assert.equal(result.votes.filter(vote => vote.ok).length, expected, `${row.kind} ${phase}`);
      // The export retains receipt metadata, not each seat's full excerpt.
      // Format recovery must never certify those incomplete exports as approved.
      assert.equal(result.shouldEscalate, true);
      if (phase.startsWith("final") && row.kind === "executive") assert.equal(result.verdict, "ESCALATE");
      groups++;
    }
  }
  assert.equal(groups, 4, "Replay both initial and final reviews for both reports");
});
