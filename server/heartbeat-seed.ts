// Extracted from server/heartbeat.ts (Task 102 girth split, 2026-07-31) — the
// startup system-task seeding block (dream/code-health/health-audit/commitment
// drafter/model catalog/ideabrowser/BWB nudge/mission scan/maintenance crons/
// self-initiative/token audit) plus the maintenance-script allowlist it guards
// against. Mechanical move, zero behavior change; heartbeat.ts imports back.
import { storage, ALL_TENANTS } from "./storage";
import { ADMIN_TENANT_ID } from "./tenant-utils";
import { isProductionRuntime } from "./lib/runtime-env";

export const MAINT_AUTO_DISABLE_MARK = "[auto-disabled:unknown-key]";
export const MAINTENANCE_SCRIPTS: Record<string, { bin: string; args: string[]; timeoutMs: number; label: string }> = {
  "golden-path-replay": { bin: "tsx", args: ["scripts/golden-path-replay.ts"], timeoutMs: 20 * 60 * 1000, label: "Golden Path Replay" },
  "loadtest-layer1":    { bin: "tsx", args: ["scripts/loadtest-layer1.ts"],    timeoutMs: 10 * 60 * 1000, label: "Load Test Layer 1" },
  "model-tier-refresh": { bin: "tsx", args: ["scripts/model-tier-refresh.ts"], timeoutMs: 20 * 60 * 1000, label: "Model Tier Refresh" },
  "typecheck":          { bin: "tsc", args: ["--noEmit", "--incremental"],     timeoutMs: 10 * 60 * 1000, label: "Typecheck" },
  "owner-digest-flush": { bin: "tsx", args: ["scripts/owner-digest-flush.ts"], timeoutMs: 5 * 60 * 1000,  label: "Owner Notification Digest" },
  "offline-eval":       { bin: "tsx", args: ["scripts/offline-eval.ts"],       timeoutMs: 20 * 60 * 1000, label: "Offline Golden-Set Eval" },
  "action-ledger-reconcile": { bin: "tsx", args: ["scripts/action-ledger-reconcile.ts"], timeoutMs: 5 * 60 * 1000, label: "Action Ledger Reconciler" },
  "tool-retirement":    { bin: "tsx", args: ["scripts/tool-retirement-pass.ts"], timeoutMs: 5 * 60 * 1000,  label: "Tool Retirement Pass" },
  "tool-forge":         { bin: "tsx", args: ["scripts/tool-forge-pass.ts"],      timeoutMs: 10 * 60 * 1000, label: "Tool Forge Pass" },
  "sandbox-retention":  { bin: "tsx", args: ["scripts/sandbox-retention.ts"],    timeoutMs: 5 * 60 * 1000,  label: "Sandbox Retention" },
  "ideabrowser-weekly-scenario": { bin: "tsx", args: ["scripts/ideabrowser-weekly-scenario.ts"], timeoutMs: 20 * 60 * 1000, label: "IdeaBrowser Weekly Scenario" },
};

