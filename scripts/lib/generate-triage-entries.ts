// One-off (task: nightly tenant-isolation audit permanently red, 2026-08-01):
// materialize the 2026-08-01 triage campaign — dispositions for the 104 severe
// findings from the 2026-08-01 nightly that survived allowlist+codeLine replay.
// Each disposition below was verified by reading the code site (see campaign
// snapshot). Emits:
//  - new suppressions.json entries (with codeLine anchors from current source)
//  - deferrals.json entries (dated, expiring — per deferred-2026-07-31.md)
//  - campaign-2026-08-01-snapshot.json (generation-contract source of truth)
// Run: npx tsx scripts/lib/generate-triage-entries.ts --write
import fs from "node:fs";
import path from "node:path";
import { extractStructuralAnchor, isUsableCodeLine } from "../../server/lib/audit-suppressions";

const DIR = path.join("data", "tenant-isolation-audit");
const WRITE = process.argv.includes("--write");
const TODAY = "2026-08-01";
const VERIFIER = "task-118 audit-recovery campaign 2026-08-01";

type Dispo = { kind: "suppress"; pattern: string; reason: string } | { kind: "defer"; reason: string; reviewBy: string };
const S = (pattern: string, reason: string): Dispo => ({ kind: "suppress", pattern, reason });
const D = (reason: string, reviewBy = "2026-09-30"): Dispo => ({ kind: "defer", reason, reviewBy });

