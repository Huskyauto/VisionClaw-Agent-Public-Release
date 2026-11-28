import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "../../server/db";
import { addCrewTask } from "../../server/crews-engine";

function loadAttemptSelfHeal(deps: Record<string, unknown>) {
  const file = "server/agentic/self-heal.ts";
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "attemptSelfHeal",
  );
  assert.ok(node, "attemptSelfHeal declaration exists");
  const code = ts.transpileModule(node.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, (...args: any[]) => Promise<any>> = {};
  vm.runInNewContext(code, { exports, ...deps });
  return exports.attemptSelfHeal;
}

function selfHealHarness(runRecord?: { id: number; tenantId: number }) {
  const calls: Array<{ kind: string; value?: any }> = [];
  const dbMock = {
    insert: () => ({
      values: (value: any) => {
        calls.push({ kind: "attempt-insert", value });
        return { returning: async () => [{ id: 73, ...value }] };
      },
    }),
    update: () => ({
      set: (value: any) => ({
        where: async () => {
          calls.push({ kind: "attempt-update", value });
          return [];
        },
      }),
    }),
  };
  const attempt = loadAttemptSelfHeal({
    db: dbMock,
    selfHealAttempts: {},
    and: (...conditions: any[]) => conditions,
    eq: (...args: any[]) => args,
    getRun: async (runId: number, tenantId: number) => {
      calls.push({ kind: "ownership-check", value: { runId, tenantId } });
      return runRecord?.id === runId && runRecord.tenantId === tenantId ? runRecord : undefined;
    },
    checkRateLimit: async () => ({ allowed: true }),
    checkRunCounter: async () => ({ allowed: true, count: 0 }),
    runLlmTask: async () => ({ success: false, error: "fixture diagnostic failure" }),
    appendStep: async (...args: any[]) => { calls.push({ kind: "append-step", value: args }); },
    createApproval: async (...args: any[]) => { calls.push({ kind: "approval", value: args }); },
    buildDiagnosticPrompt: () => "fixture",
    FIX_PLAN_SCHEMA: {},
    MAX_HEALS_PER_RUN: 4,
    HIGH_RISK_FIX_TYPES: new Set(["custom_tool", "code_snippet"]),
    console,
    require: (specifier: string) => {
      if (specifier === "../auth") return { ADMIN_TENANT_ID: 1 };
      if (specifier === "./repair-incident") {
        return {
          captureIncident: async (...args: any[]) => {
            calls.push({ kind: "incident", value: args });
          },
        };
      }
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });
  return { attempt, calls };
}

test("self-heal rejects foreign or missing run IDs before attempts, steps, approvals, or incidents", async () => {
  for (const { runId, record } of [
    { runId: 501, record: { id: 501, tenantId: 31 } },
    { runId: 502, record: undefined },
  ]) {
    const { attempt, calls } = selfHealHarness(record);
    const result = await attempt({
      tenantId: 29,
      runId,
      triggerSource: "test",
      originalGoal: "test goal",
      failure: { error: "fixture failure" },
      availableTools: [],
    });

    assert.equal(result.healed, false);
    assert.match(result.error || "", /run.*not found|run.*tenant|ownership/i);
    assert.deepEqual(calls.filter((call) => call.kind !== "ownership-check"), []);
    assert.deepEqual(calls[0], { kind: "ownership-check", value: { runId, tenantId: 29 } });
  }
});

test("self-heal keeps null runId optional and does not attempt run ownership lookup", async () => {
  const { attempt, calls } = selfHealHarness();
  const result = await attempt({
    tenantId: 29,
    runId: null,
    triggerSource: "test",
    originalGoal: "test goal",
    failure: { error: "fixture failure" },
    availableTools: [],
  });

  assert.equal(result.attemptId, 73);
  assert.match(result.error || "", /Diagnosis failed/);
  assert.equal(calls.some((call) => call.kind === "ownership-check"), false);
  assert.equal(calls.find((call) => call.kind === "attempt-insert")?.value.runId, null);
  assert.equal(calls.some((call) => call.kind === "append-step"), false);
});

test("addCrewTask refuses agents not owned by the requested crew and tenant before INSERT", async (t) => {
  const dialect = new PgDialect();
  const originalExecute = db.execute;
  const cases = [
    { agentId: 901, description: "agent from another crew in this tenant" },
    { agentId: 902, description: "agent from another tenant" },
  ];

  for (const { agentId, description } of cases) {
    const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
    t.mock.method(db, "execute", async (query: any) => {
      const rendered = dialect.sqlToQuery(query);
      queries.push(rendered);
      if (/SELECT \* FROM crews/.test(rendered.sql)) {
        return { rows: [{ id: 44, tenant_id: 29, name: "owned crew", config: {} }] };
      }
      if (/SELECT id FROM crew_agents/.test(rendered.sql)) return { rows: [] };
      if (/INSERT INTO crew_tasks/.test(rendered.sql)) {
        return { rows: [{ id: 88, crew_id: 44, tenant_id: 29, agent_id: agentId }] };
      }
      throw new Error(`Unexpected query: ${rendered.sql}`);
    });

    const result = await addCrewTask({
      crewId: 44,
      tenantId: 29,
      agentId,
      description: "test task",
      expectedOutput: "test output",
    });

    assert.equal(result.success, false, description);
    assert.match(result.error || "", /agent.*(crew|tenant|found|belong)/i, description);
    const ownership = queries.find((query) => /SELECT id FROM crew_agents/.test(query.sql));
    assert.ok(ownership, "checks agent ownership");
    assert.match(ownership.sql, /id\s*=\s*\$\d+[\s\S]*crew_id\s*=\s*\$\d+[\s\S]*tenant_id\s*=\s*\$\d+/i);
    assert.ok(ownership.params.includes(agentId));
    assert.ok(ownership.params.includes(44));
    assert.ok(ownership.params.includes(29));
    assert.equal(queries.some((query) => /INSERT INTO crew_tasks/.test(query.sql)), false);

    t.mock.restoreAll();
    assert.equal(db.execute, originalExecute);
  }
});

test("addCrewTask permits an owned agent and an unspecified agent", async (t) => {
  const dialect = new PgDialect();
  const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  t.mock.method(db, "execute", async (query: any) => {
    const rendered = dialect.sqlToQuery(query);
    queries.push(rendered);
    if (/SELECT \* FROM crews/.test(rendered.sql)) {
      return { rows: [{ id: 44, tenant_id: 29, name: "owned crew", config: {} }] };
    }
    if (/SELECT id FROM crew_agents/.test(rendered.sql)) {
      return { rows: [{ id: 901 }] };
    }
    if (/INSERT INTO crew_tasks/.test(rendered.sql)) {
      return {
        rows: [{
          id: 88, crew_id: 44, tenant_id: 29, agent_id: null,
          description: "test task", expected_output: "test output",
        }],
      };
    }
    throw new Error(`Unexpected query: ${rendered.sql}`);
  });

  const assigned = await addCrewTask({
    crewId: 44, tenantId: 29, agentId: 901,
    description: "assigned task", expectedOutput: "test output",
  });
  assert.equal(assigned.success, true);
  assert.ok(queries.some((query) => /SELECT id FROM crew_agents/.test(query.sql)));
  assert.ok(queries.some((query) => /INSERT INTO crew_tasks/.test(query.sql)));

  queries.length = 0;
  const unassigned = await addCrewTask({
    crewId: 44, tenantId: 29,
    description: "unassigned task", expectedOutput: "test output",
  });
  assert.equal(unassigned.success, true);
  assert.equal(queries.some((query) => /SELECT id FROM crew_agents/.test(query.sql)), false);
  assert.ok(queries.some((query) => /INSERT INTO crew_tasks/.test(query.sql)));
});
