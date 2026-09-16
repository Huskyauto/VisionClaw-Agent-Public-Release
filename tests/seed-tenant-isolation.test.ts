/**
 * Boot-seed tenant-isolation contracts.
 *
 * project_conversations has no tenant_id of its own, so its backfill must
 * enforce the tenant boundary through both parent tables.  The platform
 * briefing update must retain the same tenant scope as its lookup.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const seedSource = readFileSync(join(process.cwd(), "server/seed.ts"), "utf8");

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = seedSource.indexOf(startMarker);
  assert.notEqual(start, -1, `missing seed source marker: ${startMarker}`);
  const end = seedSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing seed source marker: ${endMarker}`);
  return seedSource.slice(start, end);
}

test("conversation/project boot backfill joins only equal-tenant records", () => {
  const backfill = sectionBetween(
    "SELECT DISTINCT c.id, c.project_id",
    "const rows = (unlinked as any).rows || unlinked;",
  );

  assert.match(backfill, /FROM conversations c/);
  assert.match(backfill, /JOIN projects p/);
  assert.match(
    backfill,
    /p\.id\s*=\s*c\.project_id[\s\S]*p\.tenant_id\s*=\s*c\.tenant_id/,
    "backfill must require the project and conversation tenant IDs to match",
  );
  assert.match(backfill, /NOT EXISTS\s*\([\s\S]*FROM project_conversations pc/);
});

test("platform briefing agent_knowledge update retains its tenant predicate", () => {
  const briefing = sectionBetween(
    "UPDATE agent_knowledge SET content =",
    "console.log(`[seed] Updated platform briefing knowledge",
  );

  assert.match(
    briefing,
    /WHERE id = \$\{rows\[0\]\.id\}\s+AND tenant_id = 1/,
    "agent_knowledge UPDATE must remain scoped to the selected tenant",
  );
});