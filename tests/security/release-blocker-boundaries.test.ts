import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";
import { tenantDriveDownloadPath } from "../../server/lib/tenant-drive-access";

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
  assert.ok(found, `${name} must exist`);
  return found.getText(ast);
}

function load(source: string, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, console, ...globals,
  });
  return module.exports;
}

test("tenant Drive download authorizes the remote file before metadata, bytes or disk access", async () => {
  const calls: string[] = [];
  const { downloadFromDrive } = load(declaration("server/google-drive.ts", "downloadFromDrive"), {
    requireTenantDriveFileAccess: async (tenant: number, id: string) => {
      calls.push(`authorize:${tenant}:${id}`);
      throw new Error("Drive file is not authorized for this tenant");
    },
    driveJson: async () => { calls.push("metadata"); throw new Error("unexpected metadata read"); },
  });
  const result = await downloadFromDrive({ fileId: "foreign", tenantId: 2 });
  assert.equal(result.success, false);
  assert.match(result.error, /not authorized/);
  assert.deepEqual(calls, ["authorize:2:foreign"]);
});

test("unscoped Drive downloads cannot reach metadata or bytes", async () => {
  const calls: string[] = [];
  const { downloadFromDrive } = load(declaration("server/google-drive.ts", "downloadFromDrive"), {
    requireTenantDriveFileAccess: async () => { calls.push("authorize"); throw new Error("tenant required"); },
    driveJson: async () => { calls.push("metadata"); return { error: { message: "unexpected" } }; },
  });
  const result = await downloadFromDrive({ fileId: "foreign" });
  assert.equal(result.success, false);
  assert.deepEqual(calls, ["authorize"]);
});

test("owned Drive download writes only the authorized tenant namespace", async () => {
  const calls: string[] = [];
  const root = "/uploads";
  const bytes = Buffer.from("authorized document");
  const { downloadFromDrive } = load(declaration("server/google-drive.ts", "downloadFromDrive"), {
    Buffer, path, tenantDriveDownloadPath, UPLOADS_DIR: root,
    MAX_TENANT_DRIVE_SOURCE_BYTES: 100 * 1024 * 1024,
    isPathWithin: (base: string, item: string) => item === base || item.startsWith(`${base}/`),
    requireTenantDriveFileAccess: async (tenant: number) => { assert.equal(tenant, 2); calls.push("authorize"); },
    driveJson: async () => { calls.push("metadata"); return { name: "owned.txt", size: String(bytes.length) }; },
    driveRequest: async () => {
      calls.push("bytes");
      return { ok: true, arrayBuffer: async () => bytes };
    },
    fs: {
      existsSync: () => false,
      mkdirSync: () => { calls.push("mkdir"); },
      realpathSync: (p: string) => p,
      writeFileSync: (p: string, content: Buffer, options: { flag: string }) => {
        assert.equal(p, "/uploads/tenant-drive/2/owned-file-owned.txt");
        assert.equal(options.flag, "wx");
        assert.equal(content.toString(), bytes.toString());
        calls.push("write");
      },
    },
  });
  const result = await downloadFromDrive({ fileId: "owned-file", tenantId: 2 });
  assert.equal(result.success, true);
  assert.equal(result.path, "uploads/tenant-drive/2/owned-file-owned.txt");
  assert.deepEqual(calls, ["authorize", "metadata", "mkdir", "bytes", "write"]);
});

test("heartbeat startup and the interface require the selected task tenant", () => {
  for (const file of ["server/heartbeat.ts", "server/heartbeat-startup.ts"]) {
    const text = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let calls = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast).endsWith(".markHeartbeatTaskRun")) {
        calls++;
        assert.equal(node.arguments.length, 3, `${file}: every update needs selected-row scope`);
        assert.match(node.arguments[2].getText(ast), /^Number\((?:task|t)\.tenantId\)$/);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(calls > 0);
  }
  const source = readFileSync("server/storage.ts", "utf8");
  assert.ok(source.includes("markHeartbeatTaskRun(id: number, nextRunAt: Date, tenantId: number): Promise<void>;"));
});

test("every Drive downloader caller explicitly supplies tenant scope", () => {
  for (const file of [
    "server/tools.ts", "server/tools/domains/files/handlers.ts",
    "server/build-video-from-brief.ts", "server/social-publisher.ts",
    "server/lib/ideabrowser-dev-sync.ts",
  ]) {
    const text = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let calls = 0;
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && /(?:^|\.)downloadFromDrive$/.test(node.expression.getText(ast))) {
        calls++;
        const argument = node.arguments[0];
        assert.ok(argument && ts.isObjectLiteralExpression(argument), `${file}: explicit arguments required`);
        assert.ok(argument.properties.some(p => p.name?.getText(ast) === "tenantId"),
          `${file}: missing trusted tenant scope`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(calls > 0);
  }
});

test("heartbeat run updates reject absent scope and bind the original task tenant", async () => {
  const predicates: unknown[] = [];
  let rows = [{ id: 7 }];
  const heartbeatTasks = { id: "id", tenantId: "tenantId" };
  const { Subject } = load(
    `export class Subject { ${declaration("server/storage.ts", "markHeartbeatTaskRun")} }`,
    {
      heartbeatTasks,
      eq: (column: string, value: unknown) => [column, value],
      and: (...conditions: unknown[]) => conditions,
      db: { update: () => ({ set: () => ({ where: (p: unknown) => {
        predicates.push(p);
        return { returning: async () => rows };
      } }) }) },
    },
  );
  const subject = new Subject();
  await assert.rejects(subject.markHeartbeatTaskRun(7, new Date()), /tenant/);
  assert.deepEqual(predicates, []);
  await subject.markHeartbeatTaskRun(7, new Date(), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(predicates)), [[["id", 7], ["tenantId", 2]]]);
  rows = [];
  await assert.rejects(subject.markHeartbeatTaskRun(7, new Date(), 2), /not found|not updated/i);
});

