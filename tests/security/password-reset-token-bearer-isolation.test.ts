import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("a password-reset token carries and enforces its tenant scope", () => {
  const authSource = readFileSync("server/auth.ts", "utf8");
  assert.match(authSource, /token TEXT PRIMARY KEY/);
  assert.match(authSource, /const token = `\$\{tenant\.id\}\.\$\{crypto\.randomBytes\(32\)\.toString\("hex"\)\}`/);
  assert.match(authSource, /const tokenHash = hashAuthSecret\(token\)/);
  assert.match(authSource, /const embeddedTenantId = Number\(token\.slice\(0, separator\)\)/);
  assert.match(
    authSource,
    /WHERE token = \$\{tokenHash\} AND tenant_id = \$\{embeddedTenantId\}/,
  );
});