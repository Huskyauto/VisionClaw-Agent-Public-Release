import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("Drive project folder lookup binds project ID to the caller tenant", () => {
  const source = read("server/google-drive.ts");
  assert.match(
    source,
    /and\(eq\(projects\.id, params\.projectId\), eq\(projects\.tenantId, params\.tenantId\)\)/,
  );
});

test("inbox classification route update retains its direct tenant predicate", () => {
  const source = read("server/lib/inbox-ingest.ts");
  assert.match(
    source,
    /UPDATE inbox_classifications SET routed_to = \$\{JSON\.stringify\(routedTo\)\}::jsonb\s+WHERE inbox_message_id = \$\{storeResult\.id\} AND tenant_id = \$\{tenantId\}/,
  );
});

test("presenter image repair binds every child read and write to the selected session tenant", () => {
  const source = read("server/routes.ts");
  const repair = source.slice(
    source.indexOf('app.post("/api/presenter/:token/repair-images"'),
    source.indexOf('app.get("/api/store/catalog"'),
  );

  assert.match(repair, /SELECT id, tenant_id, presentation_id, slides FROM presenter_sessions/);
  assert.equal(
    [...repair.matchAll(/INNER JOIN presenter_sessions s ON s\.id = i\.session_id/g)].length,
    1,
    "the repair child read must resolve ownership through its parent session",
  );
  assert.match(repair, /INNER JOIN presenter_sessions s ON s\.id = i\.session_id[\s\S]*?s\.tenant_id = \$\{sessionTenantId\}/);
  assert.equal(
    [...repair.matchAll(/INSERT INTO presenter_slide_images/g)].length,
    2,
    "repair must retain both full and thumbnail writes",
  );
  assert.equal(
    [...repair.matchAll(/WHERE s\.id = \$\{sessionId\} AND s\.tenant_id = \$\{sessionTenantId\}/g)].length,
    2,
    "each child insert must be sourced from the tenant-owned presenter session",
  );
  assert.equal(
    [...repair.matchAll(/WHERE owner\.id = presenter_slide_images\.session_id\s+AND owner\.tenant_id = \$\{sessionTenantId\}/g)].length,
    2,
    "each child conflict update must independently retain parent ownership",
  );
  assert.equal(
    [...repair.matchAll(/UPDATE presenter_sessions SET slides/g)].length,
    1,
    "repair must have exactly one parent-session mutation",
  );
  assert.match(repair, /UPDATE presenter_sessions SET slides[\s\S]*?WHERE id = \$\{sessionId\} AND tenant_id = \$\{sessionTenantId\}/);
  assert.doesNotMatch(repair, /UPDATE presenter_slide_images/);
});

test("presenter slide reads bind the token-selected session tenant", () => {
  const source = read("server/routes.ts");
  const slide = source.slice(
    source.indexOf('app.get("/api/presenter/:token/slide/:index"'),
    source.indexOf('app.post("/api/presenter/:token/tts"'),
  );

  assert.match(slide, /SELECT id, tenant_id FROM presenter_sessions WHERE token = \$\{token\}/);
  assert.equal(
    [...slide.matchAll(/INNER JOIN presenter_sessions s ON s\.id = i\.session_id/g)].length,
    2,
  );
  assert.equal(
    [...slide.matchAll(/s\.tenant_id = \$\{sessionTenantId\}/g)].length,
    2,
  );
});

test("owner heartbeat seed reconciliation cannot inspect customer tasks", () => {
  const source = read("server/seed.ts");
  const heartbeatSeed = source.slice(
    source.indexOf("const existingHeartbeats"),
    source.indexOf("const existingTemplates"),
  );
  assert.match(source, /import \{ ADMIN_TENANT_ID \} from "\.\/tenant-constants"/);
  assert.match(
    heartbeatSeed,
    /const existingHeartbeats = await db\.select\(\)\.from\(heartbeatTasks\)\s+\.where\(eq\(heartbeatTasks\.tenantId, ADMIN_TENANT_ID\)\)/,
  );
  assert.doesNotMatch(heartbeatSeed, /tenantId:\s*1\b/);
});