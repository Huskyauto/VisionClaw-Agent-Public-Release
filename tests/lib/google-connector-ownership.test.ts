import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformGoogleConnectorTenant } from "../../server/lib/google-connector-ownership";

test("the shared Google connector belongs only to the explicitly configured admin tenant", () => {
  assert.equal(isPlatformGoogleConnectorTenant(1, undefined), true);
  assert.equal(isPlatformGoogleConnectorTenant(2, undefined), false);
  assert.equal(isPlatformGoogleConnectorTenant(7, "7"), true);
  assert.equal(isPlatformGoogleConnectorTenant(1, "7"), false);
  for (const tenant of [null, undefined, "7", 0, -1, 7.1, NaN]) {
    assert.equal(isPlatformGoogleConnectorTenant(tenant, "7"), false);
  }
  for (const config of ["bad", "0", "-1", "1.2", "1e0", "9007199254740992"]) {
    assert.equal(isPlatformGoogleConnectorTenant(1, config), false);
  }
});