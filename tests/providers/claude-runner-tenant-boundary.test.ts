import assert from "node:assert/strict";
import test from "node:test";

import { getClientForModel } from "../../server/providers";

test("non-owner tenants cannot pin requests to the Claude subscription runner", async () => {
  await assert.rejects(
    () => getClientForModel("claude-opus-5", 2, { providerLane: "claude-runner" }),
    /owner-only subscription lane "claude-runner" denied for tenant 2/,
  );
});