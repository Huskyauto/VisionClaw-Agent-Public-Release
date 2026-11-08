import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

function loadFunction(file: string, name: string, globals: Record<string, unknown>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `Missing public function ${name}`);
  const code = ts.transpileModule(node.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {} as Record<string, (...args: any[]) => Promise<any>>, console, ...globals };
  vm.runInNewContext(code, context);
  return context.exports[name];
}

test("insight auto-application rejects omitted scope before any write and binds valid tenant", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const apply = loadFunction("server/agentic-engines.ts", "autoApplyEligibleInsights", {
    sql,
    db: { execute: async (query: any) => { queries.push(new PgDialect().sqlToQuery(query)); return { rows: [] }; } },
    AUTO_APPLY_CATEGORIES: new Set(["scheduling_optimization"]),
    AUTO_APPLY_REASON: "test",
  });
  for (const value of [undefined, null, 0, -1, "1", NaN, Infinity]) {
    await assert.rejects(() => apply(value), /tenantId/);
  }
  assert.equal(queries.length, 0);
  assert.equal(await apply(37), 0);
  assert.match(queries[0].sql, /tenant_id\s*=\s*\$\d+/);
  assert.ok(queries[0].params.includes(37));
});

test("a channel subscription cannot update a conflicting row from another tenant", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const subscribe = loadFunction("server/agent-channels.ts", "subscribeToChannel", {
    sql,
    db: { execute: async (query: any) => {
      queries.push(new PgDialect().sqlToQuery(query));
      return { rows: queries.length === 1 ? [{ id: 23 }] : [] };
    } },
  });
  await assert.rejects(() => subscribe(37, 23, 1), /tenant|subscription/i);
  assert.match(queries[1].sql, /WHERE\s+channel_subscriptions\.tenant_id\s*=\s*\$\d+/i);
  assert.ok(queries[1].params.includes(37));
});

test("channel posts reject foreign thread and event references before insertion", async () => {
  for (const reference of [{ threadId: 91 }, { eventRef: 92 }]) {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    const post = loadFunction("server/agent-channels.ts", "postMessage", {
      sql,
      getChannelByName: async () => ({ id: 23 }),
      db: { execute: async (query: any) => {
        queries.push(new PgDialect().sqlToQuery(query));
        return { rows: [] };
      } },
    });
    await assert.rejects(() => post({ tenantId: 37, channelName: "test", content: "test", ...reference }), /reference|thread|event/i);
    assert.equal(queries.length, 1);
    assert.doesNotMatch(queries[0].sql, /INSERT/i);
    assert.match(queries[0].sql, /tenant_id\s*=\s*\$\d+/);
    assert.ok(queries[0].params.includes(37));
  }
});

test("every channel read branch binds joined channel ownership to the message tenant", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const read = loadFunction("server/agent-channels.ts", "readMessages", {
    sql,
    db: { execute: async (query: any) => {
      const rendered = new PgDialect().sqlToQuery(query);
      queries.push(rendered);
      return { rows: /SELECT channel_id FROM channel_subscriptions/.test(rendered.sql) ? [{ channel_id: 23 }] : [] };
    } },
  });
  for (const branch of [{ channelId: 23, unreadOnly: true, personaId: 1 }, { channelId: 23 },
    { personaId: 1, unreadOnly: true }, { personaId: 1 }, {}]) {
    await read({ tenantId: 37, ...branch });
  }
  const joined = queries.filter(q => /JOIN agent_channels/.test(q.sql));
  assert.equal(joined.length, 5);
  for (const query of joined) {
    assert.match(query.sql, /ac\.tenant_id\s*=\s*cm\.tenant_id/);
    assert.ok(query.params.includes(37));
  }
});

test("research evidence rejects a foreign project before storing its content", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const save = loadFunction("server/agentic-features.ts", "saveEvidence", {
    sql,
    redactPiiForStorage: (text: string) => ({ redacted: text }),
    deriveEvidenceProvenance: () => ({}),
    db: { execute: async (query: any) => {
      queries.push(new PgDialect().sqlToQuery(query));
      return { rows: [] };
    } },
  });
  await assert.rejects(() => save({ tenantId: 37, projectId: 91, query: "test", claim: "test" }), /project/i);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /SELECT.+FROM projects/s);
  assert.match(queries[0].sql, /tenant_id\s*=\s*\$\d+/);
  assert.ok(queries[0].params.includes(37));
});

test("adaptive lessons reject missing tenant before any memory write", async () => {
  const writes: any[] = [];
  const save = loadFunction("server/adaptive-execution.ts", "saveLessonLearned", {
    storage: { createMemoryEntry: async (entry: any) => { writes.push(entry); } },
  });
  await assert.rejects(() => save("test", "error", "solution"), /tenantId/);
  assert.equal(writes.length, 0);
  await save("test", "error", "solution", 37);
  assert.equal(writes[0].tenantId, 37);
});

