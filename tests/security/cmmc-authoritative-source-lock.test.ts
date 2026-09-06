import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
      authoritativeSourceLock: "cmmc_sam_discovery",
      skipApprovalGate: true,
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "cmmc_authoritative_source_lock");
  });
}

test("public chat propagates the server-derived CMMC authoritative source lock", () => {
  const source = fs.readFileSync("server/routes/public-chat.ts", "utf8");
  assert.match(source, /authoritativeSourceLock:\s*getCmmcAuthoritativeSourceLock\(/);
  assert.match(source, /buildRecentUserRoutingContext\(chatMessages\)/);
});

for (const [lock, allowedTool, blockedTools] of [
  ["cmmc_sam_exact", "lookup_sam_exact_company", ["lookup_sam_company_cage", "discover_cmmc_prospects", "introspect_tools"]],
  ["cmmc_sam_batch", "lookup_sam_company_cage", ["lookup_sam_exact_company", "discover_cmmc_prospects", "introspect_tools"]],
  ["cmmc_sam_discovery", "discover_cmmc_prospects", ["lookup_sam_exact_company", "lookup_sam_company_cage", "introspect_tools"]],
] as const) {
  for (const toolName of blockedTools) {
    test(`${lock} rejects alternate CMMC tool ${toolName}`, async () => {
      const result = await executeGuardedTool(toolName, {}, {
        tenantId: 1,
        invokedVia: "main_chat",
        authoritativeSourceLock: lock,
        skipApprovalGate: true,
      });
      assert.equal(result.blocked, true);
      assert.equal(result.reason, "cmmc_authoritative_source_lock");
      assert.match(result.error, new RegExp(allowedTool));
    });
  }
}