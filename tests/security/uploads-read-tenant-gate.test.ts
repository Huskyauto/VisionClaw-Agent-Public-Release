/**
 * CI guard — readFileHandler's uploads tenant-ownership gate must stay
 * fail-closed and must never re-grow the originalName authorization bypass.
 *
 * Why: uploads/ and /tmp/uploads are SHARED flat directories across tenants.
 * The 2026-07-08 post-edit review closed a HIGH (any tenant could enumerate/
 * read other tenants' uploads); the architect's second pass then caught that
 * authorizing by `originalName` (user-controlled metadata) re-opened a
 * cross-tenant bypass — a tenant can name their own upload after another
 * tenant's on-disk basename. Authorization must bind to the canonical stored
 * `filename` + `tenantId` only.
 *
 * Static text scan only — no DB pool, no server/tools.ts import
 * (node-test-db-pool-hang rule).
 */
import { test } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HANDLERS = path.resolve(__dirname, "../../server/tools/domains/files/handlers.ts");

function uploadsGateBlock(src: string): string {
  // Anchor on the gate's distinctive marker comment, end at the symlink
  // rejection section that follows it.
  const start = src.indexOf("TENANT ISOLATION — uploads/");
  assert.ok(start >= 0, "uploads tenant-isolation gate marker comment not found — gate removed or reworded; re-verify the read_file authorization before updating this test");
  const end = src.indexOf("symlink rejection for read_file", start);
  assert.ok(end > start, "symlink-rejection anchor after the gate not found");
  return src.slice(start, end);
}

test("uploads ownership predicate binds to canonical filename + tenantId only (no originalName)", () => {
  const src = fs.readFileSync(HANDLERS, "utf-8");
  const gate = uploadsGateBlock(src);

  // Strip line comments so the explanatory comment documenting WHY
  // originalName is banned doesn't trip the ban itself.
  const gateCode = gate.replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/originalName/.test(gateCode),
    "uploads ownership gate references fileStorage.originalName in code — user-controlled metadata must NOT satisfy filesystem read authorization (cross-tenant bypass, architect finding 2026-07-08)",
  );
  assert.ok(
    /eq\(fileStorage\.filename,\s*uploadBasename\)/.test(gate),
    "gate no longer matches on canonical fileStorage.filename",
  );
  assert.ok(
    /eq\(fileStorage\.tenantId,\s*ctx\.tenantId\)/.test(gate),
    "gate no longer scopes ownership to ctx.tenantId",
  );
});

test("gate fails closed: missing tenant context and DB errors both deny", () => {
  const src = fs.readFileSync(HANDLERS, "utf-8");
  const gate = uploadsGateBlock(src);

  assert.ok(
    /uploaded files require tenant context/.test(gate),
    "missing-tenant deny branch removed from the uploads gate",
  );
  assert.ok(
    /could not verify tenant ownership/.test(gate),
    "DB-error fail-closed deny branch removed from the uploads gate",
  );
  assert.ok(
    /\/tmp\/uploads/.test(gate),
    "/tmp/uploads root no longer covered by the uploads gate",
  );
});

test("realpath policy allows only workspace and /tmp/uploads, after symlink rejection", () => {
  const src = fs.readFileSync(HANDLERS, "utf-8");
  const symlinkIdx = src.indexOf("isSymbolicLink()");
  const realpathIdx = src.indexOf('realPath.startsWith("/home/runner/workspace")');
  assert.ok(symlinkIdx >= 0 && realpathIdx >= 0, "symlink/realpath guards not found");
  assert.ok(symlinkIdx < realpathIdx, "symlink rejection must precede the realpath allowlist");
  assert.ok(
    /realPath\.startsWith\("\/tmp\/uploads" \+ path\.sep\)/.test(src),
    "/tmp/uploads realpath allowance missing — declared search root would be un-readable again",
  );
});
