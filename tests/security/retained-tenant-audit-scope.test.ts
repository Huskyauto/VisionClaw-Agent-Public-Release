import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";

// Execute the actual production declarations with bounded, query-recording
// collaborators. No app startup, credentials, live databases or model calls.
function declaration(file: string, name: string): string {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name?.getText(ast) === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${file}: ${name} must exist`);
  return found.getText(ast);
}

function load(source: string, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const code = transformSync(source, { loader: "ts", format: "cjs", target: "node22" }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, console, ...globals,
  });
  return module.exports;
}

const invalidScopes = [undefined, null, 0, -1, NaN, Infinity, 1.5, "2", Number.MAX_SAFE_INTEGER + 1];
const eq = (column: string, value: unknown) => ({ column, value });
const and = (...conditions: unknown[]) => conditions;

function messageFixture(owner = 2) {
  const calls: any[] = [];
  const conversations = { id: "conversation.id", tenantId: "conversation.tenantId" };
  const messages = { id: "message.id" };
  const db = {
    select: () => ({
      from: () => ({
        where: (predicate: any) => ({
          limit: async () => {
            calls.push({ op: "read", predicate });
            const conditions = Array.isArray(predicate) ? predicate : [predicate];
            const boundTenant = conditions.find((p: any) => p.column === conversations.tenantId);
            return boundTenant && boundTenant.value !== owner ? [] : [{ tenantId: owner }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        returning: async () => { calls.push({ op: "insert", values }); return [{ id: 7, ...values as any }]; },
      }),
    }),
  };
  const { Subject } = load(
    `export class Subject { ${declaration("server/storage.ts", "createMessage")} }`,
    { db, conversations, messages, eq, and },
  );
  return { subject: new Subject(), calls };
}

for (const tenantId of invalidScopes) {
  test(`message writes reject ${String(tenantId)} before any conversation lookup`, async () => {
    const { subject, calls } = messageFixture();
    await assert.rejects(subject.createMessage({
      conversationId: 17, role: "user", content: "private", tenantId,
    }), /tenantId is required/);
    assert.equal(calls.length, 0);
  });
}

test("foreign conversation cannot receive a message and lookup binds both identities", async () => {
  const { subject, calls } = messageFixture(3);
  await assert.rejects(subject.createMessage({
    conversationId: 17, role: "user", content: "private", tenantId: 2,
  }), /Conversation not found/);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].predicate)), [
    { column: "conversation.id", value: 17 },
    { column: "conversation.tenantId", value: 2 },
  ]);
});

test("owned conversation retains its explicitly supplied scope on insert", async () => {
  const { subject, calls } = messageFixture();
  await subject.createMessage({ conversationId: 17, role: "user", content: "private", tenantId: 2 });
  assert.equal(calls[1].values.tenantId, 2);
});

function queryFixture(file: string, name: string, globals: Record<string, unknown> = {}, rows: any[] = []) {
  const queries: { text: string; values: unknown[] }[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?").replace(/\s+/g, " "), values,
  });
  const db = { execute: async (query: any) => { queries.push(query); return { rows }; } };
  const fn = load(declaration(file, name).replace(/^(?:export )?/, "export "), {
    db, sql, ...globals,
  })[name];
  return { fn, queries };
}

test("evaluation completion update binds the originating customer", async () => {
  const queries: any[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?").replace(/\s+/g, " "), values,
  });
  const source = declaration("server/agent-eval.ts", "runEval")
    .replace('await import("./chat-engine")', "({ processMessage: mockProcessMessage })");
  const { runEval } = load(source, {
    db: { execute: async (q: any) => { queries.push(q); return { rows: [{ id: 7 }] }; } },
    sql,
    storage: {
      getPersona: async () => ({ id: 4, name: "Evaluator" }),
      createConversation: async () => ({ id: 17, tenantId: 2 }),
      deleteConversation: async () => {},
    },
    mockProcessMessage: async () => ({ response: "answer" }),
    judgeResult: async () => ({ passed: true, score: 8, reason: "ok" }),
    logSilentCatch: () => {},
  });
  await runEval(4, 2, [{ taskName: "test", prompt: "test" }], 1);
  const update = queries.find(q => q.text.includes("UPDATE agent_evals"));
  assert.match(update.text, /WHERE id = \? AND tenant_id = \?/);
  assert.equal(update.values.at(-1), 2);
});

test("competitor summary independently scopes all three child aggregates", async () => {
  const { fn, queries } = queryFixture("server/agentic-features.ts", "listCompetitors");
  await fn({ tenantId: 2 });
  assert.equal((queries[0].text.match(/competitor_id = c.id AND tenant_id = \?/g) || []).length, 3);
  assert.deepEqual(queries[0].values, [2, 2, 2, 2]);
});

test("inbox digest refuses inconsistent classification-to-message ownership", async () => {
  const { fn, queries } = queryFixture("server/lib/inbox-ingest.ts", "buildInboxDigest", {
    rowsOf: (r: any) => r.rows, ADMIN_TENANT_ID: 1,
  });
  await fn({ tenantId: 2, sinceHours: 24 });
  assert.match(queries[0].text, /m\.tenant_id = \?/);
  assert.deepEqual(queries[0].values, [2, 2, 24]);
});

test("PDF helpers refuse missing scope before accessing files or render services", async () => {
  const calls: string[] = [];
  const helper = declaration("server/pdf-create.ts", "requirePdfTenant");
  const source = [
    helper,
    ...["fillPdf", "editPdf", "generateStyledPdf"].map(name => declaration("server/pdf-create.ts", name)),
  ].join("\n");
  const fns = load(source, {
    PDF_ADMIN_TENANT_ID: 1,
    process: { env: { BROWSERLESS_API_KEY: "test-fixture" } },
    ensureOutputDir: () => { calls.push("filesystem"); throw new Error("unexpected filesystem access"); },
    buildStyledHtml: () => { calls.push("render"); throw new Error("unexpected render access"); },
  });
  for (const name of ["fillPdf", "editPdf", "generateStyledPdf"]) {
    for (const tenantId of invalidScopes) {
      const result = await fns[name]({ tenantId, inputPath: "private.pdf", fields: {}, title: "private" });
      assert.equal(result.success, false);
      assert.match(result.error, /tenantId is required/);
    }
  }
  assert.deepEqual(calls, []);
});

test("outbound email quality incidents follow the sending customer, never owner fallback", async () => {
  const incidents: any[] = [];
  const source = declaration("server/lib/outbound-email-preflight.ts", "preflightOutboundEmail")
    .replace('await import("./owner-email")', "ownerModule")
    .replace('await import("./outbound-quality-gate")', "qualityModule")
    .replace('await import("./outbound-redaction")', "redactionModule");
  const { preflightOutboundEmail } = load(source, {
    assertEmailRecipientsDeliverable: () => {},
    collectRecipients: (v: unknown) => v ? [String(v)] : [],
    currentTenantId: () => null,
    ownerModule: { resolveOwnerEmails: () => ["owner@example.test"] },
    qualityModule: {
      scanCustomerFacingText: () => ({ degraded: true, blocked: false, reasons: [] }),
      reportQualityIncident: (incident: unknown) => { incidents.push(incident); },
    },
    redactionModule: { enforceOutbound: (text: string) => ({ ok: true, text }) },
  });
  await preflightOutboundEmail({ to: "customer@example.test", subject: "test", text: "safe", tenantId: 2 });
  assert.equal(incidents[0].tenantId, 2);
  await preflightOutboundEmail({ to: "customer@example.test", subject: "test", text: "safe" });
  assert.equal(incidents.length, 1, "missing scope must not create an owner incident");
});

test("OAuth state cannot be consumed by another customer or a missing session", () => {
  const pendingOAuthFlows = new Map([
    ["state-fixture", { provider: "youtube", tenantId: 2, verifier: "fixture", createdAt: Date.now() }],
  ]);
  const { getPendingFlow } = load(declaration("server/oauth-subscriptions.ts", "getPendingFlow"), { pendingOAuthFlows });
  for (const tenantId of [...invalidScopes, 3]) {
    assert.equal(getPendingFlow("state-fixture", tenantId), null);
    assert.equal(pendingOAuthFlows.size, 1, "unauthorized callers must not consume valid state");
  }
  assert.equal(getPendingFlow("state-fixture", 2)?.tenantId, 2);
  assert.equal(pendingOAuthFlows.size, 0);
  assert.equal(getPendingFlow("state-fixture", 2), null, "successful exchange is single use");
});

test("custom-tool validation experiments retain the tool's owning customer", async () => {
  const writes: any[] = [];
  const source = declaration("server/tool-learning.ts", "logToolExperiment")
    .replace('await import("@shared/schema")', "({ experiments: experimentTable })");
  const { logToolExperiment } = load(`export ${source}`, {
    experimentTable: {},
    db: { insert: () => ({ values: async (v: any) => { writes.push(v); } }) },
  });
  await logToolExperiment("custom_test", "kept", 3, 0, [], 2);
  assert.equal(writes[0].tenantId, 2);
  for (const tenantId of invalidScopes) {
    await logToolExperiment("custom_test", "kept", 3, 0, [], tenantId);
  }
  assert.equal(writes.length, 1, "invalid scope must not write a tenantless experiment");
});

test("project-brain backfill keeps each conversation and message with its owning project", async () => {
  const queries: any[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?").replace(/\s+/g, " "), values,
  });
  const { backfillProjectBrains } = load(declaration("server/project-brain.ts", "backfillProjectBrains"), {
    sql, ensureBrainDir: () => {}, brainFilePath: () => "fixture",
    fs: { existsSync: () => false },
    db: { execute: async (q: any) => {
      queries.push(q);
      return { rows: queries.length === 1 ? [{ id: 17, name: "project", tenant_id: 2 }] :
        queries.length === 2 ? [{ id: 32, title: "conversation" }] : [] };
    } },
  });
  await backfillProjectBrains();
  assert.match(queries[0].text, /c.tenant_id = p.tenant_id/);
  assert.match(queries[0].text, /tenant_id = c.tenant_id/);
  assert.match(queries[1].text, /c.tenant_id = \?/);
  assert.deepEqual(queries[1].values, [17, 2]);
  assert.match(queries[2].text, /tenant_id = \?/);
  assert.deepEqual(queries[2].values, [32, 2]);
});

test("snapshot import rejects inconsistent research ownership before any writes or deletion", async () => {
  const queries: any[] = [];
  let deleted = false;
  const snapshot = {
    programs: [{ id: 7, tenant_id: 2, name: "source" }],
    sessions: [{ id: 11, program_id: 7, tenant_id: 2 }],
    experiments: [{ id: 101, session_id: 11, program_id: 7, tenant_id: 3 }],
  };
  const { importDevSnapshot } = load(`export ${declaration("server/seed.ts", "importDevSnapshot")}`, {
    process: { cwd: () => "/fixture" }, path: { resolve: () => "/fixture/snapshot.json" },
    existsSync: () => true, readFileSync: () => JSON.stringify(snapshot),
    unlinkSync: () => { deleted = true; },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }),
    db: { execute: async (q: any) => {
      queries.push(q);
      return { rows: q.text.includes("COUNT(*)") ? [{ count: "0" }] : [{ id: 23 }] };
    } },
  });
  await importDevSnapshot();
  assert.equal(queries.length, 0, "inconsistent snapshot must fail before importing any parent");
  assert.equal(deleted, false, "refused source must be retained for investigation");
});

function snapshotFixture(snapshot: any, failExperiment = false) {
  const queries: any[] = [];
  let deleted = false;
  let transactions = 0;
  let committed = false;
  let sessionId = 200;
  let experimentId = 300;
  const execute = async (q: any) => {
    queries.push(q);
    if (q.text.includes("FROM research_programs")) return { rows: [{ id: 70 }] };
    if (q.text.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
    if (q.text.includes("INSERT INTO research_sessions")) return { rows: [{ id: ++sessionId }] };
    if (q.text.includes("INSERT INTO research_experiments")) {
      if (failExperiment) throw new Error("fixture write failure");
      return { rows: [{ id: ++experimentId }] };
    }
    return { rows: [] };
  };
  const { importDevSnapshot } = load(`export ${declaration("server/seed.ts", "importDevSnapshot")}`, {
    process: { cwd: () => "/fixture" }, path: { resolve: () => "/fixture/snapshot.json" },
    existsSync: () => true, readFileSync: () => JSON.stringify(snapshot),
    unlinkSync: () => { deleted = true; },
    logSilentCatch: () => {},
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }),
    db: {
      execute,
      transaction: async (fn: any) => {
        transactions++;
        await fn({ execute });
        committed = true;
      },
    },
  });
  return { importDevSnapshot, queries, state: () => ({ deleted, transactions, committed }) };
}

const validResearchSnapshot = () => ({
  programs: [{ id: 7, tenant_id: 2, name: "source" }],
  sessions: [{ id: 11, program_id: 7, tenant_id: 2 }, { id: 7, program_id: 7, tenant_id: 2 }],
  experiments: [
    { id: 101, session_id: 11, program_id: 7, tenant_id: 2 },
    { id: 102, session_id: 7, program_id: 7, tenant_id: 2, parent_experiment_id: 103 },
    { id: 103, session_id: 7, program_id: 7, tenant_id: 2 },
  ],
});

test("valid snapshot maps exact noncontiguous source IDs and remaps parent experiments atomically", async () => {
  const f = snapshotFixture(validResearchSnapshot());
  await f.importDevSnapshot();
  assert.deepEqual(f.state(), { deleted: true, transactions: 1, committed: true });
  const sessions = f.queries.filter(q => q.text.includes("INSERT INTO research_sessions"));
  assert.deepEqual(sessions.map(q => q.values.slice(0, 2)), [[2, 70], [2, 70]]);
  const experiments = f.queries.filter(q => q.text.includes("INSERT INTO research_experiments"));
  assert.deepEqual(experiments.map(q => q.values.slice(0, 3)), [[201, 2, 70], [202, 2, 70], [202, 2, 70]]);
  const update = f.queries.find(q => q.text.includes("UPDATE research_experiments"));
  assert.deepEqual(update.values, [303, 302, 2]);
  assert.ok(f.queries[0].text.includes("pg_advisory_xact_lock"));
});

const invalidSnapshotCases: [string, (snapshot: any) => void][] = [
  ["missing legacy program ID", s => { delete s.programs[0].id; }],
  ["missing legacy session ID", s => { delete s.sessions[0].id; }],
  ["missing legacy experiment ID", s => { delete s.experiments[0].id; }],
  ["invalid tenant", s => { s.programs[0].tenant_id = "2"; }],
  ["duplicate identity", s => { s.sessions[1].id = 11; }],
  ["ambiguous program name", s => { s.programs.push({ ...s.programs[0], id: 8 }); }],
  ["foreign session owner", s => { s.sessions[0].tenant_id = 3; }],
  ["missing program", s => { s.sessions[0].program_id = 99; }],
  ["missing session", s => { s.experiments[0].session_id = 99; }],
  ["foreign experiment owner", s => { s.experiments[0].tenant_id = 3; }],
  ["foreign parent session", s => { s.experiments[1].parent_experiment_id = 101; }],
  ["missing parent", s => { s.experiments[1].parent_experiment_id = 999; }],
  ["self parent", s => { s.experiments[1].parent_experiment_id = 102; }],
  ["malformed collection", s => { s.experiments = {}; }],
];
for (const [name, invalidate] of invalidSnapshotCases) {
  test(`snapshot refuses ${name} before a transaction, query, or source deletion`, async () => {
    const snapshot = validResearchSnapshot();
    invalidate(snapshot);
    const f = snapshotFixture(snapshot);
    await f.importDevSnapshot();
    assert.equal(f.queries.length, 0);
    assert.deepEqual(f.state(), { deleted: false, transactions: 0, committed: false });
  });
}

test("a write failure cannot complete the import transaction or delete its source", async () => {
  const f = snapshotFixture(validResearchSnapshot(), true);
  await f.importDevSnapshot();
  assert.deepEqual(f.state(), { deleted: false, transactions: 1, committed: false });
});

