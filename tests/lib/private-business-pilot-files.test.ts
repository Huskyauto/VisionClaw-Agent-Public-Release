import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { tenantFileAccessFilter, BUSINESS_PILOT_FILE_PREFIX, denyPrivatePilotUpload } from "../../server/lib/private-business-pilot-files";
import { readFileSync } from "node:fs";
import express from "express";
test("ordinary file access is both tenant-bound and excludes private pilot archives", () => {
  const query = new PgDialect().sqlToQuery(tenantFileAccessFilter(7)!);
  assert.deepEqual(query.params, [7, `${BUSINESS_PILOT_FILE_PREFIX}%`, "\\_\\_admin-company-package-%"]);
  assert.match(query.sql, /tenant_id.*=.*and.*filename.*not like/i);
});
test("all four ordinary file list/read/delete predicates use the private-state exclusion", () => {
  const source = readFileSync(new URL("../../server/routes/tenants.ts", import.meta.url), "utf8");
  const fileRoutes = source.slice(source.indexOf("export function registerTenantFilesRoutes"),
    source.indexOf("export function registerTemplatesRoutes"));
  assert.equal((fileRoutes.match(/tenantFileAccessFilter\(tenantId\)/g) || []).length, 4);
});
test("uploads deny private archives to ordinary tenant-one sessions before DB or static fallback", async () => {
  const app = express();
  let downstreamReads = 0;
  app.use("/uploads", denyPrivatePilotUpload);
  app.get("/uploads/:filename", (_req, res) => { downstreamReads++; res.json({ data: "private fixture" }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/uploads/`;
  try {
    for (const name of [`${BUSINESS_PILOT_FILE_PREFIX}health.json`, "local-state-business-pilot-release.json",
      "%6cocal-state-business-pilot-governance.json", `${BUSINESS_PILOT_FILE_PREFIX}cost.json?download=1`,
      "__admin-company-package-123-full.pdf", "__admin-company-package-123-teaser.pdf",
      "%5f%5fadmin-company-package-123-full.pdf"]) {
      const response = await fetch(base + name, { headers: { Authorization: "Bearer ordinary-tenant-one-fixture" } });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "File not found" });
    }
    assert.equal(downstreamReads, 0);
    assert.equal((await fetch(base + "ordinary.json")).status, 200);
    assert.equal(downstreamReads, 1);
    const source = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
    assert.ok(source.indexOf('app.use("/uploads", denyPrivatePilotUpload)') <
      source.indexOf('app.get("/uploads/:filename"'));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("package privacy also fences generic download and agent recovery before file lookup", () => {
  const routes = readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
  const files = readFileSync(new URL("../../server/tools/domains/files/handlers.ts", import.meta.url), "utf8");
  assert.match(files, /if \(isPrivateOwnerApplicationFile\(basenameLower\)\)/);
  assert.match(routes, /if \(isPrivateOwnerApplicationFile\(filename\)\)/);
  const producer = readFileSync(new URL("../../server/lib/company-report-package.ts", import.meta.url), "utf8");
  assert.match(producer, /COMPANY_REPORT_PACKAGE_FILE_PREFIX/);
});
