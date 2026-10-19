import test from "node:test";
import assert from "node:assert/strict";
import { governanceSchema, analyzeGovernance, GOVERNANCE_CONTROLS } from "../../shared/business-pilots/governance";
const input = () => ({ organization: "Example", scope: "Customer support assistant",
  controls: GOVERNANCE_CONTROLS.map(control => ({ control: control.id, status: "implemented",
    owner: "Operations owner", evidence: "Policy record 123", reviewedAt: "2026-10-19" })) });
test("governance produces a complete inventory but never a certification", () => {
  const result = analyzeGovernance(governanceSchema.parse(input()), "2026-10-19");
  assert.ok(result.findings.every(f => f.status === "reported"));
  assert.match(result.verdict, /not certification/i);
  assert.equal(governanceSchema.safeParse({ ...input(), controls: [] }).success, false);
});
test("governance marks missing owner, stale evidence and deferred controls as gaps", () => {
  const data = input();
  data.controls[0].owner = "";
  data.controls[1].reviewedAt = "2026-01-01";
  data.controls[2].status = "planned";
  const result = analyzeGovernance(governanceSchema.parse(data), "2026-10-19");
  assert.equal(result.findings.filter(f => f.status === "reported").length, GOVERNANCE_CONTROLS.length - 3);
  assert.ok(result.findings.slice(0, 3).every(f => f.status === "gap"));
});
