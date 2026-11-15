import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

function loadDelete(options: { storageFails?: boolean; databaseFails?: boolean; foreign?: boolean; storageKey?: string } = {}) {
  const source = readFileSync("server/routes/tenants.ts", "utf8");
  const start = source.indexOf('  app.delete("/api/tenant/files/:id",');
  assert.ok(start >= 0, "actual file-delete route must exist");
  const end = source.indexOf("\n  });", start) + "\n  });".length;
  const code = source.slice(start, end)
    .replace('await import("drizzle-orm")', "__orm")
    .replace('await import("../object-storage")', "__objectStorage");
  const events: string[] = [];
  let handler: any;
  const file = { id: 10, storageKey: options.storageKey ?? "tenant-2/files/example.txt" };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports,
    app: { delete: (_path: string, ...handlers: any[]) => { handler = handlers.at(-1); } },
    mutateLimiter: null, authMiddleware: null,
    getTenantFromRequest: (req: any) => req.tenantId,
    tenantFileAccessFilter: (tenant: number) => ({ tenant }),
    fileStorage: { id: "id" },
    __orm: { eq: (...args: any[]) => args, and: (...args: any[]) => args },
    __objectStorage: { deleteTenantFile: async (tenant: number, key: string) => {
      assert.equal(tenant, 2);
      assert.equal(key, file.storageKey);
      events.push("storage");
      if (options.storageFails) throw new Error("provider failure with private details");
    } },
    db: {
      select: () => ({ from: () => ({ where: () => ({
        limit: async () => options.foreign ? [] : [file],
      }) }) }),
      delete: () => ({ where: async (filters: any[]) => {
        assert.deepEqual(JSON.parse(JSON.stringify(filters)), [["id", 10], { tenant: 2 }]);
        events.push("database");
        if (options.databaseFails) throw new Error("database unavailable");
      } }),
    },
    console: { error() {}, warn() {} },
  };
  vm.runInNewContext(transformSync(code, { loader: "ts", format: "cjs" }).code, context);
  return {
    events,
    async request(tenantId: number | null = 2) {
      let status = 200, body: any;
      const res: any = {
        status(value: number) { status = value; return res; },
        json(value: any) { body = value; return res; },
      };
      await handler({ tenantId, params: { id: "10" } }, res);
      return { status, body };
    },
  };
}

test("storage failure retains the deletion record and never reports success", async () => {
  const route = loadDelete({ storageFails: true });
  const result = await route.request();
  assert.equal(result.status, 503);
  assert.equal(result.body.success, undefined);
  assert.deepEqual(route.events, ["storage"]);
  assert.ok(!JSON.stringify(result.body).includes("private details"));
});

test("successful file deletion removes storage before its tenant-scoped record", async () => {
  const route = loadDelete();
  assert.equal((await route.request()).body.success, true);
  assert.deepEqual(route.events, ["storage", "database"]);
});

test("missing authentication and foreign files cause no deletion", async () => {
  const missing = loadDelete();
  assert.equal((await missing.request(null)).status, 401);
  assert.deepEqual(missing.events, []);
  const foreign = loadDelete({ foreign: true });
  assert.equal((await foreign.request()).status, 404);
  assert.deepEqual(foreign.events, []);
});

test("database failure after storage deletion is not acknowledged as success", async () => {
  const route = loadDelete({ databaseFails: true });
  assert.equal((await route.request()).status, 500);
  assert.deepEqual(route.events, ["storage", "database"]);
});

function storageDelete(client: any) {
  const source = readFileSync("server/object-storage.ts", "utf8");
  const start = source.indexOf("export async function deleteTenantFile(");
  const end = source.indexOf("\nexport ", start + 1);
  const code = source.slice(start, end);
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(code, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, client,
    tenantPrefix: (tenant: number) => `tenant-${tenant}`,
  });
  return module.exports.deleteTenantFile;
}

test("object-storage result failures throw even when the SDK does not reject", async () => {
  const remove = storageDelete({ delete: async () => ({ ok: false, error: new Error("private provider response") }) });
  await assert.rejects(remove(2, "tenant-2/files/example.txt"), /Unable to delete stored file/);
});

test("object-storage deletion is tenant-bound and missing-object retry is idempotent", async () => {
  const calls: any[] = [];
  const remove = storageDelete({ delete: async (...args: any[]) => {
    calls.push(args);
    return { ok: true, value: null };
  } });
  await assert.rejects(remove(2, "tenant-3/files/example.txt"), /Access denied/);
  assert.deepEqual(calls, []);
  await remove(2, "tenant-2/files/example.txt");
  assert.equal(calls[0][1].ignoreNotFound, true);
});
