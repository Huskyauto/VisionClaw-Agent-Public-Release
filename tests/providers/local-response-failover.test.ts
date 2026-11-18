import test from "node:test";
import assert from "node:assert/strict";
import { createLocalBackgroundRouter } from "../../server/legion/local-router";
import { createLegionWorker } from "../../server/legion/background";
import { createRunbookCompiler } from "../../server/legion/runbook";
import { runLocalRunbookJob } from "../../server/legion/nightly-policy";
import { createHostedRunbookGenerator, assertRunbookActive } from "../../server/legion/runbook-hosted";
import { LegionAdmissionDeferred } from "../../server/legion/background";
import { withTenantContext } from "../../server/lib/tenant-context";

test("a rejected Lenovo answer automatically tries Surface once through the same validator", async () => {
  const calls: string[] = [];
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true,
    legionHealth: async () => {},
    surfaceHealth: async () => { calls.push("surface-health"); },
    legionGenerate: async () => { calls.push("lenovo"); return { answer: "bad" }; },
    surfaceGenerate: async () => { calls.push("surface"); return { answer: "good" }; },
  });
  const result = await route({ messages: [] }, async candidate => {
    calls.push(`check:${candidate.provider}`);
    if (candidate.response.answer !== "good") throw Error("Response checks failed");
  });
  assert.equal(result.provider, "surface-local");
  assert.equal(result.localFallback, true);
  assert.deepEqual(calls, ["lenovo", "check:legion-local", "surface-health", "surface", "check:surface-local"]);
});

const source = { text: "Inspect the real caller before changing code.", sha256: "a".repeat(64) };
const validContent = '{"concepts":[{"key":"caller-check","title":"Check caller","lineStarts":[1]}]}';
const completion = (content: string, surface = false) => ({
  model: surface ? "qwen2.5-7b-instruct-qnn-npu:3" : "qwen3:8b",
  system_fingerprint: "fp_ollama", usage: { prompt_tokens: 20, completion_tokens: 20 },
  choices: [{ finish_reason: "stop", message: { content } }],
});

test("every rejected Lenovo response type reaches Surface, while a valid primary skips all backups", async () => {
  for (const kind of ["valid", "empty", "malformed", "truncated", "wrong-model",
    "too-many-references", "out-of-range", "empty-concepts", "offline", "timeout"]) {
    const calls: string[] = [];
    const route = createLocalBackgroundRouter({
      surfaceEnabled: () => true, legionHealth: async () => {}, surfaceHealth: async () => {},
      legionGenerate: async () => {
        calls.push("lenovo");
        if (kind === "offline" || kind === "timeout") throw Error(kind);
        const r = completion(validContent);
        if (kind === "empty") r.choices[0].message.content = "";
        if (kind === "malformed") r.choices[0].message.content = "not JSON";
        if (kind === "truncated") r.choices[0].finish_reason = "length";
        if (kind === "wrong-model") r.model = "unverified-model";
        if (kind === "too-many-references") r.choices[0].message.content = validContent.replace("[1]", "[1,1,1,1]");
        if (kind === "out-of-range") r.choices[0].message.content = validContent.replace("[1]", "[400]");
        if (kind === "empty-concepts") r.choices[0].message.content = '{"concepts":[]}';
        return r;
      },
      surfaceGenerate: async () => { calls.push("surface"); return completion(validContent, true); },
    });
    const local = createLegionWorker({
      enabled: () => true, trustedTenant: () => 1, acquire: async () => async () => {},
      dispatch: route, request: async () => { throw Error("Legacy path"); }, record: async () => true,
    });
    const compile = createRunbookCompiler({ assertActive: () => {}, read: async () => source,
      local, hostedEnabled: () => true,
      hosted: async () => { calls.push("hosted"); throw Error("Hosted must not run"); },
    });
    const result = await compile(".agents/skills/zoom-out/SKILL.md");
    assert.equal(result.model, kind === "valid" ? "legion-local:qwen3:8b" : "surface-local:qwen2.5-7b-instruct-qnn-npu:3", kind);
    assert.deepEqual(calls, kind === "valid" ? ["lenovo"] : ["lenovo", "surface"], kind);
  }
});

test("the full Lenovo → Surface → hosted ladder accepts only the hosted source-validated candidate", async () => {
  const calls: string[] = [];
  let locked = false;
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true, legionHealth: async () => {}, surfaceHealth: async () => {},
    legionGenerate: async () => { calls.push("lenovo"); return completion(""); },
    surfaceGenerate: async () => { calls.push("surface"); return completion("bad JSON", true); },
  });
  const local = createLegionWorker({ enabled: () => true, trustedTenant: () => 1,
    acquire: async () => { locked = true; return async () => { locked = false; }; },
    dispatch: route, request: async () => { throw Error(); }, record: async () => true,
  });
  const compile = createRunbookCompiler({ assertActive: () => {}, read: async () => source,
    local, hostedEnabled: () => true, hosted: async () => {
      assert.equal(locked, false, "hosted recovery must release local capacity first");
      calls.push("hosted"); return { model: "normal-fast-route", content: validContent };
    },
  });
  const result = await compile(".agents/skills/zoom-out/SKILL.md");
  assert.deepEqual(calls, ["lenovo", "surface", "hosted"]);
  assert.equal(result.hostedFallback, true);
  assert.deepEqual(result.concepts[0].quotes, [source.text]);
});

