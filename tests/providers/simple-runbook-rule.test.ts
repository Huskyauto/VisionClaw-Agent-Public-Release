import test from "node:test";
import assert from "node:assert/strict";
import { createSimpleRuleCompiler } from "../../server/legion/simple-runbook-rule";
import { LocalAdmissionDeferred } from "../../server/legion/local-slots";

test("Surface gets a direct question and returns one exact server-read instruction", async () => {
  const text = "# Test first\nWrite a test and watch it fail before changing implementation.\nOther text";
  let called = 0;
  const compile = createSimpleRuleCompiler({
    read: async () => ({ text, sha256: "a".repeat(64) }),
    local: async work => {
      called++;
      assert.equal(work.task, "extract-runbook-rule");
      assert.match(work.messages[0].content, /lineStart/);
      assert.ok(work.messages.reduce((n, m) => n + m.content.length, 0) <= 2400);
      assert.doesNotMatch(work.messages[1].content, /Other text/);
      work.validateContent!('{"lineStart":2}');
      return { content: '{"lineStart":2}', model: "surface-local:qwen2.5-7b-instruct-qnn-npu:3", latencyMs: 1 };
    },
    hosted: async () => { throw Error("must not spend"); },
    hostedEnabled: () => false,
    assertActive: () => {},
  });
  const result = await compile(".agents/skills/tdd/SKILL.md", "a".repeat(64));
  assert.equal(called, 1);
  assert.deepEqual(result.concepts[0].quotes, [text.split("\n")[1]]);
  assert.equal(result.hostedFallback, false);
});

test("extra references, metadata, unrelated text and malformed answers are not repaired into success", async () => {
  for (const content of ['{"lineStart":2,"lineStarts":[2]}', '{"lineStart":[2]}', '{"lineStart":1}',
    '{"lineStart":3}', '{"lineStart":999}', "not json"]) {
    const compile = createSimpleRuleCompiler({
      read: async () => ({ text: "---\nWatch the test fail before implementation.\nUnrelated source text.", sha256: "a".repeat(64) }),
      local: async () => ({ content, model: "surface-local:qwen2.5-7b-instruct-qnn-npu:3", latencyMs: 1 }),
      hosted: async () => { throw Error("must not spend"); }, hostedEnabled: () => false, assertActive: () => {},
    });
    await assert.rejects(compile(".agents/skills/tdd/SKILL.md"));
  }
});

test("Surface capacity contention does not trigger hosted spend even after a failed local attempt", async () => {
  let hosted = 0;
  const compile = createSimpleRuleCompiler({
    read: async () => ({ text: "Watch the test fail before implementation.", sha256: "a".repeat(64) }),
    local: async () => { throw new LocalAdmissionDeferred("backup busy", true); },
    hosted: async () => { hosted++; return { content: '{"lineStart":1}', model: "hosted-model" }; },
    hostedEnabled: () => true, assertActive: () => {},
  });
  await assert.rejects(compile(".agents/skills/tdd/SKILL.md"), LocalAdmissionDeferred);
  assert.equal(hosted, 0);
});

test("simple-task hosted recovery still requires the same exact single-source answer", async () => {
  const text = "Watch the test fail before implementation.";
  const compile = createSimpleRuleCompiler({
    read: async () => ({ text, sha256: "a".repeat(64) }),
    local: async () => { throw Error("local provider failed"); },
    hosted: async () => ({ content: '{"lineStart":1}', model: "configured-fast-model" }),
    hostedEnabled: () => true, assertActive: () => {},
  });
  const result = await compile(".agents/skills/tdd/SKILL.md");
  assert.equal(result.hostedFallback, true);
  assert.equal(result.model, "hosted:configured-fast-model");
  assert.deepEqual(result.concepts[0].quotes, [text]);
});
