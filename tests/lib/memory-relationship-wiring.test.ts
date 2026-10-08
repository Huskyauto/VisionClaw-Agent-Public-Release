// Execute the real host module with deterministic dependency seams: no DB,
// provider, memory writes, or module-load side effects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as classifier from "../../server/lib/memory-relationship-classifier";
import * as picker from "../../server/lib/deterministic-picker";

function host() {
  let entries = [{ id: 10, fact: "Works at Acme", status: "active" }];
  let judgments = 0;
  const scopes: Array<{ tenantId?: number; personaId?: number }> = [];
  const requests: any[] = [];
  const env: Record<string, string> = {};
  const mocks: Record<string, unknown> = {
    "./storage": { storage: {
      getMemoryEntries: async (personaId: number, _limit: number, _offset: number, tenantId: number) => {
        scopes.push({ tenantId, personaId });
        return { data: entries.map(entry => ({ ...entry })) };
      },
    } },
    "./lib/silent-catch": { logSilentCatch: () => {} },
    "./providers": { replitOpenai: { chat: { completions: {
      create: async (request: any) => {
        const prompt = request.messages[0].content;
        let content = "{}";
        if (prompt === classifier.MEMORY_RELATION_PROMPT) {
          judgments++;
          requests.push(request);
          content = '{"relation":"duplicate","certainty":"high"}';
        } else if (prompt.startsWith("You extract durable facts")) {
          content = '{"facts":[{"fact":"Works at Globex","category":"identity","stated":"explicit"}]}';
        }
        return { choices: [{ message: { content } }] };
      },
    } } } },
    "./embeddings": { generateEmbedding: async () => null, keywordSimilarity: () => 0.65 },
    "./memory-graph": {},
    "./db": {},
    "drizzle-orm": {},
    "./memory/forgetting-store": {},
    "./memory/temporal-triple-store": {},
    "./memory/safe-triple-error": { safeTripleErrorDetails: () => ({}) },
    "./lib/deterministic-picker": picker,
    "./lib/memory-relationship-classifier": classifier,
  };
  const module = { exports: {} as any };
  const code = transformSync(readFileSync("server/memory-intelligence.ts", "utf8"), {
    loader: "ts", format: "cjs", target: "es2022",
  }).code;
  runInNewContext(code, {
    module, exports: module.exports, process: { env },
    console: { info() {}, log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (!(name in mocks)) throw new Error(`Unmocked import: ${name}`);
      return mocks[name];
    },
  });
  return {
    api: module.exports, scopes, requests, env,
    judgments: () => judgments,
    setEntries: (next: typeof entries) => { entries = next; },
  };
}

test("both real memory callers propagate scope and reuse classification, not extraction/actions", async () => {
  const h = host();
  const result = await h.api.findAndResolveContradictions("Works at Globex", "identity", 3, 2);
  assert.equal(result.action, "skip");
  const extraction = await h.api.intelligentExtractMemory("Noted.", "Works at Globex", 3, 2);
  assert.equal(extraction.skipped, 1);
  assert.equal(extraction.created, 0);
  assert.equal(h.judgments(), 1);
  assert.deepEqual(h.scopes, [{ tenantId: 2, personaId: 3 }, { tenantId: 2, personaId: 3 }]);
  assert.equal(h.requests[0].model, classifier.MEMORY_RELATION_MODEL);
  assert.equal(h.requests[0].max_completion_tokens, 80);
  assert.equal(h.requests[0].response_format.type, "json_object");
});

test("cached classification cannot bypass current memory status/content or scoped reads", async () => {
  const h = host();
  const resolve = (persona = 3, tenant = 2) =>
    h.api.findAndResolveContradictions("Works at Globex", "identity", persona, tenant);
  await resolve();
  await resolve();
  assert.equal(h.judgments(), 1);
  await resolve(4);
  await resolve(3, 5);
  assert.equal(h.judgments(), 3);
  h.setEntries([{ id: 10, fact: "Works at another employer", status: "active" }]);
  await resolve();
  assert.equal(h.judgments(), 4);
  h.setEntries([{ id: 10, fact: "Works at Acme", status: "superseded" }]);
  assert.equal((await resolve()).action, "create");
  h.setEntries([]);
  assert.equal((await resolve()).action, "create");
  assert.equal(h.judgments(), 4);
  assert.equal(h.scopes.length, 7); // every invocation performed a fresh storage read
});

test("the production disable flag bypasses reuse without disabling memory decisions", async () => {
  const h = host();
  await h.api.findAndResolveContradictions("Works at Globex", "identity", 3, 2);
  h.env.MEMORY_RELATION_CACHE_DISABLED = "1";
  for (let i = 0; i < 2; i++) {
    const result = await h.api.findAndResolveContradictions("Works at Globex", "identity", 3, 2);
    assert.equal(result.action, "skip");
  }
  assert.equal(h.judgments(), 3);
});