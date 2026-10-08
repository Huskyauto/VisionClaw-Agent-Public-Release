import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalMemoryValue,
  canonicalMemoryValues,
  memoryValueDigest,
} from "../../server/memory/tombstones";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../../migrations/0099_unified_memory_forgetting.sql"),
  "utf8",
);

test("0099 installs fail-closed, tenant-bound tombstone triggers for every memory table", () => {
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pgcrypto/i);
  assert.match(migration, /SECURITY INVOKER/i);
  assert.match(
    migration,
    /NULLIF\(current_setting\('app\.memory_tombstone_hmac_key', true\), ''\)/,
  );
  assert.match(migration, /RAISE EXCEPTION 'memory tombstone enforcement is unavailable'/);
  assert.match(migration, /hashtextextended\(digest_value, 0::bigint\)/);
  for (const table of [
    "memory_entries",
    "conversation_facts",
    "agent_knowledge",
    "compaction_archives",
    "graph_memory",
    "knowledge_triples",
    "knowledge_nudges",
    "messages",
    "graph_memory_links",
    "memory_links",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON ${table}`,
      ),
      table,
    );
  }
});

test("canonicalization is ASCII-whitespace-only and preserves NBSP", () => {
  assert.equal(
    canonicalMemoryValue([" \talpha\n\r\f\u000b beta "]),
    "alpha beta",
  );
  assert.equal(canonicalMemoryValue(["\u00a0alpha\u00a0"]), "\u00a0alpha\u00a0");
  assert.deepEqual(
    canonicalMemoryValues([" title ", "", " body "]),
    ["title\u001f\u001fbody", "title", "body"],
  );
});

test("relationship trigger vectors use exact field arity", () => {
  assert.match(
    migration,
    /parts := ARRAY\[row_data->>'source_path', row_data->>'target_path',\s*row_data->>'link_type'\]/,
  );
  assert.match(
    migration,
    /parts := ARRAY\[row_data->>'source_memory_id', row_data->>'target_memory_id',\s*row_data->>'link_type'\]/,
  );
  assert.match(migration, /memory link endpoints must belong to the same tenant/);
  assert.doesNotMatch(migration, /regexp_replace\(coalesce\(parts\[i\], ''\), '\\s\+'/);
});

test("tombstone digest is tenant-bound but source-independent", () => {
  const key = "boundary-test-key";
  const canonical = "  erased   content ";
  assert.equal(
    memoryValueDigest(7, "memory_entries", canonical, key),
    memoryValueDigest(7, "messages", canonical, key),
  );
  assert.notEqual(
    memoryValueDigest(7, "memory_entries", canonical, key),
    memoryValueDigest(8, "memory_entries", canonical, key),
  );
});