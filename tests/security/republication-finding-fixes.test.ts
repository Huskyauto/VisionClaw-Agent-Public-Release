import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";

function declaration(file: string, name: string) {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
      && node.name?.getText(ast) === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, `${name} must exist`);
  return found.getText(ast);
}
function load(source: string, globals: Record<string, unknown>) {
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, {
    loader: "ts", format: "cjs", target: "node22",
  }).code, { module, exports: module.exports, console, ...globals });
  return module.exports;
}

test("classifier preferred and fallback clients use the originating tenant", async () => {
  for (const available of [true, false]) {
    const calls: unknown[][] = [];
    const { pickClassifierClient } = load(
      `${declaration("server/reasoning-front-door.ts", "pickClassifierClient")}\nexport { pickClassifierClient };`,
      {
        CLASSIFIER_MODELS: ["fixture-cheap"], MODEL_REGISTRY: [],
        getAvailableModels: async () => available ? [{ id: "fixture-cheap" }] : [],
        getUnhealthyProviders: () => new Set(),
        getClientForModel: async (...args: unknown[]) => {
          calls.push(args); return { client: {}, actualModelId: args[0] };
        },
        logSilentCatch: () => {},
      },
    );
    await pickClassifierClient(2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 2, "tenant must reach each provider-selection branch");
  }
});

test("fact eviction cannot expire a foreign tenant's row even if victim IDs are polluted", async () => {
  const rows = [{ id: 7, tenantId: 2 }, { id: 8, tenantId: 3 }];
  const conversationFacts = {
    id: "id", tenantId: "tenantId", conversationId: "conversationId",
    status: "status", lastReferencedAt: "lastReferencedAt",
  };
  const { Subject } = load(
    `export class Subject {
      async countConversationFacts() { return 52; }
      ${declaration("server/storage.ts", "evictOldestConversationFacts")}
    }`, {
      conversationFacts,
      eq: (key: string, value: unknown) => (row: any) => row[key] === value,
      and: (...conditions: any[]) => (row: any) => conditions.every(c => c(row)),
      inArray: (key: string, values: unknown[]) => (row: any) => values.includes(row[key]),
      db: {
        select: () => ({ from: () => ({ where: () => ({
          orderBy: () => ({ limit: async () => [{ id: 7 }, { id: 8 }] }),
        }) }) }),
        update: () => ({ set: () => ({ where: async (predicate: any) => {
          for (const row of rows) if (predicate(row)) (row as any).expired = true;
        } }) }),
      },
    },
  );
  await new Subject().evictOldestConversationFacts(11, 2, 50);
  assert.equal((rows[0] as any).expired, true);
  assert.equal((rows[1] as any).expired, undefined, "write boundary must independently reject foreign IDs");
});

test("both Felix terminal updates bind run identity and originating tenant", () => {
  const file = "server/felix-loop.ts";
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const queries: ts.TaggedTemplateExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTaggedTemplateExpression(node)
      && /UPDATE felix_loop_runs/.test(node.template.getText(ast))) queries.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(queries.length, 2, "success and error settlement must both be covered");
  for (const query of queries) {
    const result = load(`export const query = ${query.getText(ast)};`, {
      sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
        text: parts.join("?"), values,
      }),
      runId: 7, tenantId: 2, ctx: { summary: "fixture" },
      intentSummary: "fixture", drafted: 0, usage: {}, costCents: 0,
      e: { message: "fixture failure" },
    }).query;
    assert.match(result.text, /WHERE\s+id\s*=\s*\?\s+AND\s+tenant_id\s*=\s*\?/i);
    assert.deepEqual(Array.from(result.values).slice(-2), [7, 2]);
  }
});