test("Drive deletion denies a foreign file before issuing DELETE", async () => {
  const calls: string[] = [];
  const { deleteDriveFile } = load(declaration("server/google-drive.ts", "deleteDriveFile"), {
    requireTenantDriveFileAccess: async (tenant: number, id: string) => {
      calls.push(`authorize:${tenant}:${id}`);
      throw new Error("Drive file is not authorized for this tenant");
    },
    driveRequest: async () => { calls.push("delete"); return { ok: true }; },
  });
  const result = await deleteDriveFile("foreign", 2);
  assert.equal(result.success, false);
  assert.match(result.error, /not authorized/);
  assert.deepEqual(calls, ["authorize:2:foreign"]);
});

test("Drive deletion reports provider failures rather than successful deletion", async () => {
  let status = 403;
  const { deleteDriveFile } = load(declaration("server/google-drive.ts", "deleteDriveFile"), {
    requireTenantDriveFileAccess: async () => {},
    driveRequest: async () => ({ ok: status === 204, status }),
  });
  for (status of [403, 404, 500]) {
    const result = await deleteDriveFile("owned", 2);
    assert.equal(result.success, false);
    assert.ok(result.error.includes(String(status)));
  }
  status = 204;
  assert.equal((await deleteDriveFile("owned", 2)).success, true);
});

for (const name of ["publishFinding", "claimSlot"]) {
  test(`${name} refuses invalid scope before inserting a bulletin row`, async () => {
    let writes = 0;
    const fn = load(declaration("server/lib/parallel-findings-bus.ts", name), {
      db: { execute: async () => { writes++; return { rows: [{ id: 1 }] }; } },
      sql: () => ({}),
    })[name];
    for (const tenantId of [undefined, null, 0, -1, 1.5, NaN, Infinity, "2"]) {
      await assert.rejects(fn({ tenantId, jobId: "job", subtaskId: "child", slotKey: "slot", finding: {} }), /tenant/i);
    }
    assert.equal(writes, 0);
  });
}

test("memory graph counts links only when both endpoints belong to the tenant", async () => {
  const queries: string[] = [];
  const { getMemoryGraph } = load(declaration("server/memory-graph.ts", "getMemoryGraph"), {
    getCategoryTree: async () => [],
    sql: (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " "),
    db: { execute: async (q: string) => { queries.push(q); return { rows: [{ count: 0 }] }; } },
  });
  await getMemoryGraph(2);
  const links = queries.find(q => q.includes("FROM memory_links"))!;
  assert.match(links, /target_memory_id = target\.id/);
  assert.match(links, /target\.tenant_id = \?/);
});

test("failed memory graph query is unavailable, not an apparently empty graph", async () => {
  const { getMemoryGraph } = load(declaration("server/memory-graph.ts", "getMemoryGraph"), {
    getCategoryTree: async () => [],
    db: { execute: async () => { throw new Error("database unavailable"); } },
    sql: () => ({}),
  });
  await assert.rejects(getMemoryGraph(2), /memory graph unavailable/i);
});

test("project brain authorizes project and conversation together before creating files", async () => {
  const calls: string[] = [];
  const { updateProjectBrain } = load(declaration("server/project-brain.ts", "updateProjectBrain"), {
    ensureBrainDir: () => { calls.push("filesystem"); },
    sql: (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " "),
    db: { execute: async (q: string) => { calls.push(q); return { rows: [] }; } },
  });
  await updateProjectBrain(17, 19, "private", "reply", undefined, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /JOIN conversations c/);
  assert.match(calls[0], /p\.tenant_id = \?/);
  assert.match(calls[0], /c\.id = \?/);
  assert.match(calls[0], /c\.tenant_id = \?/);
});

test("API message reads bind message tenant independently of the conversation", () => {
  const source = readFileSync("server/routes/api-v1.ts", "utf8");
  const reads = [...source.matchAll(/SELECT m\.(?:id|role)[\s\S]*?JOIN conversations c[\s\S]*?ORDER BY m\.id DESC/g)];
  assert.equal(reads.length, 2);
  for (const [query] of reads) {
    assert.match(query, /AND m\.tenant_id = \$\{tenantId\}/);
  }
});

