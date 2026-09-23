import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomToolArgsSetup } from "../../server/lib/custom-tool-args";

test("custom-tool argument setup treats hostile keys as data, not executable source", () => {
  const source = buildCustomToolArgsSetup({
    normal: 1,
    'x; globalThis.__injected = true; //': 2,
    "hyphen-key": 3,
    _tenantId: 99,
  });

  assert.ok(source.includes('args["normal"] = 1;'));
  assert.ok(source.includes('args["x; globalThis.__injected = true; //"] = 2;'));
  assert.ok(source.includes('args["hyphen-key"] = 3;'));
  assert.doesNotMatch(source, /args\._tenantId/);
  assert.doesNotMatch(source, /args\.x;/);
});