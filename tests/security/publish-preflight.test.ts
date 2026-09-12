import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/publish-preflight.ts", "utf8");

test("publish preflight is deterministic and does not depend on the whole-repo audit", () => {
  assert.match(source, /FK_PARENT_KEY_QUERY/);
  assert.match(source, /parent_key\.contype IN \('p', 'u'\)/);
  assert.match(source, /parent_key\.conkey = fk\.confkey/);
  assert.match(source, /NOT EXISTS/);
  assert.match(source, /REVIEWED_LEGACY_PARENT_INDEX_KEYS/);
  assert.match(source, /changed or new shapes still block/);
  assert.match(source, /newParentIndexRisks\.length > 0/);
  assert.doesNotMatch(source, /computeTenantAuditEvidenceHash/);
  assert.doesNotMatch(source, /subagent|gpt-|anthropic|openai/i);
});

test("publish preflight fails closed when catalog inspection cannot complete", () => {
  assert.match(source, /DATABASE_URL is missing/);
  assert.match(source, /database inspection failed/);
  assert.match(source, /statement_timeout: 5000/);
  assert.match(source, /options: "-c lock_timeout=1000ms"/);
  assert.match(source, /query_timeout: 6000/);
  assert.match(source, /INSPECTION_TIMEOUT_MS = 8000/);
  assert.match(source, /Promise\.race\(\[inspection, timeout\]\)/);
  assert.match(source, /process\.exitCode = 1/);
});