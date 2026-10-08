import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateScheduleProgramOwnership } from "../../server/lib/research-schedule";

test("schedule program links require the caller's tenant and allow explicit unlinking", async () => {
  const programTenants = new Map([[301, 17], [302, 23]]);
  const lookupTenantId = async (programId: number) => programTenants.get(programId) ?? null;

  assert.equal(await validateScheduleProgramOwnership(17, 301, lookupTenantId), true, "same-tenant program links remain valid");
  assert.equal(await validateScheduleProgramOwnership(17, 302, lookupTenantId), false, "foreign program links are rejected");
  assert.equal(await validateScheduleProgramOwnership(17, 999, lookupTenantId), false, "missing program links are rejected");
  assert.equal(await validateScheduleProgramOwnership(17, null, lookupTenantId), true, "explicit null unlinks a schedule");
  assert.equal(await validateScheduleProgramOwnership(null, 301, lookupTenantId), false, "missing tenant context fails closed");
});

test("research schedule queries scope joined programs and preserve omitted program links", () => {
  const source = readFileSync(new URL("../../server/routes/research.ts", import.meta.url), "utf8");
  const schedules = source.slice(source.indexOf('app.get("/api/research/schedules"'), source.indexOf('app.delete("/api/research/schedules/:id"'));
  assert.match(schedules, /LEFT JOIN research_programs rp ON rp\.id = rs\.program_id AND rp\.tenant_id = rs\.tenant_id/);
  assert.match(schedules, /program_id = CASE WHEN \$\{programId !== undefined\} THEN \$\{programId \?\? null\} ELSE program_id END/);
  const create = schedules.slice(schedules.indexOf('app.post("/api/research/schedules"'), schedules.indexOf('app.put("/api/research/schedules/:id"'));
  const update = schedules.slice(schedules.indexOf('app.put("/api/research/schedules/:id"'));
  assert.match(create, /validateScheduleProgramOwnership\(tenantId, programId/);
  assert.match(update, /validateScheduleProgramOwnership\(tenantId, programId/);
  assert.match(create, /SELECT tenant_id FROM research_programs WHERE id = \$\{id\} AND tenant_id = \$\{tenantId\}/);
  assert.match(update, /SELECT tenant_id FROM research_programs WHERE id = \$\{programId\} AND tenant_id = \$\{tenantId\}/);
});

test("scheduled session execution independently checks program tenant ownership", () => {
  const source = readFileSync(new URL("../../server/research-engine.ts", import.meta.url), "utf8");
  assert.match(source, /SELECT \* FROM research_programs WHERE id = \$\{programId\} AND tenant_id = \$\{tenantId\}/);
});