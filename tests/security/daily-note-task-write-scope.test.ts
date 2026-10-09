import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

function fixture(existingNote = false) {
  const source = readFileSync("server/storage.ts", "utf8");
  const noteStart = source.indexOf("  async upsertDailyNote(");
  const deleteStart = source.indexOf("  async deleteHeartbeatTask(");
  const methods = [
    source.slice(noteStart, source.indexOf("\n  async ", noteStart + 10)),
    source.slice(deleteStart, source.indexOf("\n  async ", deleteStart + 10)),
  ].join("\n");
  const calls: any[] = [];
  const eq = (column: string, value: unknown) => ({ column, value });
  const and = (...conditions: unknown[]) => conditions;
  const db = {
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (predicate: unknown) => ({
          returning: async () => {
            calls.push({ op: "update", table, values, predicate });
            return [{ id: 17 }];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: async () => {
          calls.push({ op: "insert", table, values });
          return [{ id: 17 }];
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (predicate: unknown) => {
        calls.push({ op: "delete", table, predicate });
      },
    }),
  };
  const tables = {
    dailyNotes: { id: "note.id", tenantId: "note.tenantId" },
    heartbeatTasks: { id: "task.id", tenantId: "task.tenantId" },
  };
  const module = { exports: {} as any };
  const code = transformSync(`export class Subject { ${methods} }`, {
    loader: "ts", format: "cjs", target: "node22",
  }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, db, eq, and, ...tables,
    sql: () => { throw new Error("Unexpected raw SQL"); },
  });
  const subject = new module.exports.Subject();
  subject.getDailyNote = async (...args: unknown[]) => {
    calls.push({ op: "lookup", args });
    return existingNote ? { id: 17 } : undefined;
  };
  return { subject, calls, tables };
}

for (const tenantId of [undefined, null, 0, -1, NaN, Infinity, 1.5, "2", "__ALL_TENANTS__"]) {
  test(`daily-note write and task deletion refuse invalid scope ${String(tenantId)} before database access`, async () => {
    const { subject, calls } = fixture();
    await assert.rejects(
      subject.upsertDailyNote({ date: "2026-10-08", content: "private", tenantId }),
      /tenantId is required/,
    );
    await assert.rejects(subject.deleteHeartbeatTask(17, tenantId), /tenantId is required/);
    assert.equal(calls.length, 0);
  });
}

test("daily-note update binds both note identity and customer scope", async () => {
  const { subject, calls } = fixture(true);
  await subject.upsertDailyNote({ date: "2026-10-08", content: "private", tenantId: 2 });
  assert.equal(calls[0].args[2], 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].predicate)), [
    { column: "note.id", value: 17 }, { column: "note.tenantId", value: 2 },
  ]);
});

test("new daily notes retain explicit customer scope", async () => {
  const { subject, calls } = fixture();
  await subject.upsertDailyNote({ date: "2026-10-08", content: "private", tenantId: 2 });
  assert.equal(calls[0].args[2], 2);
  assert.equal(calls[1].op, "insert");
  assert.equal(calls[1].values.tenantId, 2);
});

test("task deletion always binds task identity and customer scope", async () => {
  const { subject, calls } = fixture();
  await subject.deleteHeartbeatTask(17, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].predicate)), [
    { column: "task.id", value: 17 }, { column: "task.tenantId", value: 2 },
  ]);
});

function dailyLogFixture() {
  const source = readFileSync("server/chat-daily-log.ts", "utf8").replace(/^import .*$/gm, "");
  const calls: any[] = [];
  const storage = {
    getDailyNote: async (...args: unknown[]) => {
      calls.push({ op: "lookup", args });
      return undefined;
    },
    upsertDailyNote: async (data: unknown) => { calls.push({ op: "write", data }); },
  };
  const module = { exports: {} as any };
  const code = transformSync(source, { loader: "ts", format: "cjs", target: "node22" }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, storage,
    logSilentCatch: () => { calls.push({ op: "caught" }); },
    console,
  });
  return { updateDailyLog: module.exports.updateDailyLog, calls };
}

test("daily-log helper rejects missing scope before reading existing customer notes", async () => {
  const { updateDailyLog, calls } = dailyLogFixture();
  await assert.rejects(updateDailyLog("private title", undefined, undefined, undefined), /tenantId is required/);
  assert.equal(calls.length, 0);
});

test("daily-log helper preserves customer scope for both lookup and write", async () => {
  const { updateDailyLog, calls } = dailyLogFixture();
  await updateDailyLog("private title", undefined, undefined, 2);
  assert.equal(calls[0].args[2], 2);
  assert.equal(calls[1].data.tenantId, 2);
});