// Keyed "file:line". Every entry corresponds to a code site read during this campaign.
const DISPOSITIONS: Record<string, Dispo> = {
  // ── system-sweep: platform-wide boot/maintenance/self-heal sweeps (admin context, ids from their own scans)
  "server/agentic/approvals.ts:135": S("system-sweep", "expireStaleApprovals is a platform-wide expiry sweep by design; RETURNING carries tenantId per row for downstream per-tenant handling."),
  "server/agentic/resume-worker.ts:66": S("system-sweep", "resume worker is a global sweep that SELECTs tenant_id per row and processes each run under its own tenant."),
  "server/data-protection.ts:118": S("system-sweep", "retention purge sweep reads soft-deleted conversations platform-wide by design; row tenant_id is selected and carried."),
  "server/data-protection.ts:131": S("system-sweep", "purge DELETE keyed by conv.id obtained from this sweep's own soft-deleted scan (same loop, same row)."),
  "server/data-protection.ts:132": S("system-sweep", "purge DELETE keyed by conv.id from the sweep's own scan; compaction_archives rows belong to that conversation."),
  "server/data-protection.ts:133": S("system-sweep", "purge DELETE of the exact conversation row the sweep's own scan returned."),
  "server/embeddings.ts:726": S("system-sweep", "embedding_vec backfill maintenance sweep; id from its own scan, writes only a vector derived from the row's own embedding column."),
  "server/embeddings.ts:732": S("system-sweep", "backfill scan reads only id+embedding to convert format; no tenant data crosses a boundary."),
  "server/embeddings.ts:743": S("system-sweep", "embedding_vec backfill UPDATE by id from its own scan; value derived from the row's own embedding."),
  "server/seed-cleanup.ts:7": S("system-sweep", "boot cleanup of runaway platform heartbeat tasks; startup admin context, count-only read."),
  "server/seed-cleanup.ts:16": S("system-sweep", "boot cleanup disabling runaway delegation tasks platform-wide by design."),
  "server/seed-cleanup.ts:44": S("system-sweep", "boot cleanup duplicate-task count; startup admin context."),
  "server/seed-cleanup.ts:51": S("system-sweep", "boot cleanup disabling duplicate session-logger tasks platform-wide by design."),
  "server/seed-cleanup.ts:58": S("system-sweep", "boot cleanup count of legacy examine-repository tasks; startup admin context."),
  "server/seed.ts:3722": S("system-sweep", "boot housekeeping removing stale auto-disabled heartbeat sentinel rows platform-wide (seed reconciler is canonical owner of these rows)."),
  "server/seed.ts:3750": S("system-sweep", "boot seed housekeeping in admin context; idempotent platform-wide data fix."),
  "server/seed.ts:3776": S("system-sweep", "boot model-rename housekeeping (gpt-4.1→gpt-5) rewrites a model label platform-wide; no row data returned."),
  "server/seed.ts:2466": S("system-sweep", "boot seed backfill linking research conversations; admin context, idempotent."),
  "server/seed.ts:3294": S("system-sweep", "boot safety-profile reconciler reads heartbeat/persona rows platform-wide to re-apply idempotent safety UPDATEs at startup."),
  "server/seed.ts:3961": S("system-sweep", "boot persona-personality seeder; UPDATE id comes from its own SELECT in the same idempotent seed block."),
  "server/routes.ts:166": S("system-sweep", "startup restoreUploadsFromDb rehydrates the servable uploads dir from file_storage; boot-time system context, not a request path."),
  "server/routes.ts:765": S("system-sweep", "admin Drive-folder backfill sweep; JOIN tenants supplies each row's tenant for per-tenant folder creation."),
  "server/health-audit.ts:333": S("system-sweep", "self-heal sweep archives stale proposals whose ids came from its own stale-scan immediately above."),
  "server/health-audit.ts:368": S("system-sweep", "self-heal sweep disables stuck heartbeat tasks whose ids came from its own scan immediately above."),
  "server/job-queue.ts:98": S("system-sweep", "global queue drainer claims due jobs across tenants by design; each claimed row carries tenant_id for scoped execution."),
  "server/job-queue.ts:148": S("system-sweep", "lease reclaimer is a platform-wide queue-health sweep by design."),
  "server/plan-executor.ts:775": S("system-sweep", "stale-executing-plan resume sweep is platform-wide by design; rows are only flipped back to approved."),
  "server/video-job-runner.ts:236": S("system-sweep", "stale video-job reaper sweep; marks heartbeat-dead jobs failed platform-wide by design."),
  "server/wiring-invariants.ts:244": S("system-sweep", "observability invariant check; aggregate count only, no row data."),
  "server/wiring-invariants.ts:260": S("system-sweep", "observability invariant check; aggregate message count only."),
  "server/wiring-invariants.ts:417": S("system-sweep", "tool-drift observability rollup; aggregates success/fail counts only."),
  "server/oauth-subscriptions.ts:956": S("system-sweep", "subscription health sweep deactivates rows its own scan returned (sub.id from same loop)."),
  "server/oauth-subscriptions.ts:981": S("system-sweep", "same health sweep, consecutive-failure branch; sub.id from its own scan."),
  "server/lib/ideabrowser-backfill.ts:49": S("system-sweep", "one-shot admin backfill; per-tenant count aggregate for verification output."),
  "server/lib/ideabrowser-backfill.ts:100": S("system-sweep", "admin backfill dedupe check on project ids the backfill itself just created."),
  "server/lib/ideabrowser-backfill.ts:115": S("system-sweep", "admin backfill dedupe check on project ids the backfill itself just created."),
  "server/routes/admin.ts:719": S("system-sweep", "admin-gated self-heal status endpoint; platform-wide stuck-insight scan is its purpose."),
  "server/routes/admin.ts:741": S("system-sweep", "admin-gated self-heal status endpoint; platform-wide stuck-pending scan is its purpose."),
  // ── global-table: tables that are platform-global by design (no/irrelevant tenant scoping)
  "server/agentic-engines.ts:344": S("global-table", "heartbeat_logs is a platform-global throttle/telemetry table (pace gate global-by-design); aggregate counts only."),
  "server/agentic-engines.ts:519": S("global-table", "heartbeat_logs global telemetry aggregate (task_name/status rollup only)."),
  "server/pace-control.ts:85": S("global-table", "checkPace is the platform-wide pace gate; heartbeat_logs has no tenant_id — global by design."),
  "server/pace-control.ts:140": S("global-table", "getPaceSnapshot reads the same platform-global heartbeat_logs telemetry."),
  "server/process-governor.ts:121": S("global-table", "heartbeat_logs subquery counts under an outer heartbeat_tasks query that IS tenant-scoped (ht.tenant_id = ${tenantId})."),
  "server/persona-export.ts:33": S("global-table", "personas table has no tenant_id column (platform-global personas); tenant linkage lives in trust/skills rows fetched separately."),
  // ── internal-worker-pk: id is a server-generated PK threaded from the worker that created/claimed it
  "server/agentic/runs.ts:34": S("internal-worker-pk", "runId is a server-generated agent_runs PK threaded from the orchestrator that created the run; never caller-supplied."),
  "server/agentic/runs.ts:45": S("internal-worker-pk", "runId is a server-generated PK from the run's own orchestrator; not reachable from request input."),
  "server/agentic/runs.ts:54": S("internal-worker-pk", "same internal runId threading as updateRunState."),
  "server/agentic/runs.ts:58": S("internal-worker-pk", "completeRun receives the internal runId of the run this worker is executing."),
  "server/agentic/runs.ts:88": S("internal-worker-pk", "failRun receives the internal runId of the run this worker is executing."),
  "server/agentic/runs.ts:97": S("internal-worker-pk", "pauseRun receives the internal runId of the run this worker is executing."),
  "server/job-queue.ts:177": S("internal-worker-pk", "completeJob id comes from the row this worker atomically claimed in claimDueJobs."),
  "server/job-queue.ts:237": S("internal-worker-pk", "failJob id comes from the claimed row in the same worker loop."),
  "server/job-queue.ts:257": S("internal-worker-pk", "failJob requeue branch; same claimed-row id."),
  "server/internal-resolver.ts:184": S("internal-worker-pk", "fail-closed branch: event id came from the resolver's own dropped-event sweep; archives the event without touching tenant data."),
  "server/internal-resolver.ts:229": S("internal-worker-pk", "orphan-delivery archival; event id from the resolver's own sweep, terminal-status transition only."),
  "server/internal-resolver.ts:259": S("internal-worker-pk", "no-handler archival; event id from the resolver's own sweep."),
  "server/sculptor.ts:168": S("internal-worker-pk", "sessionId was created by this module earlier in the same monitor loop; not caller-supplied."),
  "server/lib/bwb-job-progress.ts:203": S("internal-worker-pk", "jobId is an unguessable random id (vj_<base36>_<6-byte-hex>); scope() warns once when BWB_TENANT_ID unthreaded — documented defense-in-depth."),
  "server/lib/bwb-job-progress.ts:245": S("internal-worker-pk", "failBwbJob pinned to the same unguessable random jobId; documented warn-once fallback."),
  "server/chat-engine.ts:4015": S("internal-worker-pk", "recordToolCallForStuckDetection is in-memory loop diagnostics keyed by conversationId; no DB write occurs."),
  "server/auto-memorize.ts:68": S("internal-worker-pk", "singleton watermark row; id from its own category+title SELECT one statement above (system row, tenant 1 by design)."),
  "server/self-reflection.ts:366": S("internal-worker-pk", "UPDATE id comes from the tenant-scoped SELECT (WHERE tenant_id = ${tenantId}) directly above."),
  // ── upstream-verified: tenancy enforced by the caller/type system/immediately-adjacent check
  "server/routes.ts:1117": S("upstream-verified", "this SELECT of owner tenantIds IS the isolation check — non-owners get 404 on the next line."),
  "server/routes.ts:6485": S("upstream-verified", "admin-gated /api/import restore endpoint (requireAdmin); whole-platform backup restore by design."),
  "server/routes.ts:6495": S("upstream-verified", "admin-gated /api/import restore endpoint (requireAdmin)."),
  "server/routes.ts:6505": S("upstream-verified", "admin-gated /api/import restore endpoint (requireAdmin)."),
  "server/routes.ts:6511": S("upstream-verified", "admin-gated /api/import restore endpoint (requireAdmin)."),
  "server/storage.ts:530": S("upstream-verified", "InsertMemoryEntry.tenantId is schema-required (memory_entries.tenant_id NOT NULL, no default) — the type system forces every caller to supply it."),
  "server/storage.ts:585": S("upstream-verified", "conversation_facts.tenant_id NOT NULL with no default; InsertConversationFact requires tenantId at compile time."),
  "server/tool-learning.ts:365": S("upstream-verified", "tool.id was fetched via the tenant-scoped lookup (customTools.name + customTools.tenantId) at the top of executeCustomTool."),
  "server/martech-bundle.ts:325": S("upstream-verified", "existing.id came from getVoiceProfile({tenantId, profileName}) — tenant-scoped fetch in the same upsert."),
  "server/google-drive.ts:561": S("upstream-verified", "project ownership validated earlier in the same function before the Drive folder ids are written back."),
  "server/agentic-features.ts:525": S("upstream-verified", "lead row was selected under the caller's tenant earlier in scoreLeads; id reused within the same loop."),
  "server/agentic-features.ts:671": S("upstream-verified", "enrollment row selected under the tenant earlier in advanceSequence; same-loop id reuse."),
  "server/agentic-features.ts:721": S("upstream-verified", "row selected under the tenant earlier in classifyReply; same-loop id reuse."),
  "server/twilio.ts:116": S("upstream-verified", "this SELECT is itself the tenant-verification step — it compares the row's tenant_id to the claimed pairing tenantId and rejects mismatches."),
  "server/tools/domains/security/handlers.ts:163": S("upstream-verified", "admin-only branch (tenantId === 1) of the platform security scan; reads provider/key-length aggregates only, never key material."),
  "server/tools/domains/security/handlers.ts:260": S("upstream-verified", "admin-only branch (tenantId === 1); COUNT(DISTINCT provider) aggregate only."),
  "server/embeddings.ts:244": S("upstream-verified", "vecLiteral validates every element Number.isFinite before sql.raw interpolation (throws loud otherwise); query is tenant-filtered."),
  "server/embeddings.ts:252": S("upstream-verified", "same validated vecLiteral value reused in ORDER BY; tenant filter present in WHERE."),
  "server/embeddings.ts:559": S("upstream-verified", "vecLiteral-validated vector; query constrained by tenant_id = ${tenantId}."),
  "server/embeddings.ts:565": S("upstream-verified", "same validated vector in ORDER BY of the tenant-filtered query."),
  "server/plan-rollout-simulator.ts:240": S("upstream-verified", "nested sql`${JSON.stringify(...)}::jsonb` is a bound drizzle parameter, not string concatenation; tenant_id is explicitly inserted."),
  "server/delivery-pipeline.ts:1049": S("upstream-verified", "stripePaymentId is a Stripe-issued unique id arriving via the signature-verified webhook; delivery authz is signed-URL based."),
  "server/routes/conversations.ts:98": S("upstream-verified", "project verified in-tenant by the SELECT on line 95 immediately above; conversation comes from the tenant-scoped request context."),
  // ── fk-transitive: child/junction tables with no tenant_id column; tenancy enforced via the parent FK
  "server/memory-graph.ts:197": S("fk-transitive", "memory_links is a junction keyed by memory PKs produced by the same-tenant vector search upstream; no tenant_id column on the table."),
  "server/memory-graph.ts:210": S("fk-transitive", "memory_links INSERT keyed by same-tenant memory PKs; junction table has no tenant_id column."),
  "server/lib/inbox-ingest.ts:536": S("fk-transitive", "JOIN keyed m.id = c.inbox_message_id under tenant-filtered c; classifications only reference same-tenant messages."),
  "server/tools.ts:2878": S("fk-transitive", "project_conversations junction has no tenant_id column; project ownership enforced upstream in the same handler."),
  "server/tools.ts:3020": S("fk-transitive", "project_conversations junction has no tenant_id column; adjacent statements are tenant-scoped."),
  "server/tools.ts:4540": S("fk-transitive", "project_notes has no tenant_id column; INSERT is gated by assertProjectInTenant(projectId, _tenantId) on the line above."),
  "server/tools.ts:6392": S("fk-transitive", "project_files has no tenant_id column; INSERT gated by assertProjectInTenant in the same block."),
  "server/mpeg-engine.ts:1051": S("fk-transitive", "project_files has no tenant_id column; INSERT gated by assertProjectInTenant(options.projectId, options.tenantId)."),
  "server/mpeg-engine.ts:1417": S("fk-transitive", "project_files has no tenant_id column; INSERT gated by assertProjectInTenant in produceVideoParallel."),
  "server/routes/projects.ts:293": S("fk-transitive", "project_files has no tenant_id column; tenancy rides the project_id FK validated by the route's project-ownership check."),
  // ── signed-url
  "server/dfy-intake.ts:93": S("signed-url", "form row fetched by unguessable 48-hex token (the documented authorization for the public intake form); UPDATE reuses that row's own id."),
  // ── deferred (dated, expiring — mirrors deferred-2026-07-31.md; HARD-tier/owner sign-off or follow-up refactors)
  "server/data-protection.ts:24": D("legacy CREATE TABLE memory_categories tenant_id DEFAULT 1 — schema-level decision needed (deferred item 1, campaign 2026-07-31; HARD tier, owner sign-off)."),
  "server/data-protection.ts:48": D("legacy ALTER TABLE agent_knowledge tenant_id DEFAULT 1 — same schema-level decision (deferred item 2, campaign 2026-07-31)."),
  "server/personality-files.ts:8": D("runtime CREATE TABLE personality_files tenant_id NOT NULL DEFAULT 1 — drop-default migration needed (deferred item 3, campaign 2026-07-31)."),
  "server/lib/scheduled-post-runner.ts:319": D("hand-built text[] literal from allowlist-checked platforms — injection-resistant today; refactor to parameterized bind (deferred item 5, campaign 2026-07-31)."),
  "server/delivery-pipeline.ts:195": D("updateDeliveryLog by id only; all callers internal but signature accepts any id — thread tenantId through ~5 call sites (deferred item 7, campaign 2026-07-31)."),
  // ── optional-tenant storage helpers: fail-open fallback when tenantId omitted; hardening = require tenantId (new deferrals this campaign)
  "server/storage.ts:878": D("getMemoryStats falls back to unscoped read when tenantId omitted; hardening = make tenantId required across callers (new deferral, campaign 2026-08-01)."),
  "server/storage.ts:916": D("getHeartbeatTasks falls back to unscoped read when tenantId omitted; same optional-tenant helper hardening (new deferral, campaign 2026-08-01)."),
};

