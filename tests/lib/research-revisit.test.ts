import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResearchRevisitReport, appendUnindexedResearchTopics } from "../../server/lib/research-revisit";

const index = [
  "- [Harness efficiency](sol-pi-harness-efficiency.md) — held-out coding harness token savings.",
  "- [Auth gap](auth-gap.md) — a security lesson about session cookies.",
  "- [Discarded study](discarded-verdict.md) — old output study.",
].join("\n");
const topics: Record<string, string> = {
  "sol-pi-harness-efficiency.md": "---\nreviewStatus: watch\nrevisitWhen: repeated large tool output traffic or lost evidence during context compression\n---\nPaper text",
  "auth-gap.md": "---\nname: Auth gap\n---\nSecurity lesson",
  "discarded-verdict.md": "---\nreviewStatus: rejected\n---\nRejected finding",
};

test("a specific need resurfaces relevant prior work without treating a match as approval", () => {
  const report = buildResearchRevisitReport(index, (path) => topics[path], {
    need: "Large tool outputs are losing evidence in context compression",
    now: new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(report.mode, "need");
  assert.equal(report.candidates[0]?.path, "sol-pi-harness-efficiency.md");
  assert.deepEqual(report.candidates[0]?.matchedTerms.sort(), ["compression", "context", "evidence", "large", "output", "tool"].sort());
  assert.ok(!report.candidates.some((c) => c.path === "discarded-verdict.md"));
  assert.ok(!report.candidates.some((c) => c.path === "auth-gap.md"));
  assert.equal(report.candidates[0]?.status, "watch");
});

test("unsafe index paths and missing topics do not yield a clean review", () => {
  assert.throws(
    () => buildResearchRevisitReport("- [Unsafe](../secret.md) — report.", () => "", { now: new Date("2026-09-23") }),
    /unsafe|invalid/i,
  );
  assert.throws(
    () => buildResearchRevisitReport(index + "\n  - [Hidden](hidden-verdict.md) — source.", (path) => topics[path], { now: new Date("2026-09-23") }),
    /invalid.*index/i,
  );
  assert.throws(
    () => buildResearchRevisitReport(index, (path) => path === "auth-gap.md" ? undefined : topics[path], { now: new Date("2026-09-23") }),
    /missing.*topic/i,
  );
});

test("older verdict files absent from the memory index still enter the periodic inventory", () => {
  const augmented = appendUnindexedResearchTopics(
    "- [Indexed paper](indexed-verdict.md) — existing description.",
    ["indexed-verdict.md", "older-verdict.md", "personal-note.md"],
    (name) => name === "older-verdict.md"
      ? "---\nname: Older paper\n description: Study on tool output evidence.\n---\nText"
      : "---\nname: Indexed paper\ndescription: Existing description.\n---",
  );
  assert.match(augmented, /\[Older paper\]\(older-verdict\.md\)/);
  assert.equal(augmented.match(/indexed-verdict\.md/g)?.length, 1);
  assert.doesNotMatch(augmented, /personal-note/);
});

test("weekly slices rotate through studies; due reviews come back until a human updates the verdict", () => {
  const body: Record<string, string> = {
    "one-verdict.md": "---\nreviewAfter: 2026-09-01\n---\nsource",
    "two-verdict.md": "---\n---\nsource",
    "three-verdict.md": "---\nreviewStatus: adopted\n---\nsource",
  };
  const catalogue = [
    "- [One study](one-verdict.md) — matching test.",
    "- [Two study](two-verdict.md) — another test.",
    "- [Three study](three-verdict.md) — already shipped.",
  ].join("\n");
  const observed = new Set<string>();
  for (let week = 0; week < 12; week++) {
    const now = new Date(Date.UTC(2026, 8, 23 + week * 7));
    const report = buildResearchRevisitReport(catalogue, (path) => body[path], { now });
    for (const item of report.candidates) observed.add(item.path);
    assert.equal(report.candidates[0]?.path, "one-verdict.md");
    assert.equal(report.candidates[0]?.reason, "review-due");
    assert.ok(!report.candidates.some((item) => item.path === "three-verdict.md"));
  }
  assert.ok(observed.has("two-verdict.md"));
});

test("a crowded weekly slice does not permanently starve topics after the first page", () => {
  const paths = Array.from({ length: 35 }, (_, n) => `study-${n}-verdict.md`);
  const catalogue = paths.map((path) => `- [Study ${path}](${path}) — independent report.`).join("\n");
  const seen = new Set<string>();
  const start = new Date("2026-09-23T12:00:00Z").getTime();
  for (let week = 0; week < 4; week++) {
    const report = buildResearchRevisitReport(
      catalogue, () => "---\nname: report\n---\nsource",
      { now: new Date(start + week * 7 * 86400_000), limit: 10 },
    );
    for (const item of report.candidates) seen.add(item.path);
  }
  assert.deepEqual([...seen].sort(), paths.sort());
});

test("an oversized overdue group cannot starve other prior studies", () => {
  const paths = Array.from({ length: 25 }, (_, n) => `study-${n}-verdict.md`);
  const catalogue = paths.map((path) => `- [Study ${path}](${path}) — independent report.`).join("\n");
  const seen = new Set<string>();
  const start = new Date("2026-09-23T12:00:00Z").getTime();
  for (let week = 0; week < 5; week++) {
    const report = buildResearchRevisitReport(catalogue, (path) =>
      path === "study-24-verdict.md" ? "---\nname: watch\n---\nsource"
        : "---\nreviewAfter: 2026-09-01\n---\nsource",
    { now: new Date(start + week * 7 * 86400_000), limit: 8 });
    for (const item of report.candidates) seen.add(item.path);
  }
  assert.deepEqual([...seen].sort(), paths.sort());
});