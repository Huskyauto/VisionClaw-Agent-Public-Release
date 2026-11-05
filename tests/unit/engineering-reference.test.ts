import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerEngineeringReferenceRoutes } from "../../server/routes/engineering-reference";
import { engineeringLibraryWriteSchema } from "../../shared/engineering-reference";
import { engineeringReferences } from "../../server/lib/engineering-reference-catalog";
import fs from "node:fs";
import { createCsrfMiddleware } from "../../server/validation";

test("engineering reference refuses non-owner before reading any library", async () => {
  const app = express();
  let reads = 0;
  registerEngineeringReferenceRoutes(app, {
    authMiddleware: (_req, _res, next) => next(),
    requirePlatformAdmin: (_req, res) => { res.status(403).json({ error: "Owner only" }); return false; },
    getTenantFromRequest: () => 42,
    store: {
      read: async () => { reads++; return { version: 0, notes: [] }; },
      write: async () => ({ kind: "conflict" }),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/engineering-reference`);
    assert.equal(response.status, 403);
    assert.equal(reads, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

const note = { id: "4adaef35-75a9-4b07-b6f0-c65ab1238989", question: "How do retries work?",
  answer: "Keep the same work identity.", category: "Production", sourceUrl: "" };

async function withApi(options: { owner?: boolean; authenticated?: boolean; tenant?: number | null } = {},
  run: (base: string, seen: number[]) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const seen: number[] = [];
  const libraries = new Map<number, { version: number; notes: unknown[] }>();
  registerEngineeringReferenceRoutes(app, {
    authMiddleware: (_req, res, next) => options.authenticated === false ? res.status(401).end() : next(),
    requirePlatformAdmin: (_req, res) => {
      if (options.owner === false) { res.status(403).end(); return false; }
      return true;
    },
    getTenantFromRequest: () => options.tenant === undefined ? 1 : options.tenant,
    store: {
      read: async tenant => { seen.push(tenant); return libraries.get(tenant) as any ?? { version: 0, notes: [] }; },
      write: async (tenant, input) => {
        seen.push(tenant);
        const current = libraries.get(tenant) ?? { version: 0, notes: [] };
        if (current.version !== input.version) return { kind: "conflict" };
        const next = { version: current.version + 1, notes: input.notes };
        libraries.set(tenant, next);
        return { kind: "saved", library: next };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/admin/engineering-reference`, seen); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test("anonymous and non-owner writes are rejected before storage", async () => {
  for (const options of [{ authenticated: false }, { owner: false }, { tenant: null }]) {
    await withApi(options, async (base, seen) => {
      for (const method of ["GET", "PUT"]) {
        const response = await fetch(base, { method, ...(method === "PUT" ? {
          headers: { "content-type": "application/json" }, body: JSON.stringify({ version: 0, notes: [note] }),
        } : {}) });
        assert.equal(response.status, options.owner === false ? 403 : 401);
      }
      assert.deepEqual(seen, []);
    });
  }
});

test("owner can create, read, update and delete; stale writes cannot overwrite", async () => {
  await withApi({}, async (base, seen) => {
    const put = (body: unknown) => fetch(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let response = await put({ version: 0, notes: [note] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, 1);
    response = await fetch(base);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal((await response.json()).notes[0].question, note.question);
    response = await put({ version: 1, notes: [{ ...note, answer: "Updated answer" }] });
    assert.equal(response.status, 200);
    response = await put({ version: 1, notes: [] });
    assert.equal(response.status, 409);
    response = await put({ version: 2, notes: [] });
    assert.equal(response.status, 200);
    assert.deepEqual((await (await fetch(base)).json()).notes, []);
    assert.ok(seen.every(tenant => tenant === 1));
    response = await put({ version: 3, notes: [], tenantId: 99 });
    assert.equal(response.status, 400);
    response = await put({ version: 3, notes: [{ ...note, relatedReferenceId: "nonexistent" }] });
    assert.equal(response.status, 400);
  });
});

test("note validation bounds input and refuses unsafe links, duplicate identities and trust fields", () => {
  const input = (notes: unknown[]) => ({ version: 0, notes });
  assert.ok(engineeringLibraryWriteSchema.safeParse(input([note])).success);
  for (const bad of [
    { ...note, sourceUrl: "javascript:alert(1)" },
    { ...note, sourceUrl: "https://user:password@example.com" },
    { ...note, question: " " }, { ...note, answer: "x".repeat(12001) },
    { ...note, verified: true }, { ...note, tenantId: 1 },
  ]) assert.equal(engineeringLibraryWriteSchema.safeParse(input([bad])).success, false);
  assert.equal(engineeringLibraryWriteSchema.safeParse(input([note, note])).success, false);
  assert.equal(engineeringLibraryWriteSchema.safeParse(input(Array.from({ length: 201 }, () => note))).success, false);
});

test("the shared CSRF guard refuses an engineering notebook write without a token", async () => {
  const req = { method: "PUT", path: "/api/admin/engineering-reference", headers: {} } as any;
  let status = 0;
  let continued = false;
  const res: any = {
    status(code: number) { status = code; return res; },
    json() { return res; },
    setHeader() {},
  };
  await createCsrfMiddleware(async () => 1)(req, res, () => { continued = true; });
  assert.equal(status, 403);
  assert.equal(continued, false);
});

test("curated comparisons have distinct IDs, primary sources, real evidence paths and explicit limitations", () => {
  assert.ok(engineeringReferences.length >= 15);
  assert.equal(new Set(engineeringReferences.map(entry => entry.id)).size, engineeringReferences.length);
  for (const entry of engineeringReferences) {
    assert.match(entry.sourceUrl, /^https:\/\/aiengineeringfromscratch\.com\/interviews\//);
    assert.ok(entry.answer.length > 100 && entry.nextCheck.length > 40);
    assert.ok(entry.evidence.length > 0);
    for (const evidence of entry.evidence) assert.ok(fs.existsSync(evidence.path), evidence.path);
  }
});

test("all notebook editing actions are disabled while save or explicit reload can replace editor state", () => {
  const page = fs.readFileSync("client/src/pages/admin-engineering-reference.tsx", "utf8");
  const fieldset = page.match(/<fieldset\s+disabled=\{saveLibrary\.isPending \|\| reloadPending\}[^>]*>([\s\S]*?)<\/fieldset>/);
  assert.ok(fieldset, "Pending save/reload must fence every editor and new-draft action, not only Submit");
  assert.match(fieldset[1], /<NoteForm/);
  assert.match(fieldset[1], /Add owner question/);
  assert.match(fieldset[1], /<NoteDetail/);
  assert.match(fieldset[1], /<ReferenceDetail/);
});
