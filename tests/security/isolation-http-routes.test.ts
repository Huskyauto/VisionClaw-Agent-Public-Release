import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";
import express from "express";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assembleOwnedChunkedUpload, ChunkedUploadError } from "../../server/lib/chunked-upload";
import { validateScheduleProgramOwnership } from "../../server/lib/research-schedule";

const requireFromTest = createRequire(import.meta.url);
const quietConsole = { log() {}, warn() {}, error() {} };

function loadRouteModule(sourceUrl: URL, replacements: Record<string, unknown>) {
  const source = readFileSync(sourceUrl, "utf8").replace(
    /await import\((["'][^"']+["'])\)/g,
    "await Promise.resolve(require($1))",
  );
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "node20" }).code;
  const module = { exports: {} as Record<string, any> };
  const injectedRequire = (specifier: string) => {
    if (Object.hasOwn(replacements, specifier)) return replacements[specifier];
    return requireFromTest(specifier);
  };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: injectedRequire,
    console: quietConsole,
    setImmediate,
  });
  return module.exports;
}

async function withHttpApp(register: (app: express.Express) => void | Promise<void>, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  await register(app);
  const server: Server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function tenantHeaders(tenantId?: number) {
  // This test-only header is the trusted-actor seam injected into route helpers;
  // it is not production authentication or a production request header.
  return tenantId === undefined ? {} : { "x-test-tenant-id": String(tenantId) };
}

async function postJson(baseUrl: string, route: string, tenantId: number | undefined, body: unknown) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { ...tenantHeaders(tenantId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("real document, knowledge, and memory completion routes preserve foreign chunk state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "isolation-http-routes-"));
  const uploadsDir = path.join(root, "assembled");
  mkdirSync(uploadsDir);
  const uploads = new Map<string, any>();
  const collectionRows = new Map([[2, [{ id: 20, name: "tenant-two" }]], [3, [{ id: 30, name: "tenant-three" }]]]);
  const mutations: Array<{ kind: string; value: any }> = [];
  const docCollections = {
    async listCollections(tenantId: number) { return { collections: collectionRows.get(tenantId) ?? [] }; },
    async addDocument(collectionId: number, docPath: string, content: string, _context: string, tenantId: number) {
      mutations.push({ kind: "document", value: { collectionId, docPath, content, tenantId } });
      return { success: true };
    },
  };
  const storage = {
    async createKnowledge(value: any) {
      mutations.push({ kind: "knowledge", value });
      return { id: mutations.length };
    },
    async createMemoryEntry(value: any) {
      mutations.push({ kind: "memory", value });
      return { id: mutations.length };
    },
    async updateKnowledgeEmbedding() {},
    async updateMemoryEmbedding() {},
  };
  const routeModule = loadRouteModule(new URL("../../server/routes/doc-collections.ts", import.meta.url), {
    "../storage": { storage },
    "../lib/silent-catch": { logSilentCatch() {} },
    "../lib/chunked-upload": { assembleOwnedChunkedUpload, ChunkedUploadError },
    "../doc-collections": docCollections,
    "../embeddings": { async generateEmbedding() { return null; } },
  });

  const makeUpload = (id: string, tenantId: number, contents: string) => {
    const chunkPath = path.join(root, `${id}.chunk`);
    writeFileSync(chunkPath, contents);
    const state = {
      tenantId,
      fileName: `${id}.txt`,
      fileSize: Buffer.byteLength(contents),
      chunks: new Map([[0, chunkPath]]),
      totalChunks: 1,
      bytesReceived: Buffer.byteLength(contents),
    };
    uploads.set(id, state);
    return { state, chunkPath, assembledPath: path.join(uploadsDir, `${id}-assembled.txt`) };
  };

  try {
    const foreignTargets = [
      { id: "foreign-doc", url: "/api/doc-collections/30/upload-chunked" },
      { id: "foreign-knowledge", url: "/api/knowledge/upload-chunked" },
      { id: "foreign-memory", url: "/api/memory/upload-chunked" },
    ].map(({ id, url }) => ({ id, url, fixture: makeUpload(id, 2, `${id} payload`) }));

    await withHttpApp(app => routeModule.registerDocCollectionsRoutes(app, {
      getTenantFromRequest: (req: any) => {
        const value = req.header("x-test-tenant-id");
        return value && /^\d+$/.test(value) ? Number(value) : null;
      },
      upload: { single: () => (_req: any, _res: any, next: any) => next() },
      chunkUpload: { single: () => (_req: any, _res: any, next: any) => next() },
      chunkedUploads: uploads,
      UPLOADS_DIR: uploadsDir,
      validateUploadedFile: async () => true,
      extractTextFromFile: async (filePath: string) => readFileSync(filePath, "utf8"),
    }), async baseUrl => {
      for (const { id, url, fixture } of foreignTargets) {
        const response = await postJson(baseUrl, url, 3, { uploadId: id });
        assert.equal(response.status, 403, `${url} must reject a different tenant's upload`);
        assert.equal(uploads.get(id), fixture.state, "rejection must retain the exact in-flight state");
        assert.equal(fixture.state.assembling, undefined, "rejection must not enter assembly");
        assert.equal(readFileSync(fixture.chunkPath, "utf8"), `${id} payload`, "rejection must preserve chunk bytes");
        assert.equal(existsSync(fixture.assembledPath), false, "rejection must not create an assembled file");
      }
      assert.deepEqual(mutations, [], "foreign completions must not mutate collections or tenant storage");

      const foreignCollection = makeUpload("foreign-collection", 2, "owned collection payload");
      const response = await postJson(baseUrl, "/api/doc-collections/30/upload-chunked", 2, { uploadId: "foreign-collection" });
      assert.equal(response.status, 404, "tenant two cannot complete into tenant three's collection");
      assert.equal(uploads.get("foreign-collection"), foreignCollection.state);
      assert.equal(readFileSync(foreignCollection.chunkPath, "utf8"), "owned collection payload");
      assert.equal(foreignCollection.state.assembling, undefined, "destination ownership is checked before consuming upload chunks");
      assert.equal(mutations.length, 0);

      const own = makeUpload("own-knowledge", 2, "tenant two knowledge content");
      const success = await postJson(baseUrl, "/api/knowledge/upload-chunked", 2, { uploadId: "own-knowledge" });
      assert.equal(success.status, 200);
      assert.deepEqual(await success.json(), {
        success: true,
        entriesCreated: 1,
        fileName: "own-knowledge.txt",
        extractedLength: "tenant two knowledge content".length,
      });
      assert.equal(uploads.has("own-knowledge"), false, "successful completion consumes the upload state");
      assert.equal(existsSync(own.chunkPath), false, "successful assembly removes consumed chunk files");
      assert.equal(mutations.length, 1);
      assert.equal(mutations[0].kind, "knowledge");
      assert.equal(mutations[0].value.tenantId, 2, "created row uses the authenticated owner's tenant");

      const missingContext = await postJson(baseUrl, "/api/upload/init", undefined, {
        fileName: "denied.txt", fileSize: 1, totalChunks: 1,
      });
      assert.equal(missingContext.status, 401, "missing actor context is denied by the actual route");
      assert.equal(uploads.size, 4, "unauthenticated requests do not create upload state");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real research schedule routes reject foreign program links and preserve or clear omitted links", async () => {
  const programs = new Map([[301, 2], [303, 3]]);
  const schedules = new Map<number, any>([[90, { id: 90, tenant_id: 2, program_id: 301, name: "initial" }]]);
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const db = {
    async execute(query: any) {
      const rendered = dialect.sqlToQuery(query);
      statements.push(rendered);
      if (rendered.sql.includes("SELECT tenant_id FROM research_programs")) {
        const [programId, tenantId] = rendered.params as number[];
        return { rows: programs.get(programId) === tenantId ? [{ tenant_id: programs.get(programId) }] : [] };
      }
      if (rendered.sql.includes("INSERT INTO research_schedules")) {
        const row = {
          id: 91,
          tenant_id: rendered.params[0],
          program_id: rendered.params[1],
          name: rendered.params[2],
        };
        schedules.set(row.id, row);
        return { rows: [row] };
      }
      if (rendered.sql.includes("UPDATE research_schedules")) {
        const whereMatch = rendered.sql.match(/WHERE id = \$(\d+) AND tenant_id = \$(\d+)/);
        assert.ok(whereMatch, "schedule update is tenant scoped");
        const id = rendered.params[Number(whereMatch[1]) - 1];
        const tenantId = rendered.params[Number(whereMatch[2]) - 1];
        const row = schedules.get(Number(id));
        if (!row || row.tenant_id !== tenantId) return { rows: [] };
        const caseMatch = rendered.sql.match(/program_id = CASE WHEN \$(\d+) THEN \$(\d+) ELSE program_id END/);
        assert.ok(caseMatch, "update SQL expresses omitted-versus-explicit program link semantics");
        const programProvided = rendered.params[Number(caseMatch[1]) - 1];
        const proposedProgram = rendered.params[Number(caseMatch[2]) - 1];
        if (programProvided) row.program_id = proposedProgram;
        schedules.set(row.id, row);
        return { rows: [{ ...row }] };
      }
      throw new Error(`Unexpected research test query: ${rendered.sql}`);
    },
  };
  const routeModule = loadRouteModule(new URL("../../server/routes/research.ts", import.meta.url), {
    "../db": { db },
    "drizzle-orm": { sql },
    "zod": requireFromTest("zod"),
    "../lib/research-schedule": { validateScheduleProgramOwnership },
  });

  await withHttpApp(app => routeModule.registerResearchRoutes(app, {
    getTenantFromRequest: (req: any) => {
      const value = req.header("x-test-tenant-id");
      return value && /^\d+$/.test(value) ? Number(value) : null;
    },
    requirePlatformAdmin: () => true,
  }), async baseUrl => {
    const beforeForeign = statements.length;
    const foreignCreate = await postJson(baseUrl, "/api/research/schedules", 2, {
      name: "foreign link", cronExpression: "0 2 * * *", programId: 303,
    });
    assert.equal(foreignCreate.status, 400);
    assert.equal(statements.length, beforeForeign + 1, "foreign create performs only the tenant-scoped ownership lookup");
    assert.match(statements.at(-1)!.sql, /WHERE id = \$1 AND tenant_id = \$2/);
    assert.deepEqual(statements.at(-1)!.params, [303, 2]);

    const create = await postJson(baseUrl, "/api/research/schedules", 2, {
      name: "unlinked", cronExpression: "0 2 * * *",
    });
    assert.equal(create.status, 200);
    assert.equal(schedules.get(91)?.program_id, null, "omitted program on create creates an unlinked schedule");
    assert.match(statements.at(-1)!.sql, /INSERT INTO research_schedules/);

    const foreignUpdateBefore = statements.length;
    const foreignUpdate = await fetch(`${baseUrl}/api/research/schedules/90`, {
      method: "PUT",
      headers: { ...tenantHeaders(2), "content-type": "application/json" },
      body: JSON.stringify({ programId: 303 }),
    });
    assert.equal(foreignUpdate.status, 400);
    assert.equal(statements.length, foreignUpdateBefore + 1, "foreign update is rejected before UPDATE");
    assert.match(statements.at(-1)!.sql, /SELECT tenant_id FROM research_programs/);
    assert.equal(schedules.get(90)?.program_id, 301);

    const omit = await fetch(`${baseUrl}/api/research/schedules/90`, {
      method: "PUT",
      headers: { ...tenantHeaders(2), "content-type": "application/json" },
      body: JSON.stringify({ name: "preserve link" }),
    });
    assert.equal(omit.status, 200);
    assert.equal(schedules.get(90)?.program_id, 301, "omitted programId preserves an existing link");

    const unlink = await fetch(`${baseUrl}/api/research/schedules/90`, {
      method: "PUT",
      headers: { ...tenantHeaders(2), "content-type": "application/json" },
      body: JSON.stringify({ programId: null }),
    });
    assert.equal(unlink.status, 200);
    assert.equal(schedules.get(90)?.program_id, null, "explicit null is allowed to unlink a program");
  });
});