test("both local and hosted invalid answers fail explicitly without a retry loop", async () => {
  let hostedCalls = 0;
  const compile = createRunbookCompiler({ assertActive: () => {}, read: async () => source,
    local: async () => { throw Error("Both local providers failed"); },
    hostedEnabled: () => true, hosted: async () => {
      hostedCalls++; return { model: "normal-fast-route", content: validContent.replace("[1]", "[1,1,1,1]") };
    },
  });
  await assert.rejects(compile(".agents/skills/zoom-out/SKILL.md"));
  assert.equal(hostedCalls, 1);
});

test("disabled hosted route, admission contention, cancellation and revoked work cannot trigger hosted spend", async () => {
  for (const kind of ["disabled", "busy", "cancelled", "revoked"]) {
    let revoked = false, hostedCalls = 0;
    const compile = createRunbookCompiler({ read: async () => source,
      assertActive: () => { if (revoked) throw Error("Revoked"); },
      local: async () => {
        if (kind === "busy") throw new LegionAdmissionDeferred("Busy");
        if (kind === "cancelled") throw new DOMException("Cancelled", "AbortError");
        revoked = kind === "revoked";
        throw Error("Local failure");
      },
      hostedEnabled: () => kind !== "disabled", hosted: async () => {
        hostedCalls++; return { model: "normal-fast-route", content: validContent };
      },
    });
    await assert.rejects(compile(".agents/skills/zoom-out/SKILL.md"), kind);
    assert.equal(hostedCalls, 0, kind);
  }
});

test("a cancellation or kill switch stops the local ladder before contacting Surface", async () => {
  for (const kind of ["aborted", "revoked"]) {
    let stopped = false, surfaceCalls = 0;
    const route = createLocalBackgroundRouter({
      assertActive: () => { if (stopped) throw new DOMException("Stopped", "AbortError"); },
      surfaceEnabled: () => kind !== "revoked" || !stopped,
      legionHealth: async () => {}, surfaceHealth: async () => { surfaceCalls++; },
      legionGenerate: async () => { stopped = true; throw Error("Interrupted"); },
      surfaceGenerate: async () => { surfaceCalls++; return {}; },
    });
    await assert.rejects(route({ messages: [] }));
    assert.equal(surfaceCalls, 0);
  }
});

test("hosted budget denial never submits a model call; allowed work uses one submission with a cancellation signal", async () => {
  for (const allowed of [false, true]) {
    const calls: string[] = [];
    const generate = createHostedRunbookGenerator({
      assertActive: () => {},
      resolve: async () => ({ model: "configured-fast-model", generate: async (_messages, signal) => {
        calls.push("generate");
        assert.equal(signal.aborted, false);
        return { ...completion(validContent), model: "configured-fast-model" };
      } }),
      claim: async model => { assert.equal(model, "configured-fast-model"); calls.push("reserve"); return allowed; },
    });
    if (allowed) assert.equal((await generate([{ role: "user", content: "Fictional source" }])).model, "configured-fast-model");
    else await assert.rejects(generate([{ role: "user", content: "Fictional source" }]), /budget/);
    assert.deepEqual(calls, allowed ? ["reserve", "generate"] : ["reserve"]);
  }
});

test("hosted recovery rejects empty, truncated, tool-bearing and excessive-token responses without retry", async () => {
  for (const kind of ["empty", "truncated", "tools", "usage"]) {
    let submissions = 0;
    const generate = createHostedRunbookGenerator({
      assertActive: () => {}, claim: async () => true,
      resolve: async () => ({ model: "configured-fast-model", generate: async () => {
        submissions++;
        const r: any = completion(validContent);
        if (kind === "empty") r.choices[0].message.content = "";
        if (kind === "truncated") r.choices[0].finish_reason = "length";
        if (kind === "tools") r.choices[0].message.tool_calls = [{ id: "forbidden" }];
        if (kind === "usage") r.usage.completion_tokens = 2049;
        return r;
      } }),
    });
    await assert.rejects(generate([{ role: "user", content: "Fictional source" }]), /checks/, kind);
    assert.equal(submissions, 1);
  }
});

test("cancelled or revoked hosted recovery never generates even if model resolution or budget reservation already completed", async () => {
  for (const kind of ["cancelled", "revoked"]) {
    const controller = new AbortController();
    let revoked = false, submissions = 0;
    const generate = createHostedRunbookGenerator({
      assertActive: () => { if (revoked) throw Error("Revoked"); },
      resolve: async () => {
        if (kind === "cancelled") controller.abort();
        return { model: "configured-fast-model", generate: async () => {
          submissions++; return completion(validContent);
        } };
      },
      claim: async () => { revoked = true; return true; },
    });
    await assert.rejects(generate([{ role: "user", content: "Fictional source" }], controller.signal));
    assert.equal(submissions, 0);
  }
});

