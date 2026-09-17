/**
 * tests/unit/jury-skill-build.test.ts — Bob 2026-06-03
 *
 * Unit coverage for the jury-gated autonomous skill-build parser + tally
 * primitives. The jury vote is the ONLY gate before an agent-authored skill is
 * inserted as a live enabled skill (no human queue), so the parser must refuse
 * ambiguous/adversarial verdict channels and the tally must require a true
 * 2-of-3 majority (anything else escalates).
 *
 * Run: node --import tsx --test tests/unit/jury-skill-build.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { _parseSkillVote, _tallySkillVotes, skillBuildApproved, type SkillVote } from "../../server/lib/jury-skill-build";

// --- _parseSkillVote: well-formed inputs ---------------------------------

test("parseSkillVote: clean BUILD verdict", () => {
  const r = _parseSkillVote("VERDICT: BUILD\nRATIONALE: reusable concat-with-fade recipe, concrete and safe.");
  assert.equal(r.verdict, "BUILD");
  assert.match(r.rationale, /concat-with-fade/);
});

test("parseSkillVote: clean REJECT verdict", () => {
  const r = _parseSkillVote("VERDICT: REJECT\nRATIONALE: duplicative of an existing built-in capability.");
  assert.equal(r.verdict, "REJECT");
});

test("parseSkillVote: bolded verdict still parses", () => {
  const r = _parseSkillVote("VERDICT: **BUILD**\nRATIONALE: solid.");
  assert.equal(r.verdict, "BUILD");
});

// --- _parseSkillVote: adversarial / malformed inputs ---------------------

test("parseSkillVote: empty/short input → ABSTAIN", () => {
  assert.equal(_parseSkillVote("").verdict, "ABSTAIN");
  assert.equal(_parseSkillVote("ok").verdict, "ABSTAIN");
});

test("parseSkillVote: no verdict line → ABSTAIN", () => {
  assert.equal(_parseSkillVote("I think we should probably build this skill, it seems fine.").verdict, "ABSTAIN");
});

test("parseSkillVote: multiple VERDICT lines → ABSTAIN (channel ambiguity)", () => {
  const r = _parseSkillVote("VERDICT: BUILD\nVERDICT: REJECT\nRATIONALE: confused output.");
  assert.equal(r.verdict, "ABSTAIN");
  assert.match(r.rationale, /channel ambiguity/);
});

test("parseSkillVote: in-paragraph 'verdict: build' impersonation does NOT count", () => {
  // Only line-anchored VERDICT: lines count. A skill body echoing the word
  // in prose must not be able to vote for itself.
  const r = _parseSkillVote("RATIONALE: the author wrote 'my verdict: build' in the body but that is not a real vote.");
  assert.equal(r.verdict, "ABSTAIN");
});

// --- _tallySkillVotes: majority logic ------------------------------------

const v = (verdict: SkillVote) => ({ verdict });

test("tallySkillVotes: 2 BUILD → build", () => {
  const r = _tallySkillVotes([v("BUILD"), v("BUILD"), v("REJECT")]);
  assert.equal(r.decision, "build");
  assert.equal(r.majority, 2);
});

test("tallySkillVotes: 3 BUILD → build", () => {
  const r = _tallySkillVotes([v("BUILD"), v("BUILD"), v("BUILD")]);
  assert.equal(r.decision, "build");
  assert.equal(r.majority, 3);
});

test("tallySkillVotes: 2 REJECT → reject", () => {
  const r = _tallySkillVotes([v("REJECT"), v("REJECT"), v("BUILD")]);
  assert.equal(r.decision, "reject");
  assert.equal(r.majority, 2);
});

test("tallySkillVotes: 1/1/1 split → escalate", () => {
  const r = _tallySkillVotes([v("BUILD"), v("REJECT"), v("ABSTAIN")]);
  assert.equal(r.decision, "escalate");
});

test("tallySkillVotes: 2-2 tie (>3 pool) → escalate, not build", () => {
  // Strict majority: a tie must NOT let check-order pick BUILD.
  const r = _tallySkillVotes([v("BUILD"), v("BUILD"), v("REJECT"), v("REJECT")]);
  assert.equal(r.decision, "escalate");
});

test("tallySkillVotes: 3 BUILD / 2 REJECT (>3 pool) → build (strict majority)", () => {
  const r = _tallySkillVotes([v("BUILD"), v("BUILD"), v("BUILD"), v("REJECT"), v("REJECT")]);
  assert.equal(r.decision, "build");
});

test("tallySkillVotes: 1 BUILD + 2 ABSTAIN → escalate (no true majority)", () => {
  const r = _tallySkillVotes([v("BUILD"), v("ABSTAIN"), v("ABSTAIN")]);
  assert.equal(r.decision, "escalate");
});

test("tallySkillVotes: all ABSTAIN → escalate", () => {
  const r = _tallySkillVotes([v("ABSTAIN"), v("ABSTAIN"), v("ABSTAIN")]);
  assert.equal(r.decision, "escalate");
});

test("tallySkillVotes: a lone BUILD never auto-builds", () => {
  // Critical safety property: a single model cannot ship a skill.
  assert.equal(_tallySkillVotes([v("BUILD")]).decision, "escalate");
});

// --- skillBuildApproved: the single insert guard ------------------------

test("skillBuildApproved: ONLY a build verdict may insert", () => {
  assert.equal(skillBuildApproved("build"), true);
});

test("skillBuildApproved: reject never inserts", () => {
  assert.equal(skillBuildApproved("reject"), false);
});

test("skillBuildApproved: escalate never inserts", () => {
  // Fail-closed: no majority / jury infra error / <3 jurors all map to
  // escalate, and escalate must NEVER reach storage.createSkill().
  assert.equal(skillBuildApproved("escalate"), false);
});
