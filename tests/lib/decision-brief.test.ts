import test from "node:test";
import assert from "node:assert/strict";
import { decisionBriefInstructions, appendBriefEvidence } from "../../server/lib/decision-brief";

test("decision briefing exposes unknowns and authority without inventing research", () => {
  assert.match(decisionBriefInstructions, /Why now/);
  assert.match(decisionBriefInstructions, /Approval/);
  assert.match(decisionBriefInstructions, /not authorization/);
  assert.match(decisionBriefInstructions, /no browsing/);
  const text = appendBriefEvidence("## Decisions\nNo decision established.", [
    { id: 7, status: "pending", created_at: "2026-10-17T01:00:00Z" },
    { id: 8, status: "failed", created_at: "bad date" },
  ], "2026-10-17T02:00:00.000Z");
  assert.match(text, /TASK-7: pending/);
  assert.match(text, /unknown time/);
  assert.match(text, /not proof of correctness/);
});
