import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { stampResolvedProjectToolContext } from "../../server/lib/trusted-project-context";
import { discoverCmmcProspectsHandler } from "../../server/tools/domains/cmmc-prospecting/handlers";

test("trusted project context overwrites caller project signals", () => {
  const args: Record<string, unknown> = {
    _projectId: 999,
    _projectDriveFolderId: "caller-folder",
  };

  stampResolvedProjectToolContext(args, {
    projectId: 372,
    driveFolderId: "tenant-owned-folder",
  });

  assert.equal(args._projectId, 372);
  assert.equal(args._projectDriveFolderId, "tenant-owned-folder");
});

test("missing or invalid resolved context stamps no project authority", () => {
  const args: Record<string, unknown> = {};
  stampResolvedProjectToolContext(args, null);
  stampResolvedProjectToolContext(args, { projectId: 0, driveFolderId: "folder" });
  assert.deepEqual(args, {});
});

test("both live chat execution loops stamp resolved project context before guarded dispatch", () => {
  for (const relativePath of ["server/chat-engine.ts", "server/routes.ts"]) {
    const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const stampIndex = source.lastIndexOf("stampResolvedProjectToolContext(parsedArgs, resolvedProjectToolContext)");
    const dispatchIndex = source.lastIndexOf("executeGuardedTool(");
    assert.ok(stampIndex >= 0, `${relativePath} must stamp the tenant-resolved project`);
    assert.ok(dispatchIndex > stampIndex, `${relativePath} must stamp project context before guarded dispatch`);
  }
});

test("main chat carries a same-turn auto-created project into guarded tool dispatch", () => {
  const source = readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const autoCreateIndex = source.indexOf("resolvedProjectToolContext = {", source.indexOf("checkAndAutoCreateProject"));
  const creatorOnlyIndex = source.indexOf("if (autoProj?.created && autoProj.directive)");
  const stampIndex = source.lastIndexOf("stampResolvedProjectToolContext(parsedArgs, resolvedProjectToolContext)");
  const dispatchIndex = source.lastIndexOf("executeGuardedTool(");
  assert.ok(autoCreateIndex >= 0, "auto-created project must refresh trusted tool context in the same turn");
  assert.ok(creatorOnlyIndex > autoCreateIndex, "all concurrent callers must receive context before creator-only notification logic");
  assert.ok(stampIndex > autoCreateIndex, "same-turn project refresh must occur before project stamping");
  assert.ok(dispatchIndex > stampIndex, "refreshed project context must be stamped before guarded dispatch");
});

test("CMMC refuses an unlinked deliver:false call before any SAM request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("SAM must not be called without validated project context");
  }) as typeof fetch;
  try {
    const result = await discoverCmmcProspectsHandler(
      { deliver: false, query: "CMMC", states: ["IL"] },
      { tenantId: 1 },
    );
    assert.match(String(result.error), /active project is required/i);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auto-project creation serializes the final conversation assignment", () => {
  const source = readFileSync(path.join(process.cwd(), "server/auto-project.ts"), "utf8");
  const transactionIndex = source.indexOf("db.transaction(async (tx)");
  const lockIndex = source.indexOf("pg_advisory_xact_lock", transactionIndex);
  const conversationReadIndex = source.indexOf("SELECT project_id, title FROM conversations", transactionIndex);
  const createIndex = source.indexOf("INSERT INTO projects", transactionIndex);
  assert.ok(transactionIndex >= 0, "auto-project decision and creation must share a transaction");
  assert.ok(lockIndex > transactionIndex, "auto-project transaction must acquire a conversation-scoped lock");
  assert.ok(conversationReadIndex > lockIndex, "conversation assignment must be read after acquiring the lock");
  assert.ok(createIndex > conversationReadIndex, "project creation must occur only after the locked assignment check");
  assert.match(
    source.slice(conversationReadIndex, createIndex),
    /\{ created: false, projectId: Number\(ownedRows\[0\]\.id\) \}/,
    "a concurrent loser must return the winner's tenant-owned project ID",
  );
});