test("changed or non-allowlisted sources never reach either local or hosted inference", async () => {
  let calls = 0;
  const compile = createRunbookCompiler({ assertActive: () => {}, read: async () => source,
    local: async () => { calls++; throw Error(); }, hostedEnabled: () => true,
    hosted: async () => { calls++; return { model: "normal-fast-route", content: validContent }; },
  });
  await assert.rejects(compile(".agents/skills/zoom-out/SKILL.md", "0".repeat(64)));
  await assert.rejects(compile("data/customers.json"));
  assert.equal(calls, 0);
});

test("cross-tenant scope is rejected before hosted billing context can be established", () => {
  withTenantContext({ tenantId: 2, source: "explicit" }, () => {
    assert.throws(assertRunbookActive, /scope refused/);
  });
});

test("nightly jobs reach authorized hosted recovery when the private daemon and both laptops are unavailable", async () => {
  const text = "Inspect the real caller before changing code.";
  const digest = "b".repeat(64);
  const result = await runLocalRunbookJob({
    id: 42, kind: "legion_runbook_compile", tenantId: 1, attempts: 1,
    payload: { tenantId: 1, environment: "development",
      sourcePath: ".agents/skills/zoom-out/SKILL.md", sourceSha256: digest, window: "2026-11-17" },
  }, {
    enabled: () => true, ready: () => false, hostedEnabled: () => true,
    environment: () => "development", read: async () => ({ text, sha256: digest }),
    health: async () => { throw Error("Both laptops offline"); },
    compile: async () => ({ sourceSha256: digest, model: "hosted:configured-model",
      hostedFallback: true, concepts: [{ key: "caller-check", title: "Check caller", quotes: [text] }] }),
  });
  assert.equal(result.status, "compiled");
  assert.equal(result.hostedFallback, true);
  assert.equal(result.inferenceCostUsd, null, "never mislabel hosted work as free");
});

test("invalid answers from both laptops recover through hosted with identical source validation", async () => {
  const calls: string[] = [];
  const source = { text: "Inspect the real caller before changing code.", sha256: "a".repeat(64) };
  const compiler = createRunbookCompiler({
    assertActive: () => {}, hostedEnabled: () => true,
    read: async () => source,
    local: async work => {
      calls.push("local");
      work.validateContent?.('{"concepts":[{"key":"caller-check","title":"Check caller","lineStarts":[1,1,1,1]}]}');
      throw Error("Should have failed source-schema validation");
    },
    hosted: async () => {
      calls.push("hosted");
      return { model: "configured-fast-model",
        content: '{"concepts":[{"key":"caller-check","title":"Check caller","lineStarts":[1]}]}' };
    },
  });
  const result = await compiler(".agents/skills/zoom-out/SKILL.md");
  assert.deepEqual(calls, ["local", "hosted"]);
  assert.equal(result.hostedFallback, true);
  assert.equal(result.model, "hosted:configured-fast-model");
  assert.deepEqual(result.concepts[0].quotes, [source.text]);
  assert.equal(result.inferenceCostUsd, null);
});

test("task validation happens inside failover; both returned completions are accounted under one lock", async () => {
  const receipts: Record<string, any>[] = [];
  let releases = 0;
  const reply = (model: string, content: string) => ({ model,
    system_fingerprint: "fp_ollama", usage: { prompt_tokens: 10, completion_tokens: 10 },
    choices: [{ finish_reason: "stop", message: { content } }] });
  const route = createLocalBackgroundRouter({
    surfaceEnabled: () => true, legionHealth: async () => {}, surfaceHealth: async () => {},
    legionGenerate: async () => reply("qwen3:8b", "not JSON"),
    surfaceGenerate: async () => {
      assert.equal(releases, 0);
      return reply("qwen2.5-7b-instruct-qnn-npu:3", '{"concepts":[]}');
    },
  });
  const worker = createLegionWorker({
    enabled: () => true, trustedTenant: () => 1,
    acquire: async () => async () => { releases++; },
    request: async () => { throw Error("Legacy request must not run"); },
    dispatch: route, record: async receipt => { receipts.push(receipt); return true; },
  });
  const result = await worker({ tenantId: 1, task: "compile-runbook",
    messages: [{ role: "user", content: "Synthetic engineering source" }],
    validateContent: content => { JSON.parse(content); },
  });
  assert.equal(result.model, "surface-local:qwen2.5-7b-instruct-qnn-npu:3");
  assert.deepEqual(receipts.map(r => r.toolName), ["llm.legion-local", "llm.surface-local"]);
  assert.equal(releases, 1);
});
