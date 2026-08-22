// Query-free tenant-boundary regression checks. These target the contracts that
// the tenant-isolation audit cannot safely exercise with a live pooled database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("agent-run mutation helpers require tenant scope and use it in their update predicates", () => {
  const source = read("server/agentic/runs.ts");
  for (const helper of [
    "appendStep",
    "updateRunState",
    "replaceRunState",
    "completeRun",
    "failRun",
    "pauseRun",
  ]) {
    assert.match(
      source,
      new RegExp(`export async function ${helper}\\(runId: number, tenantId: number`),
      `${helper} must require the trusted tenant identity`,
    );
  }

  const scopedUpdates = source.match(
    /where\(and\(eq\(agentRuns\.id, runId\), eq\(agentRuns\.tenantId, tenantId\)\)\)/g,
  ) ?? [];
  assert.ok(
    scopedUpdates.length >= 7,
    "every agent-run mutation and the post-completion read must bind run ID and tenant ID together",
  );
});

test("auto-memorize enumerates only tenant metadata before reading content tenant-by-tenant", () => {
  const source = read("server/auto-memorize.ts");
  const heartbeat = read("server/heartbeat.ts");
  assert.match(
    source,
    /export async function runAutoMemorizeForTenant\s*\(\s*tenantId: number/,
    "ordinary callers must be limited to one tenant",
  );
  assert.match(
    heartbeat,
    /SELECT DISTINCT tenant_id\s+FROM messages/,
    "only the heartbeat worker may discover tenant IDs before tenant-bound content reads",
  );
  assert.match(
    heartbeat,
    /async function maybeRunAutoMemorizeFromHeartbeat/,
    "the cross-tenant sweep must remain a heartbeat-private worker function",
  );
  assert.match(
    heartbeat,
    /runAutoMemorizeForTenant\(tenantId\)/,
    "the heartbeat must delegate content processing to the tenant-bound API",
  );
  assert.doesNotMatch(
    source,
    /runAutoMemorizeForPlatformWorker/,
    "auto-memorize must not export a cross-tenant convenience API",
  );
  assert.match(
    source,
    /WHERE m\.tenant_id = \$\{tenantId\}/,
    "message content reads must bind the requested tenant before rows are returned",
  );
  assert.match(
    source,
    /LEFT JOIN conversations c ON c\.id = m\.conversation_id AND c\.tenant_id = m\.tenant_id/,
    "joined conversation metadata must be tenant-bound to the message row",
  );
  assert.doesNotMatch(
    source,
    /SELECT m\.tenant_id, m\.role, m\.content[\s\S]{0,700}ORDER BY m\.tenant_id ASC/,
    "a global content read followed by in-memory partitioning is forbidden",
  );
  assert.match(
    source,
    /async function getWatermark\(tenantId: number\)/,
    "watermarks must be tenant-scoped",
  );
  assert.match(
    source,
    /async function setWatermark\(tenantId: number, watermark: Watermark\)/,
    "watermark writes must be tenant-scoped",
  );
  assert.match(
    source,
    /m\.id > \$\{watermark\.afterMessageId \?\? 0\}/,
    "a full page must resume from a stable message ID cursor",
  );
  assert.match(
    source,
    /ORDER BY m\.created_at ASC, m\.id ASC/,
    "the cursor predicate and query order must use the same stable tuple",
  );
  assert.match(
    source,
    /LIMIT \$\{MAX_MESSAGES_PER_BATCH\}/,
    "one synthesized page must fit within the prompt budget instead of truncating a larger page",
  );
  assert.doesNotMatch(
    source,
    /applyCaps\(redactSecrets\(transcript\), \{ maxChars: 16000 \}\)/,
    "prompt caps must not silently discard the tail of a cursor-advanced batch",
  );
  assert.match(
    source,
    /await flushNow\(\{ throwOnError: true \}\)/,
    "a tenant watermark cannot advance before its queued lessons persist",
  );
  assert.match(
    source,
    /if \(rows\.length < 4\) \{[\s\S]{0,360}result\.success = true;[\s\S]{0,160}return result;/,
    "sparse tenant activity must remain eligible for a later synthesis instead of advancing its watermark",
  );
});

test("the manual tool can only invoke a tenant-scoped auto-memorize run", () => {
  const source = read("server/tools.ts");
  const start = source.indexOf('case "auto_memorize_now"');
  assert.ok(start >= 0, "auto_memorize_now handler must exist");
  const handler = source.slice(start, start + 900);
  assert.match(handler, /params\._tenantId/, "the handler must require dispatcher-provided tenant context");
  assert.match(
    handler,
    /runAutoMemorizeForTenant\(params\._tenantId,/,
    "the manual tool must not invoke the platform-worker sweep",
  );
});

test("approval resume claims remain durable and recoverable across a process restart", () => {
  const source = read("server/agentic/resume-worker.ts");

  assert.match(
    source,
    /steps = COALESCE\(steps, '\[\]'::jsonb\) \|\|/,
    "claiming an approval must persist its audit step in the same update",
  );
  assert.match(
    source,
    /AND r\.state \? 'resumeClaimedAt'/,
    "a later sweep must discover a crash between claim and continuation dispatch",
  );
  assert.match(
    source,
    /resume:claim_recovered/,
    "a restart without an in-memory continuation must terminally recover the run",
  );
  assert.match(
    source,
    /Keep the[\s\S]*durable marker and in-process continuation[\s\S]*completeRun[\s\S]*failRun clears the marker/,
    "the approval handoff must retain recovery state until a terminal run mutation clears it",
  );
  assert.match(
    source,
    /approvalStatus === "approved"\s*\?\s*\{ resumedAt: claimedAt, resumeClaimedAt: claimedAt/,
    "only an approved run may carry a resume recovery marker",
  );
});