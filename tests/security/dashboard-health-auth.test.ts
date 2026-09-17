import assert from "node:assert/strict";
import test from "node:test";

import { isPublicPath } from "../../server/auth";

test("the dashboard health report requires session authentication", () => {
  assert.equal(isPublicPath("/api/health"), false);
});