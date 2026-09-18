import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test, { after } from "node:test";
import {
  clearAllSessionsAsPlatformAdmin,
  clearSessionsForTenant,
  recordGlobalSessionResetAuditNonFatal,
} from "../../server/auth";
import { listPlans } from "../../server/minerva-planner";
import { runCatalogSync } from "../../server/model-catalog";

after(() => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("session clearing is tenant scoped unless a runtime platform capability is consumed", () => {
  const auth = read("server/auth.ts");
  const route = read("server/routes/platform-config.ts");

  assert.doesNotMatch(auth, /export async function clearAllSessions\(\)/);
  assert.match(auth, /clearSessionsForTenant\(tenantId: number\)/);
  assert.match(auth, /DELETE FROM auth_sessions WHERE tenant_id = \$\{tenantId\}/);
  assert.match(auth, /globalSessionResetAuthorities\.delete\(authority\)/);
  assert.match(auth, /if \(!requirePlatformAdmin\(req, res\)\) return null/);
  assert.match(auth, /'security\.sessions\.cleared'/);
  assert.match(route, /authorizePlatformAdminSessionReset\(/);
  assert.match(route, /clearAllSessionsAsPlatformAdmin\(resetAuthority\)/);
});

test("Minerva plan listing requires a positive explicit tenant", () => {
  const source = read("server/minerva-planner.ts");

  assert.match(source, /listPlans\(args: \{ tenantId: number;/);
  assert.match(source, /Number\.isInteger\(args\.tenantId\).*args\.tenantId <= 0/s);
  assert.doesNotMatch(source, /const tenantId = args\.tenantId \?\? 1/);
});

test("catalog sync requires a positive tenant and owner scheduler passes admin explicitly", () => {
  const catalog = read("server/model-catalog.ts");
  const heartbeat = read("server/heartbeat.ts");

  assert.match(catalog, /interface RunCatalogSyncOptions \{\s+tenantId: number;/);
  assert.match(catalog, /runCatalogSync\(opts: RunCatalogSyncOptions\)/);
  assert.match(catalog, /Number\.isInteger\(opts\?\.tenantId\).*opts\.tenantId <= 0/s);
  assert.doesNotMatch(catalog, /opts\.tenantId \?\? 1/);
  assert.match(heartbeat, /runCatalogSync\(\{\s+[\s\S]*?tenantId: ADMIN_TENANT_ID,/);
});

test("tenant-bound functions reject missing, zero, and negative tenant ids before I/O", async () => {
  for (const tenantId of [undefined, 0, -1]) {
    await assert.rejects(
      listPlans({ tenantId } as any),
      /listPlans requires a positive tenantId/,
    );
    await assert.rejects(
      runCatalogSync({ tenantId } as any),
      /runCatalogSync requires a positive tenantId/,
    );
    await assert.rejects(
      clearSessionsForTenant(tenantId as any),
      /clearSessionsForTenant requires a positive tenantId/,
    );
  }
});

test("global session reset rejects a forged or missing platform capability before I/O", async () => {
  await assert.rejects(
    clearAllSessionsAsPlatformAdmin(undefined as any),
    /Platform-admin session-reset authority required/,
  );
  await assert.rejects(
    clearAllSessionsAsPlatformAdmin({
      kind: "platform-admin-session-reset",
      actorTenantId: 1,
      reason: "forged",
    }),
    /Platform-admin session-reset authority required/,
  );
});

test("post-reset audit failure is loud but cannot reverse successful revocation", async () => {
  const sentinel = new Error("audit sink unavailable");
  const reports: Array<[string, unknown]> = [];

  await assert.doesNotReject(
    recordGlobalSessionResetAuditNonFatal(
      {
        kind: "platform-admin-session-reset",
        actorTenantId: 1,
        reason: "PIN rotation",
      },
      async () => {
        throw sentinel;
      },
      (message, error) => reports.push([message, error]),
    ),
  );

  assert.equal(reports.length, 1);
  assert.match(reports[0][0], /reset completed.*audit persistence failed/i);
  assert.equal(reports[0][1], sentinel);
});