// ── generate ────────────────────────────────────────────────────────────────
const latest = JSON.parse(fs.readFileSync(path.join(DIR, "latest.json"), "utf8"));
const severe = (latest.findings as any[]).filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

function codeLineFor(file: string, line: number): string | undefined {
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch { return undefined; }
  for (const d of [0, 1, -1, 2, -2, 3, -3]) {
    const i = line - 1 + d;
    if (i >= 0 && i < lines.length && isUsableCodeLine(lines[i])) return lines[i].trim();
  }
  return undefined;
}

const newSupp: any[] = [];
const newDefer: any[] = [];
const snapFindings: any[] = [];
const missing: string[] = [];
for (const f of severe) {
  const d = DISPOSITIONS[`${f.file}:${f.line}`];
  if (!d) continue;
  const anchor = extractStructuralAnchor(f.issue);
  if (!anchor) { missing.push(`NO ANCHOR ${f.file}:${f.line}`); continue; }
  const match = f.issue.slice(0, 100).trim();
  const codeLine = codeLineFor(f.file, f.line);
  snapFindings.push({ ...f, disposition: d.kind === "defer" ? "deferred" : "allowlisted" });
  if (d.kind === "suppress") {
    newSupp.push({ file: f.file, pattern: d.pattern, match, anchor, reason: d.reason, verifiedBy: VERIFIER, date: TODAY, ...(codeLine ? { codeLine } : {}) });
  } else {
    newDefer.push({ file: f.file, match, anchor, reason: d.reason, deferredBy: VERIFIER, date: TODAY, reviewBy: d.reviewBy, ...(codeLine ? { codeLine } : {}) });
  }
}
// Findings at the same file:line but different anchors (model splits one site) get one entry each — handled above per finding.
const covered = new Set(snapFindings.map((f) => `${f.file}:${f.line}`));
for (const k of Object.keys(DISPOSITIONS)) if (!covered.has(k)) missing.push(`DISPO UNUSED ${k}`);
console.log(`severe=${severe.length} dispositioned=${snapFindings.length} newSuppressions=${newSupp.length} newDeferrals=${newDefer.length}`);
for (const m of missing) console.log(m);
if (WRITE) {
  const supp = JSON.parse(fs.readFileSync(path.join(DIR, "suppressions.json"), "utf8"));
  fs.writeFileSync(path.join(DIR, "suppressions.json"), JSON.stringify([...supp, ...newSupp], null, 2) + "\n");
  const deferPath = path.join(DIR, "deferrals.json");
  const existingDefer = fs.existsSync(deferPath) ? JSON.parse(fs.readFileSync(deferPath, "utf8")) : [];
  fs.writeFileSync(deferPath, JSON.stringify([...existingDefer, ...newDefer], null, 2) + "\n");
  fs.writeFileSync(path.join(DIR, `campaign-${TODAY}-snapshot.json`), JSON.stringify({ campaign: TODAY, source: "nightly 2026-08-01 latest.json post-replay residue", task: "118", findings: snapFindings }, null, 2) + "\n");
  console.log("wrote suppressions.json, deferrals.json, campaign snapshot");
} else {
  console.log("dry run — pass --write to persist");
}
