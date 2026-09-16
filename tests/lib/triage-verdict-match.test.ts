import { test } from "node:test";
import assert from "node:assert/strict";
import { matchVerdictToFinding } from "../../scripts/lib/triage-verdict-match";

type F = { file: string; line?: number | null; issue: string };

test("exact (file,line) match resolves to that finding", () => {
  const batch: F[] = [
    { file: "server/a.ts", line: 10, issue: "x" },
    { file: "server/a.ts", line: 20, issue: "y" },
  ];
  const f = matchVerdictToFinding(batch, { file: "server/a.ts", line: 20 });
  assert.equal(f, batch[1]);
});

test("numeric line that matches nothing NEVER falls back to a null-line finding (the bug)", () => {
  const batch: F[] = [
    { file: "server/a.ts", line: 99, issue: "genuine severe, no null line here" },
    { file: "server/a.ts", issue: "line-less finding" }, // line: undefined
  ];
  // Model returned a wrong numeric line (42) for server/a.ts.
  const f = matchVerdictToFinding(batch, { file: "server/a.ts", line: 42 });
  assert.equal(f, null, "wrong numeric line must not suppress the line-less finding");
});

test("missing line + exactly one null-line candidate resolves", () => {
  const batch: F[] = [
    { file: "server/a.ts", issue: "only line-less finding" },
    { file: "server/b.ts", line: 5, issue: "other file" },
  ];
  const f = matchVerdictToFinding(batch, { file: "server/a.ts" });
  assert.equal(f, batch[0]);
});

test("missing line + multiple null-line candidates in same file => null (ambiguous)", () => {
  const batch: F[] = [
    { file: "server/a.ts", issue: "one" },
    { file: "server/a.ts", issue: "two" },
  ];
  const f = matchVerdictToFinding(batch, { file: "server/a.ts" });
  assert.equal(f, null);
});

test("NaN / non-finite line is treated as missing (file-only, exactly-one rule)", () => {
  const batch: F[] = [
    { file: "server/a.ts", line: 7, issue: "has a line" },
    { file: "server/a.ts", issue: "line-less" },
  ];
  // NaN line => file-only match; there is exactly one null-line finding => resolves it.
  const f = matchVerdictToFinding(batch, { file: "server/a.ts", line: NaN });
  assert.equal(f, batch[1]);
  // Infinity likewise treated as non-finite.
  const g = matchVerdictToFinding(
    [{ file: "server/c.ts", issue: "single" }] as F[],
    { file: "server/c.ts", line: Infinity },
  );
  assert.equal(g?.issue, "single");
});

test("duplicate (file,line) findings => null (ambiguous, fail closed)", () => {
  const batch: F[] = [
    { file: "server/a.ts", line: 12, issue: "issue-A" },
    { file: "server/a.ts", line: 12, issue: "issue-B" },
  ];
  const f = matchVerdictToFinding(batch, { file: "server/a.ts", line: 12 });
  assert.equal(f, null);
});

test("no match at all => null", () => {
  const batch: F[] = [{ file: "server/a.ts", line: 1, issue: "x" }];
  assert.equal(matchVerdictToFinding(batch, { file: "server/z.ts", line: 1 }), null);
  assert.equal(matchVerdictToFinding(batch, { file: "server/z.ts" }), null);
});

test("null (not undefined) line on a finding is treated as line-less", () => {
  const batch: F[] = [{ file: "server/a.ts", line: null, issue: "x" }];
  const f = matchVerdictToFinding(batch, { file: "server/a.ts" });
  assert.equal(f, batch[0]);
  // A numeric verdict line must not match a null-line finding.
  assert.equal(matchVerdictToFinding(batch, { file: "server/a.ts", line: 3 }), null);
});
