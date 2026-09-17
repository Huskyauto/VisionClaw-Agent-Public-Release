import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routesSource = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
const engineSource = readFileSync(new URL("../../server/chat-engine.ts", import.meta.url), "utf8");

test("both Felix loops use the exact opt-in semantic outcome controller", () => {
  for (const source of [routesSource, engineSource]) {
    assert.match(source, /process\.env\.FELIX_OUTCOME_CONTROLLER_ENABLED === "1" && persona\?\.id === 2/);
    assert.match(source, /await assessFelixOutcome\(\{/);
    assert.match(source, /outcomeJudgeUsed = true/);
    assert.match(source, /outcomeContinuationUsed = true/);
    assert.match(source, /useTools = (?:!outcomeSynthesisOnly && )?decision\.toolsMode === "preserve"/);
  }
});

test("both loops mark mutation attempts immediately before guarded dispatch", () => {
  for (const source of [routesSource, engineSource]) {
    const dispatch = source.indexOf("executeGuardedTool(");
    const callback = source.indexOf("onDispatch:", dispatch);
    const mark = source.indexOf("if (toolRisk.isMutating) mutatingToolDispatched = true", callback);
    assert.ok(dispatch >= 0, "missing guarded dispatch");
    assert.ok(callback > dispatch, "missing guarded executor dispatch callback");
    assert.ok(mark > callback, "mutation marker must live inside the post-gate dispatch callback");
    assert.ok(mark - callback < 180, "mutation marker must be adjacent to the dispatch callback");
  }
});

test("legacy phrase detection and post-loop rebuild are not active Felix decision paths", () => {
  assert.doesNotMatch(routesSource, /detectIncompleteOutcome\(/);
  assert.doesNotMatch(engineSource, /detectIncompleteOutcome\(/);
  assert.doesNotMatch(routesSource, /\[completion-gate\] SSE/);
});

test("SSE content buffering is controlled by the exact outcome flag, not Felix identity alone", () => {
  assert.match(routesSource, /else if \(!outcomeEnabled\) \{\s*res\.write\(`data:/);
  assert.doesNotMatch(routesSource, /else if \(!isFelix\) \{\s*res\.write\(`data:/);
});

test("synthesis-only recovery is monotonic and cannot extend the tool-bearing round cap", () => {
  assert.match(engineSource, /outcomeSynthesisOnly = outcomeSynthesisOnly \|\| decision\.toolsMode === "synthesis_only"/);
  assert.match(engineSource, /useTools && !outcomeSynthesisOnly && round < MAX_TOOL_ROUNDS/);
  assert.doesNotMatch(engineSource, /useTools && round < maxToolRound/);
  assert.equal(
    (engineSource.match(/!outcomeSynthesisOnly && escProvider/g) ?? []).length,
    2,
    "both overflow recovery branches must preserve synthesis-only mode",
  );
});

test("slow-tool SSE recovery returns through the semantic checkpoint", () => {
  assert.match(routesSource, /Recovery succeeded[\s\S]{0,220}break escalation_retry/);
  assert.doesNotMatch(routesSource, /Recovery succeeded[\s\S]{0,220}break round_loop/);
  assert.match(routesSource, /for await \(const rChunk of recoveryStream\) \{\s*if \(\(rChunk as any\)\?\.model\) workerModels\.add/);
});

test("accepted SSE content becomes the canonical persisted response", () => {
  assert.equal(
    (routesSource.match(/fullResponse = visibleCandidate;/g) ?? []).length,
    2,
    "both initial acceptance and bounded-continuation acceptance must canonicalize persistence",
  );
});

test("thinking-only SSE candidates are normalized into the bounded empty-response path", () => {
  assert.match(
    routesSource,
    /const visibleTerminalCandidate = outcomeEnabled \? stripThinkTags\(roundContent\)\.trim\(\) : roundContent\.trim\(\)/,
  );
  assert.match(
    routesSource,
    /if \(outcomeEnabled && !visibleTerminalCandidate\) \{[\s\S]{0,320}fullResponse = fullResponse\.slice\(0, roundResponseStart\);[\s\S]{0,120}roundContent = "";/,
  );
  assert.match(routesSource, /outcomeEnabled && !outcomeJudgeUsed && roundContent/);
  assert.match(routesSource, /candidateResponse: visibleTerminalCandidate/);
});