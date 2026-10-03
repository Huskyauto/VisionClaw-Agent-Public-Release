import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const skill = fs.readFileSync(".agents/skills/pre-build-design-gate/SKILL.md", "utf8");
const wiring = fs.readFileSync("scripts/verify-agent-wiring.ts", "utf8");

test("pre-build gate requires capability-delta evidence after material scaling changes", () => {
  assert.match(skill, /eight questions/i);
  const questionEight = skill.match(/### 8\.[\s\S]*?(?=\n## |\n### 9\.|$)/)?.[0] ?? "";
  assert.match(questionEight, /model scale.*tool access.*memory.*agent count.*concurrency.*autonomy/is);
  assert.match(questionEight, /pre-change baseline.*post-change evaluation/is);
  assert.match(questionEight, /expected capability.*unexpected capabilities/is);
  assert.match(questionEight, /safety-policy/i);
  assert.match(questionEight, /cost/i);
  assert.match(questionEight, /quality/i);
  assert.match(questionEight, /authorization boundaries.*tenant scope.*spending limits.*policy-writing authority/is);
  assert.match(questionEight, /prompt sensitivity.*evaluation thresholds.*data contamination.*measurement noise/is);
  assert.match(questionEight, /report-only.*roll it back/is);
  assert.match(questionEight, /do not claim that scale guarantees emergence/is);
  assert.match(wiring, /8-question pre-build stress test/);
});