export async function seedSystemHeartbeatTasks(): Promise<void> {
  try {
    const allTasksForSeed = await storage.getHeartbeatTasks(undefined, ALL_TENANTS);
    const hasDream = allTasksForSeed.some(t => t.type === "dream_consolidation");
    if (!hasDream) {
      await storage.createHeartbeatTask({
        name: "Dream Memory Consolidation",
        description: "Background memory consolidation — merges duplicates, archives stale entries, promotes important memories, creates cross-topic summaries. Runs only when system is idle.",
        type: "dream_consolidation",
        cronExpression: "0 */6 * * *",
        enabled: true,
        promptContent: "Consolidate and reorganize active memories: merge duplicates, archive stale entries, promote important findings, create cross-topic summaries.",
        model: "gemini-2.5-flash",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
      });
      console.log("[heartbeat] Seeded dream_consolidation task (every 6 hours, idle-only)");
    }
    const hasCodeHealth = allTasksForSeed.some(t => t.type === "code_health_scan");
    if (!hasCodeHealth) {
      await storage.createHeartbeatTask({
        name: "Nightly Code Health Scan",
        description: "Scans server/, client/src/, shared/, scripts/ for empty catches, hardcoded secrets, stray console.log, and other bad-smell patterns. Emails Bob if a NEW critical finding appears since the last scan.",
        type: "code_health_scan",
        cronExpression: "30 1 * * *",
        enabled: true,
        promptContent: "Run the static-analysis scanner and alert on regressions.",
        model: "gemini-2.5-flash",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
      });
      console.log("[heartbeat] Seeded code_health_scan task (nightly at 01:30 UTC — off-cluster from research scans)");
    }
    // R71: nightly health audit — runs runFullAudit({apply:true}) and emails
    // Bob if any HIGH-severity findings show up (would catch a half-shipped
    // tool, broken BrowserAction dispatch, etc.). Off-cluster from code_health.
    const hasHealthAudit = allTasksForSeed.some(t => t.type === "health_audit");
    if (!hasHealthAudit) {
      await storage.createHeartbeatTask({
        name: "Nightly Health Audit",
        description: "Runs the production-readiness audit (orphan modules, route orphans, stale plans, BrowserAction dispatch symmetry, stale code_proposals, dead heartbeats). Auto-archives stale items and emails Bob if any HIGH-severity finding appears.",
        type: "health_audit",
        cronExpression: "15 2 * * *",
        enabled: true,
        promptContent: "Run runFullAudit({apply:true}) and alert on HIGH-severity findings.",
        model: "gemini-2.5-flash",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
      });
      console.log("[heartbeat] Seeded health_audit task (nightly at 02:15 UTC)");
    }
    // Agentic Upgrades Phase 1 — Proactive Commitment Drafting. Hourly pass:
    // expires past-due commitments, atomically claims due-soon open rows
    // (draft_status='open' → 'draft_pending'), drafts the deliverable via a
    // tool-less LLM call, and surfaces an approval card. NEVER sends.
    // Kill switch COMMITMENT_DRAFTER=off; spend seam per draft; cap 10/tenant/day.
    const hasCommitmentDrafter = allTasksForSeed.some(t => t.type === "commitment_drafter");
    if (!hasCommitmentDrafter) {
      await storage.createHeartbeatTask({
        name: "Commitment Drafter",
        description: "Proactive commitment drafting: when a mined commitment is within its lead time, drafts the promised deliverable (Scribe/Apollo/Cassandra routing) and pushes it into the approval queue. Drafting only — sending is always human-gated.",
        type: "commitment_drafter",
        cronExpression: "20 */2 * * *",
        enabled: true,
        promptContent: "Run runCommitmentDrafter() — expiry sweep, atomic claim, draft, approval card.",
        model: "gpt-5-mini",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
      });
      console.log("[heartbeat] Seeded commitment_drafter task (every 2h at :20)");
    }
    // R73.B Phase 1: probe the Replit OpenAI gateway daily for new model
    // availability (GPT-5.6 Sol "Spud" — released April 23, 2026 to ChatGPT but
    // not yet to API). The task self-disables on first success so it stops
    // probing once the model is live. Off-cluster from other heavy jobs
    // (04:30 UTC) and dirt cheap — single 10-token completion request.
    // R73.C — replaces the targeted GPT-5.6 Sol probe with a general-purpose
    // catalog sync. Pulls OpenRouter's daily-updated model list, diffs against
    // MODEL_REGISTRY, confirms gateway availability for new OpenAI models,
    // and emails Bob with a ranked summary. No auto-add — review-only.
    const hasModelCatalog = allTasksForSeed.some(t => t.type === "model_catalog_sync" || t.type === "model_probe");
    if (!hasModelCatalog) {
      await storage.createHeartbeatTask({
        name: "Model Catalog Sync",
        description: "Daily fetch of OpenRouter's model catalog (~350 models). Filters to OpenAI/Anthropic/Google/xAI, diffs against MODEL_REGISTRY, infers tier+cost from pricing, and probes Replit gateway availability for new OpenAI models. Emails Bob a ranked summary of new releases with recommended tier classifications. Review-only — no auto-add to registry.",
        type: "model_catalog_sync",
        cronExpression: "30 4 * * *",
        enabled: true,
        promptContent: "Sync model catalog from OpenRouter; alert on new releases.",
        model: "gpt-5.6-sol",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
      });
      console.log("[heartbeat] Seeded model_catalog_sync task (daily at 04:30 UTC, OpenRouter discovery + Replit gateway probes)");
    }
    // Bob 2026-06-16: PROD-safe daily IdeaBrowser ingest + scoring. Decoupled from
    // the dev-only ideabrowser_autobuild (which writes a package file + Auto Git
    // Pushes — useless on the ephemeral prod FS). This task only reads Gmail,
    // creates idea-stage projects, and scores them in-process (sets
    // metadata.priority + tier:* tag) — DB + network only, prod-safe. Seeded
    // prod-only (shared DB) so the row appears exactly when the handler does; the
    // build phase stays dev. Pre-approved so getDueHeartbeatTasks picks it up.
    const hasIdeaIngest = allTasksForSeed.some(t => t.type === "ideabrowser_ingest");
    if (isProductionRuntime() && !hasIdeaIngest) {
      await storage.createHeartbeatTask({
        name: "IdeaBrowser Ingest + Score (daily)",
        description: "Prod-safe daily ingest of new Greg-Isenberg Idea-of-the-Day emails into idea-stage projects, then in-process portfolio scoring (sets metadata.priority + tier:* tag). DB + network only — NO file writes, NO git. The dev-only ideabrowser_autobuild task handles the build phase.",
        type: "ideabrowser_ingest",
        cronExpression: "0 11 * * *",
        enabled: true,
        promptContent: "Ingest new IdeaBrowser emails and score unscored Isenberg ideas.",
        model: "gpt-5-mini",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded ideabrowser_ingest task (daily 11:00 UTC) — production-only");
    }
    // BWB Monday weigh-in nudge. Bob weighs in Monday mornings but historically
    // could only update the stored weight as a side-effect of starting a build.
    // This proactively emails him Monday AM (only when the weight is stale for the
    // week) with a one-click link to the project-16 weight card — no inbound email
    // parsing, link-based capture. Seeded prod-only (shared DB) so it fires once,
    // pre-approved so getDueHeartbeatTasks picks it up. Mon 13:00 UTC (~AM ET).
    const hasWeighInNudge = allTasksForSeed.some(t => t.type === "bwb_weigh_in_reminder");
    if (isProductionRuntime() && !hasWeighInNudge) {
      await storage.createHeartbeatTask({
        name: "BWB Monday Weigh-In Nudge",
        description: "Monday-morning email nudge asking Bob to log his weekly weigh-in for Built With Bob — sent only when the stored weight is stale for this week. Links to the project-16 weight card (no inbound email parsing). Keeps the weekly recap's supplied-fact weight fresh before Saturday's build.",
        type: "bwb_weigh_in_reminder",
        cronExpression: "0 13 * * 1",
        enabled: true,
        promptContent: "If the stored BWB weight is stale for this week, email Bob a weigh-in reminder.",
        model: "gemini-2.5-flash",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded bwb_weigh_in_reminder task (Mon 13:00 UTC) — production-only");
    }
    // Revenue Mission opportunity scanner (S6c). Weekly, prod-only (shared DB;
    // DB + in-process only — no FS, no git, no LLM, $0). Deterministic promotion
    // of the top ALREADY-SCORED S/A-tier IdeaBrowser project into a
    // PROPOSAL-ONLY mission at stage 'hypothesis' — capacity-guarded (max active
    // unproven) and one-pending-proposal-at-a-time; nothing sends without a
    // drafted experiment PLUS owner approval (S3 fail-closed gate).
    const hasMissionScan = allTasksForSeed.some(t => t.type === "mission_opportunity_scan");
    if (isProductionRuntime() && !hasMissionScan) {
      await storage.createHeartbeatTask({
        name: "Revenue Mission Opportunity Scan (weekly)",
        description: "Weekly deterministic scan that promotes the top-scored unlinked S/A-tier IdeaBrowser idea project into a PROPOSAL-ONLY Verified Revenue Mission (stage 'hypothesis'). Skips when the portfolio is at unproven capacity or an auto-proposed mission still awaits the owner. $0, no LLM, DB-only. Owner approval remains required before anything sends.",
        type: "mission_opportunity_scan",
        cronExpression: "0 14 * * 1",
        enabled: true,
        promptContent: "Scan scored idea projects and propose at most one new revenue mission (proposal-only).",
        model: "none",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded mission_opportunity_scan task (Mon 14:00 UTC) — production-only");
    }
    // Event-driven mission reply intake (CPT 5.6 #2). Every 15 min, prod-only
    // (shared DB; DB + Gmail-read only — no FS, no git, no LLM, $0). Runs the
    // shared reply-scan core for live experiments: dedupes by Gmail message id,
    // writes mission evidence, and pauses the replied prospect's outreach
    // enrollment. Fail-closed: fetch/classification/matching failures skip the
    // message (the operator script scripts/mission-reply-scan.ts remains the
    // manual reconciliation backstop). Cheap when idle — one SELECT and an
    // immediate return while no live experiments carry reply tokens.
    // Tenant-scoped existence check: only an ADMIN-tenant row satisfies the
    // seed — a same-type row under another tenant must never block seeding.
    const hasReplyIntake = allTasksForSeed.some(t => t.type === "mission_reply_intake" && Number((t as any).tenantId) === ADMIN_TENANT_ID);
    if (isProductionRuntime() && !hasReplyIntake) {
      await storage.createHeartbeatTask({
        name: "Mission Reply Intake (15 min)",
        description: "Automated Gmail reply intake for live Revenue Mission experiments — matches by reply token, dedupes by Gmail message id, records mission evidence, and pauses the replied prospect's outreach sequence. Fail-closed: unreadable or unmatched messages are skipped for the manual reconciliation sweep. $0, no LLM, Gmail read-only.",
        type: "mission_reply_intake",
        cronExpression: "*/15 * * * *",
        enabled: true,
        promptContent: "Scan Gmail for replies to live mission experiments; record evidence and pause replied prospects.",
        model: "none",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded mission_reply_intake task (every 15 min) — production-only");
    }
    // Bob 2026-06-04: the four ex-workflow maintenance jobs as DB-driven crons.
    // Pre-approved (approvalStatus) so they're picked up by getDueHeartbeatTasks;
    // type "maintenance_script" + promptContent = allowlist key (see
    // MAINTENANCE_SCRIPTS). Production-gated in the due-task filter. Times are
    // staggered + off-peak (UTC). Intervals chosen per each script's design.
    const MAINT_SEED: Array<{ key: string; name: string; cron: string; desc: string }> = [
      { key: "typecheck",          name: "Typecheck (scheduled)",        cron: "0 7 * * *",  desc: "Daily TypeScript typecheck (tsc --noEmit --incremental) across the codebase. Free, source-only. Was a manual workflow button." },
      { key: "golden-path-replay", name: "Golden Path Replay (nightly)", cron: "0 8 * * *",  desc: "Nightly golden-path pipeline replay — one canonical prompt per format, fingerprints the artifact, compares to last-known-good, freezes + emails Bob on drift. Cost-capped $1/run. Was a manual workflow button." },
      { key: "model-tier-refresh", name: "Model Tier Refresh (weekly)",  cron: "0 9 * * 1",  desc: "Weekly autonomous model-tier re-evaluation — refreshes frontier/mundane tiers from the latest catalog + competence probes, updates data/model-tiers.json, emails Bob. Was a manual workflow button." },
      { key: "loadtest-layer1",    name: "Load Test Layer 1 (weekly)",   cron: "30 9 * * 1", desc: "Weekly synthetic burst load test against the production deploy — p50/p95 latency, error rate, tail behavior; emails Bob a one-page report. Was a manual workflow button." },
      { key: "owner-digest-flush", name: "Owner Notification Digest (daily)", cron: "0 13 * * *", desc: "Daily batched digest of mid-salience (score 40–69) owner notifications into ONE email so routine signals don't page Bob one-at-a-time. True escalations (score ≥70) still page immediately. Bob 2026-06-04 autonomy upgrade." },
      { key: "offline-eval",       name: "Offline Golden-Set Eval (nightly)", cron: "0 10 * * *", desc: "Nightly offline golden-set regression eval — generates answers for a held-out Q&A set, grades each with a DISTINCT judge model (maker/checker split), tracks run history, and fails (non-zero exit → error log) on degraded coverage or a suite-score regression vs the last non-degraded baseline. Closes the 'evaluation beyond final-task-success' gap." },
      { key: "action-ledger-reconcile", name: "Action Ledger Reconciler (6h)", cron: "20 */6 * * *", desc: "Action Ledger S3 (contract: data/feature-contracts/action-ledger/) — sweeps stale prepared/executing attempts to unknown, probes unknown rows for provider-side proof (Stripe events keyed on the idempotency key; commit-after-timeout settles committed WITHOUT re-execution), and queues unresolvable rows to the owner digest ONCE. Never retries anything." },
      { key: "tool-retirement",    name: "Tool Retirement Pass (weekly)", cron: "0 11 * * 2",  desc: "Weekly eviction loop (contract: data/feature-contracts/tool-forge-eviction/) — diffs the registered tool surface against tool_performance telemetry, flags zero-invocation-over-window / high-failure tools as retirement candidates in the HITL approval queue. Flag-only, $0, no LLM; exemptions in data/tool-retirement-exemptions.json; dedupes vs prior approvals." },
      { key: "sandbox-retention",  name: "Sandbox Retention (weekly)",    cron: "45 10 * * 1", desc: "Weekly TTL purge of Simulation Sandbox data — deletes sandbox_runs (and cascaded sandbox_results) older than SANDBOX_RETENTION_DAYS (default 14). Promoted improvements survive via run_id ON DELETE SET NULL. $0, no LLM; keeps replay history from accumulating unbounded." },
      { key: "ideabrowser-weekly-scenario", name: "IdeaBrowser Weekly Scenario (Mon)", cron: "15 13 * * 1", desc: "Weekly IdeaBrowser money-scenario pass — ingests the last 7 days of ideas, scores, picks the top 5, runs per-idea profit scenarios, files a 'Weekly Run YYYY-MM-DD' project into the IdeaBrowser folder, and delivers the report + owner email. Prod is the canonical home (dev/prod DBs are separate); the old dev-workspace cron is retired." },
      { key: "tool-forge",         name: "Tool Forge Pass (weekly)",      cron: "30 11 * * 2", desc: "Weekly Tool Forge Phase 2 (contract: data/feature-contracts/tool-forge-eviction/) — turns the highest-demand un-proposed capability_gap (missCount ≥ 3) into a draft module proposal under data/tool-forge/proposals/ + a HITL approval with the new-tool-registration checklist. Budget-claimed fail-closed; ≤1 proposal/run; nothing lands automatically." },
    ];
    // Seed ONLY in production. The DB is shared with dev, and the
    // maintenance_script handler exists only in freshly-built prod code — so
    // seeding from dev (or before republish) would let old/dev runners see an
    // unrecognized type and mis-handle it as a generic LLM task. Prod-only
    // seeding means the rows appear exactly when the handler does.
    // Contract guard: every MAINT_SEED key MUST be an own-key of
    // MAINTENANCE_SCRIPTS, or the seed would create a row the handler can't run
    // (it would self-heal-disable on first tick → boot-enable/run-disable churn).
    const maintSeedDrift = MAINT_SEED.filter(m => !Object.hasOwn(MAINTENANCE_SCRIPTS, m.key));
    if (maintSeedDrift.length > 0) {
      console.error(`[heartbeat] MAINT_SEED/MAINTENANCE_SCRIPTS drift — these keys have no handler and will not run: ${maintSeedDrift.map(m => m.key).join(", ")}`);
    }
    if (isProductionRuntime()) for (const m of MAINT_SEED) {
      // Tenant-scoped: only an ADMIN-tenant row may satisfy the seed/reconcile
      // match — a same-key maintenance_script row created under another tenant
      // must never block seeding or be re-enabled/re-approved by this loop.
      const existing = allTasksForSeed.find(t => t.type === "maintenance_script" && Number((t as any).tenantId) === ADMIN_TENANT_ID && (t.promptContent || "").trim() === m.key);
      if (!existing) {
        await storage.createHeartbeatTask({
          name: m.name,
          description: m.desc,
          type: "maintenance_script",
          cronExpression: m.cron,
          enabled: true,
          promptContent: m.key,
          model: "gpt-5-nano",
          personaId: null,
          createdBy: "system",
          runOnce: false,
          tenantId: ADMIN_TENANT_ID,
          approvalStatus: "approved",
        } as any);
        console.log(`[heartbeat] Seeded maintenance_script task "${m.name}" (${m.cron}) — production-only`);
      } else if (existing.enabled === false && (existing.description || "").includes(MAINT_AUTO_DISABLE_MARK)) {
        // Re-enable ONLY a row the unknown-key self-heal disabled (it carries
        // the sentinel) — e.g. a rollback to code lacking this key disabled it,
        // then a redeploy restored the key. Gating on the mark means a task Bob
        // deliberately disabled in the UI (no mark) is left untouched. Strip the
        // mark so the description returns to its seeded form.
        const restoredDesc = (existing.description || "")
          .replace(MAINT_AUTO_DISABLE_MARK, "")
          .replace(/\s+/g, " ")
          .trim();
        // Also pull next_run_at to now: the disable consumed the slot (the
        // failed run stamped last_run_at + advanced next_run_at), so a weekly
        // task would otherwise silently wait out a full period after recovery.
        await storage.updateHeartbeatTask(existing.id, { enabled: true, description: restoredDesc || m.desc, nextRunAt: new Date() } as any);
        console.log(`[heartbeat] Re-enabled maintenance_script task "${m.name}" (self-heal mark cleared, valid allowlist key) — next_run_at pulled to now`);
      } else if (existing.enabled && existing.approvalStatus === "approved" && !existing.lastRunAt) {
        // Missed-first-slot catch-up (Bob 2026-07-21): a maintenance task seeded
        // AFTER its cron slot already passed gets next_run_at computed forward —
        // a weekly task deployed Monday 19:39 silently skips to NEXT Monday
        // (root cause of the IdeaBrowser Weekly Scenario never running). If the
        // task has NEVER run and its next slot is more than 1h out, pull it to
        // now so the first run happens on the next tick. One-shot by definition
        // (last_run_at is stamped after the run), so this can't loop.
        const nextAt = existing.nextRunAt ? new Date(existing.nextRunAt).getTime() : Infinity;
        if (nextAt > Date.now() + 60 * 60 * 1000) {
          await storage.updateHeartbeatTask(existing.id, { nextRunAt: new Date() } as any);
          console.log(`[heartbeat] Catch-up: never-run maintenance task "${m.name}" had next_run_at ${existing.nextRunAt} — pulled to now for first run`);
        }
      }
    }

    // Bob 2026-06-25: Self-Directed Initiative loop (the "intention engine") —
    // the platform's first SELF-ORIGINATED goal-formation loop. Introspects its
    // own internal telemetry and proposes initiatives nobody asked for, surfaced
    // to the owner digest for approval (HITL on commitment, never auto-executes).
    // DB + network + budget-claimed LLM only → prod-safe. Seeded prod-only
    // (shared DB) + pre-approved so getDueHeartbeatTasks picks it up. Mon & Thu
    // 12:00 UTC.
    const hasSelfInitiative = allTasksForSeed.some(t => t.type === "self_initiative");
    if (isProductionRuntime() && !hasSelfInitiative) {
      await storage.createHeartbeatTask({
        name: "Self-Directed Initiatives (intention engine)",
        description: "Introspects the platform's own internal telemetry (open incidents, decline events, lead pipeline, heartbeat errors, eval drift) and proposes up to 3 self-authored initiatives nobody asked for. Persists them and surfaces new ones to the owner digest for approval — genuine self-originated goal formation with HITL on commitment; never auto-executes a material change. Budget-claimed before any LLM spend.",
        type: "self_initiative",
        cronExpression: "0 12 * * 1,4",
        enabled: true,
        promptContent: "Introspect platform telemetry and propose self-directed initiatives.",
        model: "gpt-5-mini",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded self_initiative task (Mon & Thu 12:00 UTC) — production-only");
    }
    // Token audit 2026-07-30 (Bob decision: monthly cadence). Recurring
    // configuration-level token-waste review — heartbeat model/cadence drift
    // vs the $0-lane directive, high-frequency crons, spend trend from
    // agent_cost_ledger. Read-only report emailed to the owner; changes stay
    // HITL via the token-usage-audit skill.
    const hasTokenAudit = allTasksForSeed.some(t => t.name === "Monthly Token Usage Audit");
    if (!hasTokenAudit) {
      await storage.createHeartbeatTask({
        name: "Monthly Token Usage Audit",
        description: "Monthly configuration-level token-waste review: flags heartbeat tasks on metered/dated model ids (vs the $0 modelfarm directive), high-frequency cadences, and summarizes the last 30 days of agent_cost_ledger spend by model. Report-only — emails findings to the owner; never changes config itself (changes go through the HITL token-usage-audit skill).",
        type: "routine",
        cronExpression: "0 8 1 * *",
        enabled: true,
        promptContent: "Run a read-only token usage audit: 1) list heartbeat_tasks whose model is not on the $0 modelfarm lane (gpt-5.4/gpt-5.5/gpt-5-mini/gpt-5-nano/gemini-2.5-flash) or whose cron runs hourly or more often; 2) summarize the last 30 days of agent_cost_ledger spend grouped by model, and compare to the prior 30 days; 3) email the owner a short ranked summary of any token-waste findings with recommended (not applied) fixes. Make NO configuration changes.",
        model: "gpt-5-mini",
        personaId: null,
        createdBy: "system",
        runOnce: false,
        tenantId: ADMIN_TENANT_ID,
        approvalStatus: "approved",
      } as any);
      console.log("[heartbeat] Seeded Monthly Token Usage Audit (1st of month 08:00 UTC)");
    }
  } catch (err) {
    console.warn("[heartbeat] Could not seed dream task:", err);
  }
}
