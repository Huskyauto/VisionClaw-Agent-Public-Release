import test from "node:test";
import assert from "node:assert/strict";
import { shouldPreserveOverdueRunAtStartup } from "../../server/heartbeat-startup";

test("development IdeaBrowser sync remains due across a restart so the missed daily update runs", () => {
  assert.equal(shouldPreserveOverdueRunAtStartup("ideabrowser_dev_sync", false), true);
  assert.equal(shouldPreserveOverdueRunAtStartup("ideabrowser_dev_sync", true), false);
  assert.equal(shouldPreserveOverdueRunAtStartup("ideabrowser_ingest", true), true);
  assert.equal(shouldPreserveOverdueRunAtStartup("ideabrowser_ingest", false), false);
  assert.equal(shouldPreserveOverdueRunAtStartup("reflection", false), false);
});