test("forking a populated conversation copies each message under the authorized tenant", async () => {
  const copies: any[] = [];
  const fork = loadFunction("server/agent-manager.ts", "forkConversation", {
    storage: {
      getConversation: async (_id: number, tenant: number) => tenant === 37 ? { id: 1, title: "test", model: "test" } : null,
      createConversation: async (data: any) => { assert.equal(data.tenantId, 37); return { id: 2 }; },
      getMessages: async (_id: number, tenant: number) => { assert.equal(tenant, 37); return [{ role: "user", content: "test" }]; },
      createMessage: async (data: any) => { assert.equal(data.tenantId, 37); copies.push(data); },
    },
  });
  const result = await fork(1, 37);
  assert.equal(result.success, true);
  assert.equal(result.messagesCopied, 1);
  assert.equal(copies[0].conversationId, 2);
  assert.equal((await fork(1, 38)).success, false);
  assert.equal(copies.length, 1);
});

test("agent runs reject foreign parent runs before creating a child", async () => {
  let writes = 0;
  const create = loadFunction("server/agentic/runs.ts", "createRun", {
    getRun: async () => null,
    agentRuns: {},
    recordRunBoundary: async () => {},
    db: { insert: () => { writes++; return { values: () => ({ returning: async () => [{ id: 1 }] }) }; } },
  });
  await assert.rejects(() => create({ tenantId: 37, parentRunId: 91, runType: "test", goal: "test" }), /parent/i);
  assert.equal(writes, 0);
  await assert.rejects(() => create({ tenantId: 0, runType: "test", goal: "test" }), /tenantId/);
  assert.equal(writes, 0);
});

test("scheduled wakes reject foreign project and conversation references", async () => {
  for (const reference of [{ projectId: 91 }, { conversationId: 92 }]) {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    // Empty ownership results, but an INSERT would incorrectly succeed.
    const scheduleDenied = loadFunction("server/agentic/wake-scheduler.ts", "scheduleWake", {
      sql, MAX_HORIZON_DAYS: 30,
      db: { execute: async (query: any) => {
        const rendered = new PgDialect().sqlToQuery(query);
        queries.push(rendered);
        return { rows: /INSERT/.test(rendered.sql) ? [{ id: 1, wake_at: new Date() }] : [] };
      } },
    });
    await assert.rejects(() => scheduleDenied({ tenantId: 37, goal: "test", wakeAt: new Date(Date.now() + 1000), ...reference }), /project|conversation/i);
    assert.equal(queries.length, 1);
    assert.doesNotMatch(queries[0].sql, /INSERT/);
    assert.ok(queries[0].params.includes(37));
  }
});

test("task forces reject a foreign project before creating state or emitting an event", async () => {
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const create = loadFunction("server/agentic/task-forces.ts", "createTaskForce", {
    sql,
    personaIdArrayLiteral: () => null,
    emitEvent: async () => {},
    db: { execute: async (query: any) => {
      const rendered = new PgDialect().sqlToQuery(query);
      queries.push(rendered);
      return { rows: /INSERT/.test(rendered.sql) ? [{ id: 1 }] : [] };
    } },
  });
  await assert.rejects(() => create({ tenantId: 37, projectId: 91, name: "test", mission: "test" }), /project/i);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].sql, /INSERT/);
  assert.ok(queries[0].params.includes(37));
});

test("automatic asset capture proves parent-project ownership before parsing or writing assets", async () => {
  let ownershipChecks = 0, parsed = 0;
  const capture = loadFunction("server/auto-asset-capture.ts", "captureProjectAssets", {
    sql,
    assertConversationInTenant: async () => true,
    assertProjectInTenant: async () => { ownershipChecks++; return false; },
    db: { execute: async () => ({ rows: [{ project_id: 91 }] }) },
    detectDeliverables: () => { parsed++; throw Error("Foreign content must not be processed"); },
  });
  assert.equal(await capture(23, 37, "test"), 0);
  assert.equal(ownershipChecks, 1);
  assert.equal(parsed, 0);
});

test("global provider health denies ordinary tenants before importing or probing providers", async () => {
  const handlers: ((req: any, res: any) => Promise<void>)[] = [];
  let checks = 0;
  const register = loadFunction("server/routes/auth-extra.ts", "registerAuthMonitoringRoutes", {
    requirePlatformAdmin: () => { checks++; return false; },
  });
  await register({ get: (_path: string, ...callbacks: any[]) => handlers.push(callbacks.at(-1)) }, { authMiddleware: () => {} });
  assert.equal(handlers.length, 2);
  for (const handler of handlers) {
    await assert.doesNotReject(() => handler({ tenantId: 2, query: { refresh: "true" } }, {}));
  }
  assert.equal(checks, 2);
});

test("provider-health UI gates requests and cached privileged content on current owner role", () => {
  const file = "client/src/pages/settings.tsx";
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "AuthHealthSettings");
  assert.ok(node);
  const component = node.getText(source);
  assert.match(component, /tenant\?\.id === 1 && tenant\?\.isAdmin === true/);
  assert.match(component, /enabled: canViewProviderHealth/);
  assert.match(component, /if \(!canViewProviderHealth\) return null/);
});