test("Drive project discovery binds project and tenant before reading a project row", async () => {
  let predicate: any;
  const projects = { id: "project.id", tenantId: "project.tenantId" };
  const source = declaration("server/google-drive.ts", "searchDriveFiles")
    .replace('await import("@shared/schema")', "__schema");
  const { searchDriveFiles } = load(source, {
    __schema: { projects },
    eq: (column: string, value: unknown) => [column, value],
    and: (...conditions: unknown[]) => conditions,
    db: { select: () => ({ from: () => ({ where: (p: unknown) => {
      predicate = p;
      return { limit: async () => [] };
    } }) }) },
  });
  const result = await searchDriveFiles({ tenantId: 2, projectId: 17, namePattern: "report" });
  assert.equal(result.success, false);
  assert.deepEqual(JSON.parse(JSON.stringify(predicate)), [["project.id", 17], ["project.tenantId", 2]]);
});

test("delegation limits and duplicate checks use only the current tenant tasks", () => {
  const source = readFileSync("server/heartbeat.ts", "utf8");
  assert.ok(source.includes("const existingTasks = await storage.getHeartbeatTasks(undefined, tenantId);"),
    "delegation caps and duplicates must not consult other tenants' tasks");
});

test("persona and conversation-template catalog definitions have no tenant column", () => {
  const source = readFileSync("shared/schema.ts", "utf8");
  for (const name of ["personas", "conversationTemplates"]) {
    const match = source.match(new RegExp(`export const ${name} = pgTable\\([\\s\\S]*?\\n\\}\\);`));
    assert.ok(match);
    assert.doesNotMatch(match[0], /tenantId:|tenant_id/);
  }
});

test("WhatsApp owner alias is inaccessible to anonymous or foreign-tenant my routes", async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  const calls: Array<{ op: string; tenantId: unknown }> = [];
  const record = (op: string) => async (tenantId?: number) => {
    calls.push({ op, tenantId });
    return { status: "connected" };
  };
  const approval = {
    getApprovalPhone: (tenantId?: number) => { calls.push({ op: "phone", tenantId }); return "123@s.whatsapp.net"; },
    setApprovalPhone: async (_phone: string, tenantId?: number) => { calls.push({ op: "set-phone", tenantId }); },
    registerShortId: () => {},
    sendApprovalRequest: async (_id: string, _tool: string, _args: unknown, _text: string, tenantId?: number) => {
      calls.push({ op: "test", tenantId }); return true;
    },
  };
  const source = declaration("server/routes/whatsapp.ts", "registerWhatsAppRoutes")
    .replaceAll('await import("../whatsapp-approval")', "approval");
  const { registerWhatsAppRoutes } = load(source, {
    approval,
    whatsapp: { connectWhatsApp: record("connect"), disconnectWhatsApp: record("disconnect") },
  });
  const app = {
    use: (_prefix: string, guard: any) => {
      app.guard = guard;
    },
    guard: null as any,
    get: (route: string, fn: any) => handlers.set(`GET ${route}`, fn),
    post: (route: string, fn: any) => handlers.set(`POST ${route}`, fn),
  };
  registerWhatsAppRoutes(app, {
    ADMIN_TENANT_ID: 1,
    getTenantFromRequest: (req: any) => req.trustedTenant,
    requirePlatformAdmin: (req: any, res: any) => {
      if (req.trustedTenant === 1 && req.trustedAdmin) return true;
      res.status(403).json({ error: "Platform admin required" });
      return false;
    },
  });
  for (const tenant of [null, 2, 1]) {
    for (const route of [
      "POST /api/whatsapp/my/connect", "POST /api/whatsapp/my/disconnect",
      "GET /api/whatsapp/my/approval-phone", "POST /api/whatsapp/my/approval-phone",
      "POST /api/whatsapp/my/test-approval",
    ]) {
      const before = calls.length;
      let status = 200;
      const res = { status: (code: number) => { status = code; return res; }, json: () => {} };
      const req = { trustedTenant: tenant, trustedAdmin: tenant === 1, body: { phone: "123", tenantId: 1 } };
      if (app.guard) await app.guard(req, res, () => handlers.get(route)!(req, res));
      else await handlers.get(route)!(req, res);
      if (tenant === null) {
        assert.equal(status, 401);
        assert.equal(calls.length, before);
      } else {
        assert.equal(status, 200);
        assert.ok(calls.length > before);
        for (const call of calls.slice(before)) assert.equal(call.tenantId, tenant === 1 ? undefined : 2);
      }
    }
  }
  assert.ok(app.guard, "owner alias must require a platform-admin principal, not just tenant number");
  const before = calls.length;
  let status = 200;
  const res = { status: (code: number) => { status = code; return res; }, json: () => {} };
  const req = { trustedTenant: 1, trustedAdmin: false, body: { phone: "123" } };
  await app.guard(req, res, () => handlers.get("POST /api/whatsapp/my/connect")!(req, res));
  assert.equal(status, 403);
  assert.equal(calls.length, before);
});
