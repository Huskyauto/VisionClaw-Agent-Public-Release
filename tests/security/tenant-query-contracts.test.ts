import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mindsEngine = fs.readFileSync(path.resolve("server/minds-engine.ts"), "utf8");
const minervaPlanner = fs.readFileSync(path.resolve("server/minerva-planner.ts"), "utf8");
const processGovernor = fs.readFileSync(path.resolve("server/process-governor.ts"), "utf8");

function functionBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(nextName, start);
  assert.ok(start >= 0 && end > start, `${name} function boundaries must remain discoverable`);
  return source.slice(start, end);
}

test("mind tickets bind depends_on as JSONB, including an empty default", () => {
  const createTicket = functionBody(mindsEngine, "createTicket", "export async function listTickets");
  assert.match(
    createTicket,
    /\$\{JSON\.stringify\(params\.dependsOn \|\| \[\]\)\}::jsonb/,
    "depends_on must receive a valid JSON array rather than PostgreSQL array syntax",
  );
});

test("Minerva plan reads require and bind their tenant scope", () => {
  const getPlan = functionBody(minervaPlanner, "getPlan", "export const MINERVA");
  assert.match(
    getPlan,
    /export async function getPlan\(planId: number, tenantId: number\)/,
    "getPlan must require a tenantId",
  );
  assert.match(
    getPlan,
    /SELECT \* FROM plans WHERE id = \$\{planId\} AND tenant_id = \$\{tenantId\}/,
    "every getPlan query must bind both the plan and tenant IDs",
  );
  assert.doesNotMatch(getPlan, /SELECT \* FROM plans WHERE id = \$\{planId\}(?! AND tenant_id)/);
});

test("Governor heartbeat aggregates exclude orphan and foreign-tenant logs", () => {
  for (const check of ["response_time", "cascading_failures"]) {
    const start = processGovernor.indexOf(`case "${check}":`);
    const end = processGovernor.indexOf("\n      case ", start + 1);
    assert.ok(start >= 0 && end > start, `${check} condition boundaries must remain discoverable`);
    const condition = processGovernor.slice(start, end);
    assert.match(
      condition,
      /FROM heartbeat_logs hl\s+JOIN heartbeat_tasks ht ON ht\.id = hl\.task_id\s+WHERE ht\.tenant_id = \$\{tenantId\}/,
      `${check} must scope heartbeat logs through their owning tenant task`,
    );
  }
});