import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildResearchRevisitReport } from "../../server/lib/research-revisit";
import { gapCuesEnabled, researchCueAvailability, selectResearchGapCues } from "../../server/lib/research-gap-cues";
import { loadResearchRevisitReportsForNeeds } from "../../scripts/lib/research-revisit-inventory";

test("an open gap cues a strong prior verdict, not generic or closed matches", () => {
  const index = [
    "- [Recoverable tool output evidence](output-verdict.md) — recoverable tool output evidence with compressed context.",
    "- [Tool evidence](generic-verdict.md) — tool evidence.",
    "- [Closed output evidence](closed-verdict.md) — compressed tool output evidence.",
  ].join("\n");
  const bodies: Record<string, string> = {
    "output-verdict.md": "---\nreviewStatus: watch\nrevisitWhen: lost tool output evidence during context compression\n---\nsource",
    "generic-verdict.md": "---\nreviewStatus: untriaged\n---\nsource",
    "closed-verdict.md": "---\nreviewStatus: rejected\n---\nsource",
  };
  const gap = {
    description: "Compressed tool output is losing evidence and context",
    source: "tool_miss", status: "detected", missCount: 4,
  };
  const report = buildResearchRevisitReport(index, (path) => bodies[path], {
    need: gap.description, now: new Date("2026-09-23"), limit: 20,
  });
  const cues = selectResearchGapCues([gap, { ...gap, status: "resolved" }], [report, report]);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0].matches.map((match) => match.path), ["output-verdict.md"]);
  assert.equal(cues[0].missCount, 4);
});

test("several gap lookups share a bounded, path-checked inventory; disabled means no cue", () => {
  const root = mkdtempSync(join(tmpdir(), "research-gap-cues-"));
  const previous = process.env.RESEARCH_GAP_CUES_ENABLED;
  try {
    writeFileSync(join(root, "MEMORY.md"), "- [Output evidence](output-verdict.md) — compressed tool output evidence.");
    writeFileSync(join(root, "output-verdict.md"), "---\nreviewStatus: watch\n---\nsource");
    const reports = loadResearchRevisitReportsForNeeds([
      "compressed tool output evidence", "unrelated billing detail",
    ], { now: new Date("2026-09-23"), limit: 20 }, root);
    assert.equal(reports.length, 2);
    assert.equal(reports[0].candidates[0]?.path, "output-verdict.md");
    assert.equal(reports[1].candidates.length, 0);
    assert.throws(() => loadResearchRevisitReportsForNeeds(
      Array(11).fill("compressed tool output"), { now: new Date("2026-09-23") }, root,
    ), /too many/i);
    process.env.RESEARCH_GAP_CUES_ENABLED = "0";
    assert.equal(gapCuesEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_GAP_CUES_ENABLED;
    else process.env.RESEARCH_GAP_CUES_ENABLED = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed gap source is unavailable, never 'no matches'", () => {
  assert.equal(researchCueAvailability(false, true), "unavailable");
  assert.equal(researchCueAvailability(true, true), "available");
  assert.equal(researchCueAvailability(false, false), "disabled");
});