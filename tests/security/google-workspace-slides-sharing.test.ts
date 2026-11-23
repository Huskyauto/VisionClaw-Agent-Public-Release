import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync("server/google-workspace.ts", "utf8");
const slides = source.slice(source.indexOf("export async function slidesCreate"));

test("native Slides checks the tenant before fallback sharing and before public artifact delivery", () => {
  const firstPermission = slides.indexOf("/permissions");
  const ownerOnlyFallback = slides.indexOf("if (platformDelivery) {");
  assert.ok(ownerOnlyFallback >= 0 && ownerOnlyFallback < firstPermission);
  assert.match(slides.slice(ownerOnlyFallback, slides.indexOf("const slidesUrl")), /permissions[\s\S]*type: "anyone"/);

  const tenantOnlyReturn = slides.indexOf("if (!platformDelivery) {");
  assert.ok(tenantOnlyReturn > firstPermission);
  for (const operation of ["const shareResp", "makeFileShareable", "publishedOutsideDomain", "const { uploadAndShare }", "\"presenter-slides\""]) {
    assert.ok(slides.indexOf(operation) > tenantOnlyReturn, operation);
  }
  assert.match(slides.slice(tenantOnlyReturn, slides.indexOf("const shareResp")),
    /return \{[\s\S]*access: "google-account-required"/);
  assert.match(source, /import \{ ADMIN_TENANT_ID \} from "\.\/tenant-constants"/);
  assert.match(slides, /const platformDelivery = tenantId === ADMIN_TENANT_ID && isPlatformGoogleConnectorTenant\(tenantId\)/);
});
