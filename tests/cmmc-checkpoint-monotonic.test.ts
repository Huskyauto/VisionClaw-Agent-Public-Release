import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("CMMC checkpoint upsert cannot regress to more pending states", () => {
  const source = readFileSync("server/lib/cmmc-prospecting.ts", "utf8");
  const upsert = source.slice(source.indexOf("ON CONFLICT (tenant_id, filename)"), source.indexOf("RETURNING filename, size, data"));
  assert.match(upsert, /jsonb_array_length/);
  assert.match(upsert, /file_storage\.data/);
  assert.match(upsert, /EXCLUDED\.data/);
  assert.match(upsert, />=/);
});

test("CMMC discovery uses a durable tenant-project lease without holding a transaction", () => {
  const library = readFileSync("server/lib/cmmc-prospecting.ts", "utf8");
  const handler = readFileSync("server/tools/domains/cmmc-prospecting/handlers.ts", "utf8");
  assert.match(library, /ON CONFLICT \(tenant_id, filename\)[\s\S]*expiresAt/);
  assert.match(library, /DELETE FROM file_storage fs[\s\S]*p\.tenant_id[\s\S]*owner/);
  assert.match(handler, /acquireCmmcProspectLease[\s\S]*loadCmmcProspectCheckpoint[\s\S]*persistCmmcProspectCheckpoint[\s\S]*releaseCmmcProspectLease/);
  assert.doesNotMatch(handler.slice(handler.indexOf("const checkpointContext"), handler.indexOf("let deliveries")), /db\.transaction/);
});