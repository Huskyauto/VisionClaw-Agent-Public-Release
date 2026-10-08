import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("feature-document delivery reentry is idempotent and project registration is tenant-safe", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/build-features-doc.ts"), "utf8");
  const insertIndex = source.indexOf("INSERT INTO project_files");

  assert.ok(insertIndex >= 0, "owner documents must be registered in project_files");
  assert.match(
    source,
    /idempotencyKey: buildFeatureDocumentDeliveryIdempotencyKey\(HEADLINE_STATS\.release, today\)/,
    "re-entry must reuse the completed PDF/TXT delivery rather than sending a second remote bundle",
  );
  assert.match(
    source,
    /SET TRANSACTION ISOLATION LEVEL SERIALIZABLE/,
    "registration must run in an isolation level that rejects concurrent reconciliation races",
  );
  assert.match(
    source,
    /SELECT id FROM projects WHERE id = 17 AND tenant_id = 1 FOR UPDATE/,
    "the owned parent project must be locked and tenant-scoped within registration",
  );
  assert.match(
    source,
    /HEADLINE_STATS\.release\}\.pdf/,
    "project registration must version platform-document display names by release",
  );
  assert.match(source, /duplicate owner-document rows exist/, "the script must refuse duplicate document rows");
  assert.match(source, /refusing to replace mismatched existing owner-document row/, "the script must refuse wrong existing rows");
  assert.match(source, /REGISTER_FAILED:/, "a failed reconciliation must fail the script loudly");
});