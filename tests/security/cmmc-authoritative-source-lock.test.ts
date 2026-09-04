import test from "node:test";
import assert from "node:assert/strict";
import { executeGuardedTool } from "../../server/guarded-tool-executor.js";

for (const toolName of [
  "browser",
  "stealth_browse",
  "stealth_browse_camofox",
  "web_search",
  "web_fetch",
  "deep_research",
  "delegate_task",
]) {
  test(`guarded execution rejects ${toolName} under the CMMC SAM source lock`, async () => {
    const result = await executeGuardedTool(toolName, {}, {
      tenantId: 1,
      invokedVia: "main_chat",
      authoritativeSourceLock: "cmmc_sam",
      skipApprovalGate: true,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "cmmc_authoritative_source_lock");
  });
}