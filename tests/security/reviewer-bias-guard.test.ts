// R113 — Reviewer Independence invariant (ARIS REVIEWER_BIAS_GUARD nugget).
//
// ARIS (arXiv:2605.03042) empirically showed that re-using the executor's
// thread for the reviewer poisons critique with the executor's framing —
// fresh-thread per review round lifted their codex-reply score from 3/10
// to 8/10. VisionClaw's MoA proposers, critique-agent, and architect
// re-reviews ALREADY run as fresh OpenAI calls (no shared conversation
// history). This test pins that invariant so a future "optimization" that
// pipes prior context into a proposer or critique will fail CI loudly
// instead of silently regressing review quality.
//
// R115.6 — migrated from vitest (not installed) to node:test built-in so
// the suite runs in CI without an extra dependency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

test("Reviewer Bias Guard: MoA callProposer builds a fresh messages array (no prior history)", () => {
  const src = read("server/moa.ts");
  const proposerBlock = src.match(/async function callProposer[\s\S]*?\n\}/);
  assert.ok(proposerBlock, "callProposer not found");
  const body = proposerBlock![0];
  assert.ok(body.includes('role: "system"'));
  assert.ok(body.includes('role: "user"'));
  assert.ok(body.includes("content: question"));
  assert.doesNotMatch(body, /\.\.\.\s*(history|prior|priorMessages|conversation)/);
  assert.doesNotMatch(body, /messages:\s*\[\s*\.\.\./);
});

test("Reviewer Bias Guard: MoA callAggregator builds a fresh messages array with ONLY the synthesized prompt", () => {
  const src = read("server/moa.ts");
  const aggBlock = src.match(/async function callAggregator[\s\S]*?\n\}/);
  assert.ok(aggBlock, "callAggregator not found");
  const body = aggBlock![0];
  assert.ok(body.includes('messages: [{ role: "user", content: prompt }]'));
  assert.doesNotMatch(body, /\.\.\.\s*(history|prior|conversation)/);
});

test("Reviewer Bias Guard: critiqueResponse uses an isolated chat completion (no shared thread state)", () => {
  const src = read("server/critique-agent.ts");
  assert.ok(src.includes("replitOpenai.chat.completions.create"));
  const critBlock = src.match(/critiqueResp\s*=\s*await[\s\S]*?\}\)/);
  assert.ok(critBlock, "critique completion call not found");
  const body = critBlock![0];
  assert.ok(body.includes("CRITIQUE_SYSTEM_PROMPT"));
  assert.doesNotMatch(body, /\.\.\.\s*(history|prior|conversation|priorMessages)/);
});

test("Reviewer Bias Guard: moa.ts carries the explicit R113 fresh-thread banner", () => {
  const src = read("server/moa.ts");
  assert.ok(src.includes("R113 — REVIEWER INDEPENDENCE INVARIANT"));
});

test("Reviewer Bias Guard: critique-agent.ts carries the explicit R113 fresh-thread banner", () => {
  const src = read("server/critique-agent.ts");
  assert.ok(src.includes("R113 — REVIEWER INDEPENDENCE INVARIANT"));
});
