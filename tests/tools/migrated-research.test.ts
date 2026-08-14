/**
 * Tools-layer-split — research domain seam test. Verifies the 8 migrated
 * research-cluster tools (deep_research, parallel_research, research_digest,
 * recursive_synthesize, trend_research, findings_publish, findings_read,
 * ingest_paper) are registered by the dispatcher import and resolvable via the
 * registry — i.e. dispatchTool() will route them to the new domain handlers
 * instead of the legacy switch.
 *
 * Static/no-DB: imports ONLY the dispatcher (which registers the domains) +
 * the registry. Never imports server/tools.ts (pg-pool hang).
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// Importing the dispatcher registers every domain's handlers at import time.
import "../../server/tools/dispatcher";
import { getMigratedHandler, isMigrated } from "../../server/tools/registry";

const RESEARCH_TOOLS = [
  "deep_research",
  "parallel_research",
  "research_digest",
  "recursive_synthesize",
  "trend_research",
  "findings_publish",
  "findings_read",
  "ingest_paper",
];

test("every research-domain tool is registered as migrated with a callable handler", () => {
  for (const name of RESEARCH_TOOLS) {
    assert.equal(isMigrated(name), true, `${name} must be migrated`);
    const handler = getMigratedHandler(name);
    assert.equal(typeof handler, "function", `${name} must resolve to a handler function`);
  }
});
