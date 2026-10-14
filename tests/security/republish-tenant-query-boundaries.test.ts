import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { sql, eq, desc, and, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "../../shared/schema";

const dialect = new PgDialect();

function loadHeadingModule(db: { execute: (query: unknown) => Promise<unknown> }) {
  const source = fs.readFileSync("server/doc-heading-tree.ts", "utf8");
  const { code } = transformSync(source, { loader: "ts", format: "cjs" });
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "./db") return { db };
      if (name === "drizzle-orm") return { sql };
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  });
  return module.exports;
}

// Execute the real exported query builder against a bounded, compiled-SQL
// fixture driver. This is not a live PostgreSQL concurrency test.
test("heading navigation cannot disclose a foreign collection through an owned tree", async () => {
  const heading = loadHeadingModule({
    async execute(query: any) {
      const compiled = dialect.sqlToQuery(query);
      const treeScope = compiled.sql.match(/\bt\.tenant_id\s*=\s*\$(\d+)/);
      assert.ok(treeScope, "the owned tree must retain its tenant predicate");
      assert.equal(compiled.params[Number(treeScope[1]) - 1], 2);
      const collectionScope = compiled.sql.match(/\bc\.tenant_id\s*=\s*\$(\d+)/);
      const boundTenant = collectionScope
        ? compiled.params[Number(collectionScope[1]) - 1]
        : undefined;
      return { rows: [{
        collection_id: 10,
        collection_name: boundTenant === 2 ? null : "FOREIGN_COLLECTION",
        doc_path: "owned.md", doc_title: "Owned tree",
        total_headings: 3, total_lines: 20, tree: [],
      }] };
    },
  });
  const result = await heading.listHeadingTrees({ tenantId: 2 });
  assert.equal(result.docs.length, 1, "a LEFT JOIN must preserve the owned tree");
  assert.equal(result.docs[0].collectionName, null);
});

test("intent distillation excludes foreign-tenant messages even with a mismatched parent reference", async () => {
  let submittedPrompt = "";
  const fixtureMessages = [
    { conversationId: 70, tenantId: 2, role: "user", content: "OWNED_CONTENT" },
    { conversationId: 70, tenantId: 3, role: "user", content: "FOREIGN_CONTENT" },
  ];
  const db = {
    select() {
      let rows: any[] = [];
      const chain: any = {
        from(table: any) {
          rows = getTableName(table) === "messages"
            ? [...fixtureMessages]
            : [{ id: 70, tenantId: 2, personaId: null, title: "Owned conversation" }];
          return chain;
        },
        where(condition: any) {
          const query = dialect.sqlToQuery(condition);
          const tenant = query.sql.match(/"(?:messages|conversations)"\."tenant_id"\s*=\s*\$(\d+)/);
          if (tenant) rows = rows.filter(row => row.tenantId === query.params[Number(tenant[1]) - 1]);
          return chain;
        },
        orderBy() { return chain; },
        limit() { return chain; },
        then(resolve: any, reject: any) { return Promise.resolve(rows).then(resolve, reject); },
      };
      return chain;
    },
  };
  const { code } = transformSync(fs.readFileSync("server/skillify.ts", "utf8"), { loader: "ts", format: "cjs" });
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    require(name: string) {
      if (name === "./db") return { db };
      if (name === "@shared/schema") return schema;
      if (name === "drizzle-orm") return { eq, desc, and };
      if (name === "./storage") return { storage: {} };
      if (name === "./lib/silent-catch") return { logSilentCatch() {} };
      if (name === "./lib/sanitize-untrusted") return { sanitizeUntrusted: (text: string) => text };
      if (name === "./providers") return {
        async getClientForModel() {
          return { actualModelId: "fixture", client: { chat: { completions: {
            async create(request: any) {
              submittedPrompt = request.messages.map((message: any) => message.content).join("\n");
              return { choices: [{ message: { content: '{"worthSkillifying":false,"reason":"fixture"}' } }] };
            },
          } } } };
        },
      };
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  });
  await module.exports.distillIntent(70, 2);
  assert.match(submittedPrompt, /OWNED_CONTENT/, "the real distillation path must run");
  assert.doesNotMatch(submittedPrompt, /FOREIGN_CONTENT/);
});

test("Minds transcript query binds message ownership independently of its parent", () => {
  const source = fs.readFileSync("server/minds-engine.ts", "utf8");
  const template = source.match(/sql`(\s*SELECT m\.role, m\.content FROM messages m[\s\S]*?)`/);
  assert.ok(template, "the real transcript query must be exercised");
  const query = vm.runInNewContext(`sql\`${template[1]}\``, {
    sql, tenantId: 2, run: { conversationId: 70 },
  });
  const compiled = dialect.sqlToQuery(query);
  const scope = compiled.sql.match(/\bm\.tenant_id\s*=\s*\$(\d+)/);
  const bound = scope ? compiled.params[Number(scope[1]) - 1] : undefined;
  const fixture = [{ tenantId: 2 }, { tenantId: 3 }];
  const visible = fixture.filter(row => bound === undefined || row.tenantId === bound);
  assert.deepEqual(visible, [{ tenantId: 2 }]);
});

test("memory links only permit cross-tenant batch scope for a platform administrator", () => {
  const source = fs.readFileSync("server/routes/memory.ts", "utf8");
  const initializer = source.match(/const tenantClause = ([\s\S]*?);/);
  assert.ok(initializer);
  for (const privileged of [false, true]) {
    const clause = vm.runInNewContext(initializer[1], {
      tenantId: 1, ADMIN_TENANT_ID: 1, req: {},
      isPlatformAdmin: () => privileged,
      sql, eq, memoryEntries: schema.memoryEntries,
    });
    const compiled = dialect.sqlToQuery(clause);
    if (privileged) {
      assert.equal(compiled.sql.trim(), "TRUE");
    } else {
      assert.match(compiled.sql, /"tenant_id"/);
      assert.deepEqual(compiled.params, [1]);
    }
  }
});

test("post-insert heartbeat approval updates retain the creating caller's tenant", () => {
  const source = fs.readFileSync("server/heartbeat.ts", "utf8");
  const updates = [...source.matchAll(/sql`(UPDATE heartbeat_tasks SET approval_status = 'pending'[^`]+)`/g)];
  assert.equal(updates.length, 2, "exercise both task-creation paths");
  for (const update of updates) {
    const query = vm.runInNewContext(`sql\`${update[1]}\``, {
      sql, tenantId: 3, newTask: { id: 90 },
    });
    const compiled = dialect.sqlToQuery(query);
    const scope = compiled.sql.match(/\btenant_id\s*=\s*\$(\d+)/);
    assert.ok(scope, "approval writes must preserve the trusted constructor tenant");
    assert.equal(compiled.params[Number(scope[1]) - 1], 3);
  }
});
