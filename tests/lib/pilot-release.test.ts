import test from "node:test";
import assert from "node:assert/strict";
import { releaseSchema, analyzeRelease, RELEASE_AREAS } from "../../shared/business-pilots/release";
const input = () => ({ product: "Example app", version: "candidate-1", checks: RELEASE_AREAS.map(area => ({
  area: area.id, status: "pass", evidence: "CI run 123 and reviewed report", checkedAt: "2026-10-19",
})) });
test("release requires all areas and evidence before human review", () => {
  assert.equal(analyzeRelease(releaseSchema.parse(input()), "2026-10-19").verdict, "Ready for human review — not release approval");
  const noEvidence = input(); noEvidence.checks[0].evidence = "";
  assert.match(analyzeRelease(releaseSchema.parse(noEvidence), "2026-10-19").verdict, /Incomplete/);
  assert.equal(releaseSchema.safeParse({ ...input(), checks: [] }).success, false);
  const duplicate = input(); duplicate.checks[0].area = duplicate.checks[1].area;
  assert.equal(releaseSchema.safeParse(duplicate).success, false);
});
test("failed, stale or future release evidence cannot grant readiness", () => {
  const failed = input(); failed.checks[0].status = "fail";
  assert.match(analyzeRelease(releaseSchema.parse(failed), "2026-10-19").verdict, /Blocked/);
  for (const date of ["2026-09-01", "2026-10-20"]) {
    const stale = input(); stale.checks[0].checkedAt = date;
    assert.match(analyzeRelease(releaseSchema.parse(stale), "2026-10-19").verdict, /Incomplete/);
  }
});
