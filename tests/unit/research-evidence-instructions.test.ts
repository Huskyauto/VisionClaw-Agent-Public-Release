import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESEARCH_EVIDENCE_INSTRUCTIONS } from "../../server/research-evidence-instructions";
import { SCORING_SYSTEM_PROMPT } from "../../server/research-scoring-prompt";

test("live research/evaluator guidance separates evidence classes and retains honest experiment economics", () => {
  for (const label of ["OBSERVED", "INFERRED", "UNKNOWN", "FALSIFIER"]) {
    assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, new RegExp(label));
    assert.match(SCORING_SYSTEM_PROMPT, new RegExp(label));
  }
  assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, /held-out/);
  assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, /failures/);
  assert.match(RESEARCH_EVIDENCE_INSTRUCTIONS, /not.*approval/);
  assert.match(readFileSync("server/research-engine.ts", "utf8"), /\$\{RESEARCH_EVIDENCE_INSTRUCTIONS\}/);
});