test("classifier rejects absent or malformed tenant before provider discovery", async () => {
  let discoveries = 0;
  const { pickClassifierClient } = load(
    `${declaration("server/reasoning-front-door.ts", "pickClassifierClient")}\nexport { pickClassifierClient };`,
    { getAvailableModels: async () => { discoveries++; throw new Error("must not discover"); } },
  );
  for (const tenant of [undefined, null, 0, -1, 1.5, NaN, Infinity, "2"]) {
    assert.equal(await pickClassifierClient(tenant), null);
  }
  assert.equal(discoveries, 0);
});

test("shared voice-wake handlers deny nonowners before file reads or writes", () => {
  let reads = 0, writes = 0;
  const handlers = load([
    declaration("server/voice-wake.ts", "handleVoiceWakeGet"),
    declaration("server/voice-wake.ts", "handleVoiceWakeSet"),
  ].join("\n"), {
    requirePlatformAdmin: (req: any, res: any) => {
      if (req.owner === true) return true;
      res.status(403).json({ error: "Forbidden" }); return false;
    },
    loadWakeData: () => { reads++; return { triggers: ["fixture"] }; },
    saveWakeData: () => { writes++; },
    normalizeTriggers: (triggers: string[]) => triggers,
    DEFAULT_TRIGGERS: ["fixture"],
  });
  for (const name of ["handleVoiceWakeGet", "handleVoiceWakeSet"]) {
    for (const req of [{}, { tenantId: 1 }, { tenantId: 2, body: { triggers: ["foreign"] } }]) {
      const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json() {} };
      handlers[name](req, res);
      assert.equal(res.statusCode, 403);
    }
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
  const res = { json() {}, status() { return this; } };
  handlers.handleVoiceWakeGet({ owner: true }, res);
  handlers.handleVoiceWakeSet({ owner: true, body: { triggers: ["fixture"] } }, res);
  assert.equal(reads, 1); assert.equal(writes, 1);
});

test("auto-project messages and research program joins have direct tenant boundaries", () => {
  const project = declaration("server/auto-project.ts", "checkAndAutoCreateProject");
  assert.match(project, /WHERE conversation_id = \$\{conversationId\}\s+AND tenant_id = \$\{tenantId\}/);
  const research = readFileSync("server/research-proposals.ts", "utf8");
  const joins = [...research.matchAll(/JOIN research_programs rp ON ([^\n]+)/g)].map(m => m[1]);
  assert.equal(joins.length, 3);
  for (const join of joins) assert.match(join, /rp\.tenant_id = (re|rs)\.tenant_id/);
});

test("worker failures, embeddings, seed links and phone pairings have direct scope guards", () => {
  const failure = declaration("server/job-queue.ts", "failJob");
  assert.equal((failure.match(/AND tenant_id IS NOT DISTINCT FROM \$\{tenantId\}/g) || []).length, 3);
  const embedding = declaration("server/surprise-scorer.ts", "stampArgsEmbedding");
  assert.match(embedding, /AND tenant_id = \$\{tenantId\}/);
  const seed = readFileSync("server/seed.ts", "utf8");
  assert.match(seed, /UPDATE projects SET primary_conversation_id = 272 WHERE id = 15 AND tenant_id = 1/);
  const phone = readFileSync("server/twilio.ts", "utf8");
  assert.match(phone, /row\.tenant_id !== info\.tenantId/);
  assert.match(phone, /WHERE id = \$\{info.conversationId\} AND tenant_id = \$\{info.tenantId\}/);
});

test("ordinary chat retains public wake defaults without exposing cached owner words", () => {
  const chat = readFileSync("client/src/pages/chat.tsx", "utf8");
  assert.match(chat, /const DEFAULT_PUBLIC_WAKE_TRIGGERS = \["visionclaw", "hey claw", "computer"\]/);
  assert.match(chat, /wakeTriggers=\{canManageVoiceWake \? voiceWakeData\?\.triggers : DEFAULT_PUBLIC_WAKE_TRIGGERS\}/);
  assert.match(chat, /queryKey: \["\/api\/voice\/wake"\],\s+enabled: canManageVoiceWake/);
});
