import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findUnsupportedToolSteps,
  buildRefineFeedback,
  findStructuralIssues,
  shouldAcceptRefinement,
  PLANNER_BLOCKED_TOOLS,
} from "../../server/lib/skill-aware-decomposition";

const AVAILABLE = new Set(["web_search", "web_fetch", "llm_task", "generate_chart"]);

test("clean plan: every tool is registered & unblocked → no issues", () => {
  const steps = [
    { id: 0, action: "search", tool: "web_search" },
    { id: 1, action: "summarize", tool: "llm_task" },
    { id: 2, action: "reason", tool: "none" },
    { id: 3, action: "text step" }, // no tool
  ];
  assert.deepEqual(findUnsupportedToolSteps(steps, AVAILABLE), []);
});

test("blocked tool is flagged with reason 'blocked'", () => {
  const steps = [{ id: 0, action: "run shell", tool: "exec" }];
  const issues = findUnsupportedToolSteps(steps, AVAILABLE);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, "blocked");
  assert.equal(issues[0].tool, "exec");
});

test("every entry in PLANNER_BLOCKED_TOOLS is detected as blocked", () => {
  for (const t of PLANNER_BLOCKED_TOOLS) {
    const issues = findUnsupportedToolSteps([{ id: 0, action: "x", tool: t }], AVAILABLE);
    assert.equal(issues.length, 1, `expected ${t} to be flagged`);
    assert.equal(issues[0].reason, "blocked");
  }
});

test("unregistered (hallucinated) tool is flagged with reason 'unknown'", () => {
  const steps = [{ id: 0, action: "do magic", tool: "teleport_user" }];
  const issues = findUnsupportedToolSteps(steps, AVAILABLE);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, "unknown");
});

test("fail-open: empty registry does NOT flag every step as unknown", () => {
  const steps = [
    { id: 0, action: "search", tool: "web_search" },
    { id: 1, action: "magic", tool: "teleport_user" },
  ];
  // size 0 = registry not populated yet; must not force a needless re-decompose.
  assert.deepEqual(findUnsupportedToolSteps(steps, new Set<string>()), []);
});

test("blocked is still caught even when the registry is empty", () => {
  const issues = findUnsupportedToolSteps([{ id: 0, action: "x", tool: "exec" }], new Set<string>());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].reason, "blocked");
});

test("mixed plan: only the bad steps are returned, ids preserved", () => {
  const steps = [
    { id: 0, action: "ok", tool: "web_search" },
    { id: 1, action: "bad-block", tool: "lobster" },
    { id: 2, action: "ok2", tool: "none" },
    { id: 3, action: "bad-unknown", tool: "nope_tool" },
  ];
  const issues = findUnsupportedToolSteps(steps, AVAILABLE);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map(i => i.id).sort(), [1, 3]);
});

test("buildRefineFeedback renders a line per issue with the right wording", () => {
  const fb = buildRefineFeedback([
    { id: 1, action: "bad-block", tool: "lobster", reason: "blocked" },
    { id: 3, action: "bad-unknown", tool: "nope_tool", reason: "unknown" },
  ]);
  const lines = fb.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /BLOCKED inside the task planner/);
  assert.match(lines[1], /NOT a registered\/available tool/);
});

// ---- structural validity ----

test("findStructuralIssues: a sound linear DAG has no issues", () => {
  const steps = [
    { id: 0, dependsOn: [] },
    { id: 1, dependsOn: [0] },
    { id: 2, dependsOn: [0, 1] },
  ];
  assert.deepEqual(findStructuralIssues(steps), []);
});

test("findStructuralIssues: dangling dependency id is flagged", () => {
  const issues = findStructuralIssues([{ id: 0, dependsOn: [5] }]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /unknown step 5/);
});

test("findStructuralIssues: self-dependency is flagged", () => {
  const issues = findStructuralIssues([{ id: 0, dependsOn: [0] }]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /depends on itself/);
});

test("findStructuralIssues: a cycle is detected", () => {
  const steps = [
    { id: 0, dependsOn: [1] },
    { id: 1, dependsOn: [0] },
  ];
  const issues = findStructuralIssues(steps);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /cycle/);
});

// ---- acceptance gate: refine can NEVER make the plan worse ----

const ACCEPT_AVAILABLE = new Set(["web_search", "llm_task"]);

test("shouldAcceptRefinement: accepts when mismatches drop AND structure is sound", () => {
  const refined = [
    { id: 0, action: "a", tool: "web_search", dependsOn: [] },
    { id: 1, action: "b", tool: "llm_task", dependsOn: [0] },
  ];
  const d = shouldAcceptRefinement(2, refined, ACCEPT_AVAILABLE);
  assert.equal(d.accept, true);
  assert.equal(d.remaining, 0);
});

test("shouldAcceptRefinement: REJECTS reduced-mismatch plan with broken deps (deadlock guard)", () => {
  const refined = [
    { id: 0, action: "a", tool: "web_search", dependsOn: [99] }, // dangling
    { id: 1, action: "b", tool: "llm_task", dependsOn: [0] },
  ];
  const d = shouldAcceptRefinement(2, refined, ACCEPT_AVAILABLE);
  assert.equal(d.accept, false, "must not accept a structurally-broken plan even if tool mismatches dropped");
  assert.ok(d.structural.length > 0);
});

test("shouldAcceptRefinement: REJECTS when mismatches did not strictly decrease", () => {
  const refined = [{ id: 0, action: "a", tool: "still_bad", dependsOn: [] }];
  const d = shouldAcceptRefinement(1, refined, ACCEPT_AVAILABLE);
  assert.equal(d.accept, false);
  assert.equal(d.remaining, 1);
});

test("shouldAcceptRefinement: REJECTS an empty refined plan", () => {
  const d = shouldAcceptRefinement(3, [], ACCEPT_AVAILABLE);
  assert.equal(d.accept, false);
});
