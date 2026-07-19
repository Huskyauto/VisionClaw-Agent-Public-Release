/**
 * Comprehensive Features Doc — PDF + text + Drive upload + project_files registration + owner email.
 *
 * Runs end-to-end the agent-callable portion of the post-edit-pipeline (steps 4-7).
 * Steps 1 (code review) and 2 (replit.md update) stay agent-driven. Step 3 (private
 * GitHub push) is handled by the Auto Git Push workflow on a 90s quiet timer.
 *
 * Usage:
 *   npx tsx scripts/build-features-doc.ts
 *
 * Env (all optional):
 *   OWNER_ALERT_EMAIL    — recipient (default: huskyauto@gmail.com)
 *   FEATURES_DOC_DATE    — date stamp in filename (default: today's YYYY-MM-DD UTC)
 *   FEATURES_SKIP_EMAIL  — set to "1" to skip the email step (Drive upload still happens)
 *
 * Exit codes: 0 success, 1 PDF gen failed, 2 Drive upload failed, 3 email failed, 4 misc.
 *
 * Counts pulled live: tools from TOOL_DEFINITIONS, skills from skills table, personas from
 * personas table. Stat headline numbers come from replit.md / README — keep replit.md current.
 */
import * as fs from "node:fs";
import { sql } from "drizzle-orm";
import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { TOOL_DEFINITIONS } from "../server/tools";
import { db } from "../server/db";

const HEADLINE_STATS = {
  tools: "399 (+ 4 MCP memory tools, external surface)",
  skills: "43 (.agents/) + 62 (db) + 38 (output-skills/) = 143 reference surfaces",
  personas: "16",
  capabilities: "129",
  tables: "215",
  indexes: "627",
  governance: "41",
  models: "41 + 1000+",
  loc: "~263k (686 files)",
  release: "R125+137.44",
};

(async () => {
  try {
    const today = process.env.FEATURES_DOC_DATE || new Date().toISOString().slice(0, 10);

    const toolNames = (TOOL_DEFINITIONS as any[])
      .map((t) => t.function?.name || t.name)
      .filter(Boolean)
      .sort();
    const skillsRes: any = await db.execute(sql`SELECT name FROM skills ORDER BY name`);
    const skillNames: string[] = ((skillsRes.rows || skillsRes) as any[]).map((r: any) => r.name);
    const personaRes: any = await db.execute(
      sql`SELECT id, name, role FROM personas WHERE is_active=true ORDER BY id`,
    );
    const personas: any[] = (personaRes.rows || personaRes) as any[];

    const stats = [
      { label: "Tools", value: HEADLINE_STATS.tools },
      { label: "Skills", value: HEADLINE_STATS.skills },
      { label: "Personas", value: HEADLINE_STATS.personas },
      { label: "Capabilities", value: HEADLINE_STATS.capabilities },
      { label: "Tables", value: HEADLINE_STATS.tables },
      { label: "Indexes", value: HEADLINE_STATS.indexes },
      { label: "Governance Rules", value: HEADLINE_STATS.governance },
      { label: "Models (curated)", value: HEADLINE_STATS.models },
      { label: "LOC", value: HEADLINE_STATS.loc },
    ];

    const toolGroups: Record<string, string[]> = {};
    for (const t of toolNames) {
      const k = t[0].toUpperCase();
      (toolGroups[k] = toolGroups[k] || []).push(t);
    }
    const toolBullets = Object.keys(toolGroups)
      .sort()
      .map((k) => `${k}: ${toolGroups[k].join(", ")}`);

    const sections: any[] = [
      {
        title: "Latest Releases",
        content:
          "Release narrative — see replit.md for the full R-round history with architect findings, FALSE POSITIVE log, and known gaps.",
        bullets: [
          "R125+133 (2026-07-10) — Post-edit code-review sweep (whole-app + sensitive areas + 72h): 6 fixes shipped — tests/run.sh +6 security tests wired into the canonical suite; trust-reviewer clean_memory_op auto-approve now blocks reserved knowledge categories (defense-in-depth behind the storage chokepoint); tool-learning tryAndRevert fails CLOSED on unvalidatable tools with the row actually DELETED on every reverted path (shared revertToolRow helper — verification architect caught the early branches leaving unvalidated tool code active); self-heal drops allowSystemFallback + requires a positive-integer tenantId; IStorage createKnowledge/updateKnowledge sigs carry allowReservedCategory opts; twilio stale pairing comment corrected. OTP phone-ownership pairing + DB pairing-key uniqueness remain DEFERRED (documented in architecture-notes known gaps). Gates: tsc 0, build 0, seam 67/67, wiring CLEAN, suite 126/0, guard test 8/8, architect FAIL (tool-learning delete gap) → fixed → PASS. _(model: anthropic/claude-opus-4)_",
          "R125+132 (2026-07-10) — Grok public-mirror triage items 1–5 (all five shipped, zero new npm deps): (1) domain-boundary CI gate scripts/preflight-domain-boundaries.ts — static import scan of server/tools/domains/** (219 files / 73 domains, 0 cross-domain imports; alias-shaped specifiers resolved + non-literal dynamic import/require fails closed), wired as a preflight at the top of tests/run.sh; (2) coverage reporting scripts/run-coverage.sh — single-process --experimental-test-coverage run over the canonical suite files, informational-only by design; (3) Prometheus /metrics server/routes/metrics.ts — mounted BEFORE auth/CSRF, fail-closed 404 when METRICS_TOKEN unset OR Bearer mismatch (never 401), timing-safe Bearer compare, per-query try/catch → visionclaw_scrape_errors counter; gauges: cost_usd_24h{tenant}, tool_calls_24h{tool}, tokens_24h{direction}, repair_incidents_7d, process stats; contract locked by tests/security/metrics-endpoint-contract.test.ts (4/4 incl. mount-order-before-CSRF); (4) lite deploy profile .env.core.example — minimal env set to boot core chat+DB without the full provider fleet; (5) Mermaid architecture diagrams — docs/ARCHITECTURE_DIAGRAMS.md §7 Memory V2/MNEMA write path + §8 chunk-and-parallel orchestration. Gates: tsc 0, build 0, seam 67/67, smoke 20/20, wiring CLEAN, suite 119/0, architect FAIL (metrics 401-on-bad-token) → fixed → verified. _(model: anthropic/claude-opus-4)_",
          "R125+131 (2026-07-09) — GPT-5.6 Sol flagship promotion: gpt-5.6-sol (verified live vs api.openai.com /v1/models + a real completion) replaces gpt-5.5 as the OpenAI flagship across all active default picks (~28 files: moa FRONTIER_PROPOSERS/aggregator/polarity, auto-router rosters + OAUTH_MODELS + premium-throttle exclude, ceo-orchestrator, chat-engine, Slack pin, DEFAULT_LOCKED_FRONTIER, doc strings, landing Tier-1 copy). Registry entry + REPLIT_MODELFARM_UNSUPPORTED + alias/output/ctx-guard (1M) maps added; gpt-5.5 demoted to fallback and kept in the compat maps. Cost-safety intact: $0 policy still substitutes free gpt-5.4 outside the cost-exempt :flagship lane; data/model-tiers.json $0 frontier pin deliberately untouched. Gates: tsc 0, build 0, seam 67/67, suite 117/0, wiring CLEAN, smoke 20/20, architect FAIL→fixed (Slack pin + research doc default)→clean. _(model: anthropic/claude-opus-4)_",
          "R125+130 (2026-07-09) — Post-edit code-review sweep (whole-app + 72h + sensitive areas): 1 HIGH closed — cross-tenant SMS/WhatsApp pairing hijack: any tenant-agent could plant a messaging_pairing agent_knowledge row (mapping an inbound phone/channel → tenantId,conversationId) via create_knowledge or a category-PATCH and hijack another tenant's inbound messages. Closed at the storage chokepoint — storage.createKnowledge AND storage.updateKnowledge now fail closed (throw) on a reserved category unless allowReservedCategory:true (shared RESERVED_KNOWLEDGE_CATEGORIES, server/lib/reserved-knowledge-categories.ts; tool front-stop; twilio.ts read-side >1-tenant disambiguation). +3 MEDIUM — nudgeMemory (skill-synthesizer), research-engine knowledge/digest titles, and deliver_product now redact PII / fail-closed on a non-positive tenant. +1 CI guard — tests/security/reserved-knowledge-category-guard.test.ts (8/8). Gates: tsc 0, build 0, seam 67/67, wiring CLEAN, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+129 (2026-07-09) — Portable Evidence Docket: one reviewer-facing artifact bundling — for a (tenantId, conversationId/order) — goal contract(s) + completion-verification verdicts + jury κ + intent-gate/tool-block audit rows + delivery record + step-ledger replay pointer, so an external reviewer can audit a deliverable end-to-end. server/evidence-docket.ts + new tool generate_evidence_docket (delivery domain; policy sensitive/HIGH/requiresStructuredArgs). Tenant-scoped on EVERY query. Secret/PII hygiene: every free-text value + the inline CoVe payload + delivery links run through redactPiiForStorage; HTML esc()-escaped. Tools 395 → 396. Tests 15/15. Gates: tsc 0, seam 67/67, build 0, smoke clean, suite 0 fail, wiring 0 dead, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+128 (2026-07-08) — Browser-tool SSRF TOCTOU CLOSED (the 1 HIGH-graded DEFERRED from R125+127): attachSsrfRequestGuard(page) in server/browser-tool.ts — request interception inside the CDP session aborts literal private-IP hosts / blocked hostnames / non-http(s) schemes on EVERY request, and re-runs the full DNS-validated policy check on every NAVIGATION request (initial goto + each redirect hop + client-side navs; 30s per-hostname verdict cache). Navigations fail CLOSED on guard error, subresources fail open; attached at all 3 newPage sites + both getPageForSession reuse branches, WeakSet-idempotent. CI guard: tests/security/browser-ssrf-request-guard.test.ts (7 assertions). Gates: tsc 0, seam 67/67, suite 117 suites 0 fail, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+127 (2026-07-08) — Whole-app + 72h post-edit security review: 2 HIGH closed — (a) uploads cross-tenant read/enumeration (read_file/list_uploads: non-admin fs enumeration removed, tenant-ownership gate binds to canonical file_storage.filename+tenantId ONLY; /tmp/uploads realpath allowance aligned with its search root, symlink-reject first), (b) agent_knowledge PII-redaction bypass (8 raw INSERT sites in recurring-messages/cross-critique/skill-synthesizer/paper-ingest/research-engine now redact objects BEFORE stringify). +1 MEDIUM — Twilio webhook MessageSid replay dedupe (10-min TTL, post-signature). +2 CI guards. 1 HIGH-graded DEFERRED logged (browser-tool page.goto SSRF TOCTOU → closed in R125+128). Gates: tsc/build 0, seam 67/67, suite 0 fail, confirming architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+76 (2026-07-01) — Whole-app post-edit code review — 2 MEDIUM + 2 LOW closed fail-CLOSED in the deliverable-verifier + storage-redaction + memory-ranking surface. (1) server/deliverable-verifier.ts ran the requiredMimePattern check ONLY when a MIME could be inferred from the file extension, so a MIME-gated deliverable whose extension yielded no MIME slipped through as a PASS; an undeterminable MIME on a MIME-gated contract now fails CLOSED (verification FAILURE, not a silent PASS). (2) The verifier's best-effort audit-log write swallowed its failure while the result still returned as though the check were recorded; the result now carries an auditPersisted boolean (true on insert, false in the catch) so a swallowed persistence failure is visible instead of silently claimed (repudiation gap closed). (3) LOW — server/storage-helpers/pii-redaction-guard.ts returned the raw value on a non-string / empty input, breaking the declared redacted: string contract; it now coerces non-string input to a string. (4) LOW — a stale default-comment in server/memory-ranking.ts said the exploration bonus is OFF by default when the live default is ON (mode: 'bonus'); corrected. tsc 0, PII-guard tests 15/15, confirming architect PASS. No new declared tools/tables/personas/capabilities, no stat change. _(model: anthropic/claude-opus-4)_",
          "R125+75 (2026-06-29) — Whole-app + 72h post-edit code review (agent-wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap) — 3 pre-existing MEDIUMs closed fail-CLOSED in the tenant-isolation + silent-failure surface. (1) The central guarded-tool executor (server/guarded-tool-executor.ts) sourced its tenant from ctx.tenantId || args._tenantId, so a model-authored _tenantId in a tool's args could steer the execution tenant if a caller ever forgot ctx.tenantId; the fallback is removed so the tenant comes ONLY from the trusted ctx (every real caller sets it; lobster / plan-executor / task-planner don't route through here). (2) Both UPDATE event_log status writes in server/event-bus.ts (no_subscribers + routed) matched on the event id alone; both now carry an explicit tenant_id scope so a status write can't touch another tenant's row. (3) The failed-event UPDATE event_log SET status='failed' in server/heartbeat.ts had a bare empty catch that swallowed persistence failures (the event stayed pending and re-fired next tick with a misleading symptom) and matched on id alone; it now logs loud and is tenant-scoped. Live-stat resync to the database: tables 211→212, indexes 620→623. tsc 0, regression suites green, architect PASS. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+74 (2026-06-29) — Whole-app + 72h post-edit code review (4 parallel surface-split architect passes + wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap) — 1 MEDIUM closed, plus an owner-jury concurrency fix. MEDIUM — markdown injection in the failure contract: clampLine HTML-escaped only < and >, so untrusted approval-note / question / tool-error text could still inject INLINE markdown (links, images, emphasis, code, tables) when the failure block is rendered; a new mdEscape() backslash-escapes markdown special characters for all untrusted text fields (real artifact URLs pass mdSafe=false so they aren't mangled). Owner-jury metered ceiling concurrency: overlapping owner-initiated jury runs could each clear the daily-$ ceiling pre-check before any recorded spend; server/moa.ts now accrues a conservative per-run reservation when the metered override is granted and settles only the excess (additive ⇒ a throw mid-run fails SAFE / over-counts, self-heals on the daily roll). +3 regression tests (suites 9/9 and 7/7), tsc clean, confirming architect PASS. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+73 (2026-06-28) — Structured failure contract for terminal agentic failures (Forge re-review gap #2). A new pure renderer (server/agentic/failure-contract.ts) emits a consistent '✅ what completed / ❌ what failed (+why) / 📎 what exists now / 👉 exact next step (+owner)' markdown block plus structured meta, replacing bare operator error strings — wired into ALL terminal-failure exits: approval rejection + expiry (tenant-scoped, jsonb-merged into agentRuns.result.failureContract) and all four executor halts (wallclock / budget / stuck / max-turns). It deliberately does NOT auto-route around a rejected approval (that would weaken the AHB approval gate) — it only makes an already-decided failure legible. Defense-in-depth: clampLine HTML-escapes < and > on every field. 8/8 new unit tests, tsc exit 0, preflight clean; architect PASS twice. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+72 (2026-06-28) — Closed threat-model gap #1 (the gate-1 storage-boundary PII/secret redaction). A new central guard (server/storage-helpers/pii-redaction-guard.ts) composes the existing 48-pattern secret scanner and is wired into EVERY durable-store write path (createMemoryEntry/updateMemoryEntry, createKnowledge/updateKnowledge, createConversationFact) plus the one direct agent_knowledge insert in step-ledger.ts (rg-audited as the only write paths to those three tables). It ALWAYS strips credential-shaped secrets, Luhn-validated credit cards and US SSNs; email/phone are detected-only by default (legit CRM facts; opt-in stripping via redactContactInfo). Architect found + closed: a HIGH step-ledger direct-insert bypass, a MEDIUM unguarded update path, and a MEDIUM where string-redacting a JSON blob could corrupt it on a numeric-CC leaf (now redacts the OBJECT before JSON.stringify). Fresh dependency/SAST/HoundDog scans triggered ZERO new findings; threat_model.md AML.T0070 + LLM04 rows moved partial→covered. 15/15 unit tests, tsc exit 0, confirming architect PASS. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+67 (2026-06-26) — Whole-app + 72h code review: 2 multi-tenant HIGH closed, plus a heartbeat prod-isolation fix and a stats resync. HIGH #1 — lobster pause→resume dropped the invoker's identity: when an autonomous lobster workflow pauses for human approval and later resumes, it lost the original invoker's tenant and persona, so a non-admin launcher's post-approval steps ran as the admin/system-trusted identity (lobster's undefined invoker fails OPEN to the admin tenant, not closed); the fix persists invokerTenantId + invokerPersonaId in the paused state and restores them on resume, so resumed steps carry exactly the launcher's original authority. HIGH #2 — cross-tenant attachment restore: the attachment DB→disk restore path looked up file_storage by a user-derived filename with no tenant scope, so a crafted filename could read another tenant's stored file; the lookup is now scoped to the conversation's tenant. Plus the heartbeat self_initiative task is now prod-only (a shared-DB dev box no longer double-runs the prod-seeded row), and the landing-page + features-doc statistics were resynced to the live database. Architect post-fix pass PASS — 0 new CRITICAL/HIGH. No new declared tools/tables/personas/capabilities/skills. No stat change. _(model: anthropic/claude-opus-4)_",
          "R125+66 (2026-06-25) — Whole-app + 72h post-edit code review (clean) + a delivery-pipeline tenant-attribution telemetry fix. Four parallel architect passes (sensitive core / revenue + background / SSRF + delivery / frontend) over the last 72 hours returned PASS with 0 CRITICAL / 0 HIGH. The one delivery-cluster MEDIUM was verified a security FALSE POSITIVE — delivery assets are capability-gated at the /uploads middleware, not tenant-gated — and downgraded to a telemetry-accuracy LOW, then fixed: the delivery pipeline was stamping a hardcoded default tenant onto the signed download URL, both delivery-engagement events, and both publish-to-own-server callers; it now threads the real request tenant end-to-end so delivery telemetry and signed-URL scoping reflect the true tenant. Also resynced the live capabilities table count (126 → 128). typecheck + agent-wiring audit green. No new declared tools/tables/personas/capabilities/skills/workflows. _(model: anthropic/claude-opus-4)_",
          "R125+54 (2026-06-20) — Difficulty-adaptive UP-route: the AUTO path now escalates genuinely-hard requests to the high-end model instead of answering cheap-and-shallow — the mirror of the existing illusory-productivity down-route guard. The orchestration-efficiency guard already down-routed trivial requests away from the expensive heavy loop (arXiv:2605.22687); this round adds the opposite direction — when a request looks genuinely hard (complexity markers / length / cross-domain reasoning) but wouldn't otherwise trip the heavy ensemble, the AUTO path UP-routes it to the high-end model and tags the orchestration request_class='adaptive-hard-route', counted by a new upRouteCount metric on the Orchestration Efficiency card on /admin/ecosystem-health. ADVISORY + fail-open: it only ever shapes the AUTOMATIC route and never blocks or skips an explicit ensemble_query / jury_triage call; telemetry is fire-and-forget so it can never slow or throw into the chat hot path; the cost-exempt scoping of the sanctioned up-route is locked by a static regression test. Shipped behind a whole-app + 72h code review — two parallel architect passes (sensitive core + revenue/agentic/jobs), both PASS, 0 CRITICAL/HIGH/MEDIUM. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. A behaviour layer over the existing AUTO path — no new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+53 (2026-06-19) — Actor-Critic Reflection in the supervisor loop (Bob's idea): when an agent tries something, it fails, loops, retries and STILL spins with no success, the platform no longer just halts or blindly upgrades the model — a SECOND independent LLM (the critic-coach) reads the actual failed output, diagnoses WHY it failed, and hands targeted 'do this / don't repeat that' guidance back to the SAME primary loop for one more INFORMED retry, paired with a model escalation (the 'Combined' mode). The critic runs as an ISOLATED completion (reviewer-independence invariant — failed output passed as DATA, never by threading live conversation history); fails OPEN (any error/unparseable result falls through to the existing halt); a single decideStuckRecovery gate; escalation clamped at 2 and never downgrades. Shipped behind a whole-app + 72h code review — architect PASS, 0 CRITICAL/HIGH — that closed 2 MEDIUM: (1) a session-scoped pg_advisory_lock in auto-consolidation is now released in a finally block (gotLock-guarded, fail-soft) so it can never outlive the run and starve future tenant consolidation; (2) a stale '208 tables' → '210' corrected on the pricing + about pages. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. A behaviour layer over the existing loop — no new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+52.48+sec (2026-06-19) — Whole-app + 72h code review across two parallel architect passes (sensitive core + revenue engines/jobs) — architect PASS, 0 CRITICAL/HIGH/MEDIUM. Closed 1 LOW client information-leak: the AI Daily Briefing routes (server/routes/briefings.ts) returned raw server err.message text to the browser on 500 errors across 9 handlers; all nine now log the real error server-side and return a generic 'Internal server error', so internal database/provider detail can no longer leak to the client. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+52.47+sec (2026-06-18) — Whole-app + 72h code review (3rd pass): agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), typecheck + esbuild build green, targeted tests green. Closed 4 findings. (1) Cost-cap backstop — second_opinion + venture_discovery added to the dispatcher's HARDCODED_EXPENSIVE set so the per-call spend throttle still fires even if the rate-limiter config fails to load (defense-in-depth, MEDIUM). (2) Tenant isolation — auto-transcript.ts projects SELECT now scoped AND tenant_id=... with a fail-closed return, gating the downstream project_files writes against a poisoned conversation.project_id. (3) Fail-soft — the token-efficiency probe import in ecosystem-health.ts moved inside the per-probe try with a full-shape default so a probe-module load error degrades just that one card instead of throwing the whole /admin/ecosystem-health call. (4) Stat fix — audit.tsx founder quote 392 → 393 tools. Architect re-review PASS, preflight stale-strings CLEAN. _(model: anthropic/claude-opus-4)_",
          "R125+52.46 (2026-06-18) — Token Efficiency telemetry card on /admin/ecosystem-health (validation of microsoft/AI-Engineering-Coach concepts, NOT a code import). Three READ-ONLY per-request overhead metrics make wasted spend measurable instead of a vibe: (1) cache-hit starvation — cache-hit % on large (≥5000-token) prompts over 30 days from agent_cost_ledger (cached is a SUBSET of tokens_in), breached when sample≥20 ∧ hit<20%; (2) instruction bloat — the fixed system-prompt token tax measured live via buildSystemPrompt on a synthetic persona (bounded 3000ms, fail-soft); (3) MCP tool bloat — the serialized tool-catalog JSON token tax via getAllToolDefinitions. Tenant-scoped end to end (ledger SQL WHERE tenant_id; explicit tenantId into both fixed-overhead probes), degraded-over-healthy-zeros honesty, fail-soft (never throws). Purely additive — no writes, no schema change. Architect PASS (0 CRIT/HIGH); tsc + esbuild build green. _(model: anthropic/claude-opus-4)_",
          "R125+52.45+sec (2026-06-18) — Whole-app + 72h code review (architect PASS, 0 CRIT/HIGH): closed 2 MEDIUM + the 2 follow-on regressions the fixes spawned. (1) auto-transcript linked-conversation backfill SELECTed an always-NULL project_id and wrote NULL back over itself; now SELECTs the project_conversations project_id AND JOINs projects with a tenant guard so a poisoned cross-tenant link row can't stamp a foreign project onto a conversation. (2) the briefings widget/generate routes gained Zod validation, which then surfaced + fixed a 0-coordinate truthiness bug at both POST /generate guards (valid equator/prime-meridian 0/0 locations were being skipped) — switched to nullish checks. tsc green. _(model: anthropic/claude-opus-4)_",
          "R125+52.44+sec (2026-06-18) — Whole-app + 72h code review (architect PASS): found + fixed 2 HIGH in the Venture Discovery loop. (1) Settle-on-no-spend — live stages settled the budget reservation at the default estimate in a finally even when the paid call threw or fell back to deterministic ($0 real spend), burning a full stage's daily cap for nothing; now settle ONLY on a real completion and release the reservation otherwise. (2) Non-atomic stage advance — approveNextStage read-then-unconditionally-set 'running' let two concurrent approves double-execute a stage (dup budget + dup ideas/scores rows); a new atomic claim-CAS (WHERE id ∧ tenant_id ∧ observed status ∧ observed stage) makes the loser return stage_conflict. tsc green. _(model: anthropic/claude-opus-4)_",
          "R125+52.42 (2026-06-17) — Whole-app + 72h code review (architect PASS) hardened the new second_opinion / Fusion $25/day owner-only cost cap against cost-drift overshoot (architect HIGH → accepted LOW): (1) a deterministic worst-case reservation clamp floors every reservation at max(configured, ~$1.15) (capped in/out tokens × premium rates × a 10× panel→judge→synth multiplier) plus hard output-token / question-length caps; (2) a fail-closed cost-drift latch compares the REAL OpenRouter usage.cost vs reserved on every call and, on the first overshoot, trips an idempotent never-throws latch that disables BOTH the AUTO low-κ hook AND the on-demand path (unless ownerOverride) + pages the owner; (3) a dynamic reserve floor lifts each reservation to max(staticEstimate, MAX(real settled cost today)) so a drifted price can't be repeatedly under-reserved. +11 query-free guard tests (20/20). Known cosmetic doc-only MEDIUM: openrouter/fusion is unpriced in the registry so its ledger row reads $0 until a price is set — the cap math uses OpenRouter's returned usage.cost, not the registry price, so the cap is unaffected. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.41 (2026-06-16) — NEW Fusion second-opinion / cross-check (second_opinion tool, all 16 personas): on-demand + AUTO-fires from the native ensemble when low-confidence (κ<0.5 / single-proposer) BEFORE escalating to a human. Never-throws / fail-open; dedicated $25/day owner-only Fusion cap enforced by atomic reserve-then-settle under a per-tenant advisory lock (concurrent low-κ auto-calls can't all pass a stale read and overshoot), fail-CLOSED on reserve error, no recursion. Tools 391 → 392. Architect PASS (overshoot race closed, 0 security); +9 guard tests. _(model: anthropic/claude-opus-4)_",
          "R125+52.40 (2026-06-16) — Wired OpenRouter Fusion (openrouter/fusion, managed panel→judge→synthesize) as an OPTIONAL metered deep-research backend reference (NOT a core-path swap for native ensemble_query/jury) + an A/B harness (DRY by default; real cost from OpenRouter usage.cost). Registry id alone never auto-spends ($0 guard substitutes unless cost-exempt lane). Architect PASS (2 LOW). No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.39 (2026-06-15) — Whole-app + 72h post-edit code review (architect PASS, 0 CRITICAL/HIGH, agent-wiring audit exit 0). Silent-failure-hunter MEDIUM fixed in moa.ts: when caller-supplied proposer ids dedupe/blank-strip to an empty set, the multi-model jury now fails OPEN to the named pool / default constants (loud log naming the discarded ids) instead of running zero proposers + surfacing a misleading 'all proposers errored'; +4-assertion regression. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.38 (2026-06-15) — Closed the deferred SSRF DNS-rebinding TOCTOU in ssrf-jail: the high-risk public-fetch helper now PINS its socket to the exact IPs already validated at check-time (undici Agent overriding connect.lookup, preserving TLS SNI + Host header), dispatcher destroyed in finally, redirect:error retained. 7 SSRF tests pass. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.37 (2026-06-15) — Closed the completion-evaluator model-distinctness gap: the judge that decides a run is 'done' now runs on a model distinct from the worker set (the effective worker model is recorded at all four orchestration decision points), threading the real judge + a distinctness-collision flag into the verdict; still fails OPEN so a collision can never block a finished run. 41 tests pass. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.36 (2026-06-15) — Closed 2 deferred defense-in-depth gaps: (1) every ecosystem-health scalar probe now pushes a degraded marker so a failed probe renders an amber 'telemetry unavailable' banner instead of healthy-looking zeros; (2) all self-heal attempt UPDATEs now key on the creation-time tenant (cross-tenant guardrail, no silent no-op). No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.35 (2026-06-15) — Whole-app + 72h post-edit code review (architect PASS, 0 CRITICAL/HIGH/MEDIUM, wiring audit exit 0). Silent-failure-hunter MEDIUM fixed: the stale-approval expiry sweep is now per-row try/catch (loud) and throws on systemic all-failed breakage so the heartbeat cron surfaces it. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.34 (2026-06-15) — Mid-run budget-adaptive strategy controller: long orchestrations adapt strategy against the remaining-budget phase, converging toward completion instead of blindly spending — advisory + fail-open so it can never block a finished run. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.33 (2026-06-15) — Whole-app + 72h post-edit code review (architect PASS, agent-wiring audit exit 0). No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.32 (2026-06-15) — New `ponytail` engineering-discipline skill (gates against over-building; keeps changes minimal + scoped). +1 .agents skill (32 → 33 .agents; 132 → 133 reference surfaces); no new tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_",
          "R125+52.31 (2026-06-15) — New Harness Health card on /admin/ecosystem-health: surfaces the self-repair land-rate at the attempt grain (distinct from the incident-grain Self-Improvement card); blocked / no-fix attempts excluded from the land-rate math. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.30 (2026-06-14) — BWB weekly recap: an up-front narration-time FORECAST + a post-completion scene-image AUTO-CLEANUP, both fail-safe. No count changes. The recap now logs a per-scene + total narration-time forecast at planning time (and warns when the real ffprobe'd audio drifts >2s), and recursively deletes a recap's scene-image dir after delivery — gated on confirmed delivery success — so a prior week can't bleed into the next; a soft-failed run keeps its images for resume. tsc clean, unit tests green, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.29 (2026-06-14) — BWB weekly recap: Felix can now weave ANY named photo/asset Bob drops in the Drive folder into the recap via a new 'photos' param on bwb_weekly_build — auto-fetched, smart-matched (exact → stem → contains → token-subset), and fail-loud (listing available names) if the name isn't found, with no silent generic fallback. No count changes. tsc clean, 13/13 matcher tests, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.28 (2026-06-14) — BWB weekly recap: scene-image fingerprint hygiene + fail-loud missing-image guard. The render prunes stale / fingerprint-mismatched scene images before the bake loop (reuse gated on a prompt-sha256 fingerprint sidecar, so same-day re-runs can't jumble slides vs narration), and a declared-but-missing imagePath now FAILS LOUD instead of silently baking a generic substitute. No count changes. tsc clean, 10/10 fingerprint tests, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.27 (2026-06-14) — Whole-app + 72h post-edit code review: closed 1 MEDIUM (a regression in this delta) — operator-script path traversal in scripts/fetch-bwb-photo.ts (wrote to an env-supplied DEST with no root bound), now PHOTO_ROOT-anchored (rejects ..-escape / absolute / root-only, basename-only default, import.meta.url entrypoint guard) + a 5/5 regression suite. Agent-wiring audit exit 0. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.26 (2026-06-14) — Whole-app + 72h post-edit code review: closed 1 MEDIUM, downgraded+documented 1 HIGH, re-confirmed 1 deferred MEDIUM across the genuinely-unreviewed delta. No count changes. _(model: anthropic/claude-opus-4)_",
          "R125+52.25 (2026-06-13) — Whole-app code review: closed 2 HIGH + 2 MEDIUM (all cost-governance / isolation correctness; no new counts). HIGH#1 — MoA jury spend no longer pollutes the metered-Anthropic in-memory circuit breaker: a new costExempt flag threads recordCost → noteModelSpend (both moa.ts calls pass it) while the DB ledger toolName stays ensemble_query so the real 5× cost is still billed; only the breaker tally is corrected. HIGH#2 — the chat-engine final-guarantee guard now emits a deterministic non-empty fallback for the cold-empty (0 chars + 0 tool calls) autonomous-path case, so a background/scheduled/webhook turn can never persist a blank reply. MEDIUM ×2 — /api/experiments/run passes its admin tenant id (was a 500); two self-improvement reads reject 0/negative tenant ids. tsc clean, 26/26 cost-ledger tests, wiring audit exit 0, second architect pass PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.24 (2026-06-13) — Whole-app + 72h security review: closed 1 HIGH — the metered-Anthropic circuit breaker now fails CLOSED on a guard/import error instead of proceeding UNCAPPED (jury/flagship lanes exempt, graceful reroute on the throw) — plus a fail-closed tenant guard centralized across the chat workspace-context reads (rejects null/0/negative tenant ids). No new tools/tables/personas. tsc clean, build green, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.23 (2026-06-13) — Real tool-output-compressor savings now tracked on live traffic: new tool_compression_stats table (daily per-tenant rollup) records the type-aware compressor's REAL bill-impact, surfaced honestly (savings vs the OLD head-slice baseline, never vs raw) as a card on /admin/ecosystem-health. +1 table, +1 index. tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.22 (2026-06-13) — Whole-project code review closed 3 live cross-tenant read leaks: chat-engine workspace context was injecting ALL tenants' uploaded filenames + active-project names/customer/description into the prompt; a self-improvement experiments SELECT was category-only — both now tenant-scoped, fail-closed; deleted dead never-mounted chat scaffolding that hardcoded tenant 1. tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.21 (2026-06-13) — Reusable verification + stop-condition prompt clauses baked into every deliverable plan (ground all numbers/claims/quotes in real tool data, stop exactly at the format's required gates, no scope creep). tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_",
          "R125+52.20 (2026-06-12) — NEW FEATURE: live Instant AI Readiness Audit at /audit — public POST /api/public/audit/run fetches a visitor-supplied site and returns a scored report /100 (AI Access / Structured Data / Metadata / Social / Technical → grade A–F + recommendations, persisted to audit_reports). SECURITY: pinned a DNS-rebinding SSRF TOCTOU via an undici connect.lookup override (re-pinned every redirect hop). _(model: anthropic/claude-opus-4)_",
          "R125+52.19 (2026-06-12) — BWB weekly recap kept on Claude Opus 4.8 + made breaker-safe via a dedicated flagship cost lane so a tripped breaker can't silently downgrade or drop it. _(model: anthropic/claude-opus-4)_",
          "R125+38+sec (2026-06-06) — Full-app + 72h post-edit code review (2 parallel architect passes by surface + agent-wiring audit GREEN at 391 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN): 1 HIGH + 2 MEDIUM closed, 1 FALSE POSITIVE. HIGH — the architect-incident-backtest CLI relied on a never-throwing aggregator so a DB error returned an empty result and the CLI reported the all-clear 'no incidents' exit instead of failing; an opt-in throwOnError channel now surfaces DB errors to the CLI (exit 1) while preserving never-throw for the dashboard card. MEDIUM ×2 — the self-improvement metrics entry now rejects a non-positive tenant id before any query; the public-API live-data fetch helper replaced redirect-follow + post-hoc host check with a bounded manual-redirect loop that re-validates host + resolved IP + https before every hop (max 4). FALSE POSITIVE — the CI self-healer's execSync env inheritance is trusted internal tooling that needs its secrets; the untrusted sandbox path spawns no child processes. tsc clean; public-api + self-improvement tests pass; stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_",
          "R125+38 (2026-06-06) — New Self-Improvement Loop metric (Anthropic 'When AI builds itself'-inspired; 0 new tools/tables): a read-only, tenant-scoped aggregator computes self-repair catch-rate (resolved/total), escalation rate, fail-closed safety-hold count, per-classification blind spots, and a 30d-vs-prior-30d trend over the most recent 500 incidents in the real repair_incidents ledger, anchored to the essay's ~1/3 automated-catch benchmark. Surfaced as a new Self-Improvement Loop card on /admin/ecosystem-health (mirrors the Orchestration Efficiency card) plus an operator-runnable backtest script. Verdict on the essay: thesis-validation of the recursive-self-improvement stack (CI Self-Healer + architect review + jury-decides-and-ships), not code to import. tsc clean; build clean. _(model: anthropic/claude-opus-4-8)_",
          "R125+37 (2026-06-06) — New generate_design_doc(url) tool (refero.design-inspired, no external dependency; tools 390 → 391): fetches a page's HTML + up to 3 same-origin CSS files through the SSRF jail (https-only, private/metadata/loopback blocked, redirect-error, size + time caps), strips scripts/comments, FENCES the untrusted payload (raw HTML never returned to the caller), then runs one balanced-tier LLM pass that synthesizes a structured DESIGN.md: color roles + relationships, type scale, spacing rhythm, component patterns, voice, and reuse do/don'ts. Never-throws; optional persist writes project-assets/design-docs/<host>-DESIGN.md. Wired across all 5 registration points and surfaced to all 16 personas; new 3-test suite. tsc clean; build clean. _(model: anthropic/claude-opus-4-8)_",
          "R125+36+sec (2026-06-05) — Full-app + 72h post-edit code review (architect pass + confirming re-pass + agent-wiring audit GREEN at 390 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN): 2 HIGH + 2 MEDIUM closed. HIGH ×2 — the Guarded Repo Surgeon's source-reader used an inline require('node:fs') that throws in the ESM build, silently disabling its source-reading path (replaced with a top-level import); and a public-facing tool-count drift (R125+35 bumped 384 → 390 but left current-state counts at 384 across index.html / seo-head / landing / about / pricing / audit) was resynced to 390 with historical per-round snapshots preserved. MEDIUM ×2 — the public-API live-data pack host-locked the request but never validated the RESOLVED IP (added a fail-closed resolve-and-check guard pre-fetch and post-redirect); and the model-client resolver missed OpenRouter-style prefixed ids so ~7 callers silently fell through to the Anthropic default (added a guarded prefix-strip re-lookup that only fires when the stripped id exists in the registry). tsc clean; preflight CLEAN; public-api 7/7. _(model: anthropic/claude-opus-4-8)_",
          "R125+35 (2026-06-05) — Agenvoy-inspired public-API live-data pack: 6 free, no-auth, read-only public-data tools wired to all 16 personas (tools 384 → 390), each behind the platform's SSRF guard, per-tool rate ceilings, and a host allowlist — live reference data inline for every persona with no third-party billing dependency (own the workflow, not just the model). tsc clean; build clean. _(model: anthropic/claude-opus-4-8)_",
          "R125+31+sec2 (2026-06-04) — Follow-up full-app + 72h post-edit review (4 parallel architect passes + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan/schema-gap): 1 MEDIUM closed (Guarded Repo Surgeon autofix HITL gate widened to the broad aggregator modules — routes/tools/chat-engine/auth/guarded-executor — so an opt-in autofix touching them pauses for owner sign-off; monotonic fail-safe; 22/22 tests) + 2 FALSE POSITIVES; tsc clean, preflight CLEAN, wiring audit exit 0; stats unchanged. _(model: anthropic/claude-opus-4-8)_",
          "R125+31+sec (2026-06-04) — Full-app + 72h post-edit review (5 parallel architect passes + wiring audit + confirming re-pass): 1 HIGH + 1 MEDIUM closed, loop-until-clean PASS — autonomous skill-build jury fail-CLOSED restored (an errored juror's ABSTAIN no longer counts toward quorum) + streaming tool-call merge fix; honesty fix documenting the 7-day effective delivery-link ttl; tsc clean, AHB 52/52. _(model: anthropic/claude-opus-4-8)_",
          "R125+30 (2026-06-03) — Full-app + 72h post-edit review (3+1 parallel architect passes + wiring audit GREEN): 2 HIGH + 1 MEDIUM closed, all pre-existing — customer delivery-email signed-link corruption, skillify now sanitizes + length-caps LLM-distilled text before the global skill registry, browser SSRF IPv6 link-local + multicast parity; tsc clean. _(model: anthropic/claude-opus-4-8)_",
          "R125+29 (2026-06-03) — Full-app + 72h post-edit review (4 parallel architect passes + wiring audit GREEN): illusory test-coverage closed (3 model-tier suites imported vitest and silently never ran; node:test shim added, 64 assertions now run in CI) + 3 fail-closed hardenings (skill-build approval predicate, signed order-page app-play link, model-tier refresh fails closed on a corrupt overlay); indexes resynced 554→557. _(model: anthropic/claude-opus-4-8)_",
          "R125+28 (2026-06-03) — Every skill-enable path (automatic capture AND the manual skillify tool) now funnels through one 3-frontier-model jury gate at a single insert chokepoint, no human review queue; the 'only a BUILD verdict inserts' rule is one exported tested predicate (skillBuildApproved, 19 tests). _(model: anthropic/claude-opus-4-8)_",
          "R125+27 (2026-06-03) — Jury-gated autonomous skill build: a strict 2-of-3 frontier-model jury decides and ships agent-authored skill proposals (no human review queue); the untrusted proposal body is injection-defanged before the jury sees it; 16 unit tests. _(model: anthropic/claude-opus-4-8)_",
          "R125+26 (2026-06-03) — Ranking-driven model auto-adoption: the weekly Model Tier Refresh promotes the top-K closed (frontier) + open-weight LLMs by Artificial Analysis intelligence index into the routable OpenRouter overlay and retires stale auto-ranked entries; per-entry fail-CLOSED matching, atomic overlay write, fail-OPEN orchestration; 20 unit tests. _(model: anthropic/claude-opus-4-8)_",
          "R125+25 (2026-06-02) — Full-app + 72h post-edit review (4 parallel architect passes; 0 CRITICAL / 3 HIGH / 2 MEDIUM; wiring audit GREEN): tool-block telemetry redactor now masks secret-like keys BEFORE the length-truncation branch so a long token can't leak its prefix into a security_tool_blocks audit row (exported + 5-case test); 2 HIGH + 2 MEDIUM deferred as tracked dormant gaps. _(model: anthropic/claude-opus-4-8)_",
          "R125+24 (2026-06-02) — Agentic efficiency awareness (arXiv:2605.22687 AI-dependence-loop): new orchestration_efficiency table records predicted-vs-actual time/cost of every orchestration + assessHeavyLoopWorth() cheap no-LLM advisory fail-open guard that can down-route a trivially-doable AUTO-ensemble request but NEVER an explicit jury/ensemble call + Orchestration Efficiency card on /admin/ecosystem-health; +1 table (188→189), +2 indexes. _(model: anthropic/claude-opus-4-8)_",
          "R125+23 (2026-06-02) — Full-app + 72h post-edit review (4 parallel architect passes + silent-failure lens + confirming pass): 0 CRITICAL / 3 HIGH / 6 MEDIUM, 3 fixed fail-closed — wired assertProjectInTenant/assertConversationInTenant at the 3 LLM-reachable project-scoped INSERT sites it had missed (create_slides + both mpeg-engine project_files writes), providers.ts invalid-prefix warning no longer logs the decrypted key prefix, and a new idx_agent_knowledge_tenant_source index for the paper-ingest idempotency query; tsc clean, AHB 52/52, wiring audit GREEN (384 tools, 0 dead/drift/orphan/schema-gap). _(model: anthropic/claude-opus-4-8)_",
          "R125+22 (2026-06-01) — Full-app + 72h post-edit review (3 parallel architect passes + confirming pass): 0 CRITICAL / 0 HIGH / 5 MEDIUM, 2 fixed fail-closed — Repo Surgeon attempt-ledger reads now return the cap on DB-read failure so the two-failed-attempts stop + hourly rate cap can't silently reset, and bwb-render-github gh() fetch wrapped in an AbortController timeout so a stalled socket can't hang the unattended weekly cron render; MEDIUM-only ⇒ no +sec bump, stats unchanged. _(model: anthropic/claude-opus-4-8)_",
          "R125+21 (2026-06-01) — Resume & reconstitution — repair, don't re-run: new server/agentic/pipeline-checkpoint.ts persists each stage/unit's output durably so a retry reuses every finished artifact and repairs only the first incomplete unit, wired end-to-end on the BWB weekly recap (re-bake only the dead scene images, no duplicate project_files row, no re-email on resume); new table pipeline_stage_artifacts (186→187). _(model: anthropic/claude-opus-4-8)_",
          "R125+20 (2026-06-01) — Guarded Repo Surgeon code-fix executor: new server/agentic/repo-surgeon.ts takes a routed code_defect, writes a minimal diff, verifies for real (typecheck → targeted tests → opt-in golden-path replay → re-run the failed tool) and lands green or rolls back, with 3 fail-closed invariants (never weaken a guard, owner-HITL for auth/payments/schema/safety, durable two-failed-attempts stop); new table repo_surgeon_attempts (185→186). _(model: anthropic/claude-opus-4-8)_",
          "R125+19 (2026-06-01) — Full-app + 72h post-edit review (3 parallel architect passes + confirming pass): 5 MEDIUM closed, 0 HIGH/CRITICAL — silent-failure regressions fixed fail-closed (drive-discover/bwb-render-github ffprobe sentinels → NaN, wake-scheduler recovery .catch sets failed=true), /api/store/checkout Zod-gated, upload-signing TTL clamped ≤7d; tsc clean, AHB pass, wiring audit exit 0, stats unchanged. _(model: anthropic/claude-opus-4-8)_",
          "R125+16 (2026-05-31) — Chief-of-Staff jury access + trusted-tool wiring leak closed. New per-tool extraAllowedPersonas allowlist grants a specific persona a trusted tool without widening the global trust tier; first use wires jury_triage (the 3-frontier-model 2-of-3 vote) to the Chief of Staff persona, closing the last trusted-tool wiring leak the agent-wiring audit had flagged (leaks 1→0). Verified: AHB regression 50/50, tsc clean, preflight stale-strings CLEAN, agent-wiring audit exit 0, architect PASS. All platform stats UNCHANGED. (model: anthropic/claude-opus-4-8)",
          "R125+15 (2026-05-31) — TigrimOSR-inspired blackboard multi-agent coordination, built by EXTENDING the existing parallel findings bus (0 new tools, 0 new tables). On parallel_job_findings: keyed shared-state SLOTS (latest-wins via DISTINCT ON) so parallel agents can read each other's most-recent state + atomic work-CLAIMS (exactly one winner per tenant+job+slot, enforced by partial unique index idx_pjf_claim WHERE claim=true) so two agents never grab the same chunk. findings_publish/findings_read gained slot_key/claim/mode:\"board\"; claim rows excluded from discovery reads. Verified: 12/12 blackboard tests (incl. 5 tool-surface), AHB 47/47, tsc clean, preflight CLEAN, architect PASS (the one blocking finding fixed). Adds +1 index (541→542); all other stats UNCHANGED. (model: anthropic/claude-opus-4-8)",
          "R125+14+sec4 (2026-05-31) — Full-app + 72h + GitHub-system post-edit review (4 parallel architect passes + focused 2nd pass on the fix delta): chargeTaskForce → single atomic conditional UPDATE (fail-closed money; closes debit-then-check overspend + read-then-write race); heartbeat backup git-push execSync→spawnSync argv + GITHUB_REPO regex + exit-code handling; held-out-eval-gate env enforce → before/after hooks. Quality: closed 3 deferred test-coverage gaps (render-farm dispatch SSRF/bound guards, drive-discover parseClipDate, task-force budget cap — 31 new unit tests) + cleared 2 live CI issues. tsc clean, AHB 47/47, held-out-eval 14/14. Stats unchanged. (model: anthropic/claude-opus-4-8)",
          "R125+14+sec3 (2026-05-31) — Built With Bob brand-voice lock: resolveBriefVoiceLock forces Bob's Fish clone + strictVoice ON when bwbBrand (escape hatch BWB_VOICE_OVERRIDE_OK=1); a Fish failure FAILS the render instead of cascading to a non-brand voice. Weight-stat resync to confirmed 504 start / 236 lost / 268 current. tsc clean, preflight CLEAN, architect PASS. Stats unchanged. (model: anthropic/claude-opus-4-8)",
          "R125+14+sec2 (2026-05-30) — Full-app + 72h pre-publish code review (3 parallel architect passes) + fixes: yt-dlp spawnSync env sanitized (RCE surface closed); negative/non-finite guards on budget + task-force money args; parameterized stale-interval SQL; client-facing 500 error-message leaks removed; new tool bwb_weekly_build (383→384). tsc clean, AHB 47/47. (model: anthropic/claude-opus-4-8)",
          "R125+14 (2026-05-30) — Autonomous Corporate Operations: 12 new tools + 4 new tables across seven self-managing capabilities (OKR review cadence wired to the heartbeat, durable sleep/wake schedules, departmental budget enforcement, continuous mid-plan replanning, an A/B→Stripe→SOP optimization loop, an LLM-free Process Reward Model scoring every step, scoped task-forces) + R125+14+sec1 security/correctness pass (fail-closed project/conversation tenant-ownership guards, FOR UPDATE row-lock fix for the A/B-event race, per-department cost attribution).",
          "R116 (2026-05-18) — rohitg00/agentmemory Tier-A nugget bundle (5 nuggets in one round). N2 — per-category Ebbinghaus decay: added memory_entries.last_reinforced_at + memory_categories.half_life_days; ranker now decays facts at per-category rates (architecture decisions 90d, transient bugs 3d) on the same path. N6 — active contradiction resolver: NEW server/lib/contradiction-resolver.ts scores candidates 0.45×authority + 0.30×recency (20d e-fold) + 0.25×log-normalized support × confidence; hooked into MoA κ-low escalation as fail-OPEN belt-and-suspenders. N7 — heuristic quality_score gate: NEW server/lib/quality-score.ts grades every queue-routed memory write 0..1 on length+token+terminator+repetition+printable+source-class+confidence-cap; folded multiplicatively into ranker so malformed-but-confident facts get down-ranked. N9 — MCP memory scope: 4 new MCP tools (memory_smart_search / memory_save / memory_supersede / memory_list_recent) + 2 new scopes (memory:read / memory:write), all fail-CLOSED on missing scope. N14 — typed edge taxonomy: memory_links.confidence + source_count + DB CHECK constraint enforcing link_type ∈ {uses, depends_on, contradicts, caused, fixed, supersedes, related} + coerceLinkType fallback guard. Schema deltas via psql ALTER: tables 174→176, indexes 454→507, MCP scopes 3→5, MCP tools 8→12 (external surface; internal TOOL_DEFINITIONS unchanged at 357). Architect round 1 caught a memory_supersede orphan bug (UPDATE flipped old row even when enqueueMemoryFact rejected) → fixed same round, 5-test pin added. Architect round 2 (cross-app sweep) found 2 MEDIUMs + 1 LOW, all closed same round: (M1) memoryEntrySafeCols projection in server/storage.ts omitted lastReinforcedAt + qualityScore so ranker fell back to defaults on chat retrieval — fixed by adding both cols. (M2) MoA resolver pre-pass inert at MoA call site (homogeneous proposers) but real value at memory-contradiction sites — documented inline, leave wired (fail-OPEN). (L1) getLinkedMemories not tenant-parameterized — fixed by making tenantId: number | null REQUIRED. Wiring verified clean: 4 MCP tools live at POST /mcp (external surface, NOT in internal 357 TOOL_DEFINITIONS); internal personas continue via recall_memory → vectorSearchMemory and transparently benefit from R116 ranker enhancements; verify-agent-wiring CLEAN (0 dead / 0 drift / 0 trusted-leaks). 26/26 R116 tests PASS. tsc CLEAN, preflight CLEAN.",
          "R98.26.6 — Post-edit code-review hardening pass: 2 HIGH + 4 MEDIUM + 1 LOW closed (pass-2 architect ran clean). HIGH: Slack workspace allowlist (SLACK_ALLOWED_TEAM_ID / _ENTERPRISE_ID / _APP_ID, fails CLOSED when configured, fails OPEN with one-time warning when unset, called after signature verify and before rate-limit/ack/dispatch on both /api/slack/commands and /api/slack/events). HIGH: gpt-5.1 stripped from 5 live LLM callsites in server/tools.ts (run_supervisor writer/analyst/critic/router + commit_decision) — same Unknown-model class as the R98.26.1 hotfix. MEDIUM: 3 frontend gpt-5.1 defaults swept in settings.tsx + chat.tsx. MEDIUM: sanitizeLlmError extended with xapp- (Slack app token), whsec_ (Stripe webhook secret), and SDK shapes err.response.data.message + err.error.details; length cap applied LAST so secrets are redacted before truncation. MEDIUM: the tenant-namespace prefix mirror-leak-verifier exemption tightened from broad regex to strict numeric a strict numeric tenant-ID format with optional persona segment.",
          "R98.26.5 — Public-mirror CI all-green sweep: 4 of 5 hard gates were RED (TypeScript / Build / Docker smoke / Security & Tenant-Isolation Tests). Fixed wellness→wellness file-rename gap in stage-2 sed scrub, noImplicitAny on new inline arrow callback, missing lookupProduct/listSkus/getPublicCatalog stubs, seed-catalog-files.ts exit-2 on empty CATALOG, two stub SKUs the mirror tests assert exist, and a self-trip on a proprietary literal inside an explanatory comment. CI run 25490224844: all 5 jobs green.",
          "R98.26.4 — Cleanup batch: stale gpt-5.1 schema defaults swept across conversations + agent_settings; in-process per-channel Slack rate limiter (6/min, 60/hour) on both /commands and /events; mpim group DM accepted; runLlmTask/runLlmTextTask error sanitizer (sanitizeLlmError) strips URLs, API keys (sk-, sk-ant-, GitHub PAT, Slack xox*, Google AIza, AWS AKIA, Stripe sk_/rk_, Bearer), IPv4+port, IPv6, absolute filesystem paths (Linux/macOS/Windows), length-caps to 500.",
          "R98.26.3 — DM (Chat-tab) support: message event handler with channel_type === 'im' filter (excludes bot-authored messages and message subtypes to prevent reply loops). DMs route to Felix by default or to a named persona if the first word matches the known set. Channel @mention and Chat-tab DM both reply within ~10s in prod.",
          "R98.26.2 — Deployment migration: original Autoscale was killing setImmediate background dispatch after res.send() — Slack ack returned 200 but the LLM call was terminated mid-flight. Migrated to Reserved VM (gce). Initial Reserved VM crash-looped because ~50s of synchronous seeding ran before port 5000 opened → Replit health check killed the container. Fix in server/index.ts: in production only, bind port 5000 immediately after setupAuth, then continue async seeding; late listenWithRetry guarded with if (!httpServer.listening). Custom domain agenticcorporation.net re-attached after the deployment-type swap.",
          "R98.26.1 — Hotfix: first prod @mention surfaced empty [slack] dispatch error {} — log shipper serialized Error to {}. Replaced with explicit e?.message / e?.code / e?.stack[0..5] unwrap. Real cause: conversations.model schema default gpt-5.1 is NOT in MODEL_REGISTRY. Fix: pin Slack-created conversations to a registered model.",
          "R98.26 — Hyperagent parity sweep: three visible-gap closures vs hyperagent.com. (1) Slack invocation surface: POST /api/slack/commands (slash command), POST /api/slack/events (URL verification + app_mention + message.im DM + mpim group DM), GET /api/slack/health; HMAC-SHA256 v0 signature verify with 5-min window and timingSafeEqual; persona resolution: first token matches known set → routes there, else default Felix; replies truncated to 3500 chars, threaded for channel mentions, un-threaded for DMs. (2) Per-agent cost dashboard at /admin/persona-cost: 7/30/90d aggregates over agent_activity grouped by persona_id (activity counts, conversation counts, success rate, total wall-clock minutes, est. cost — powerful $0.030/min, balanced $0.010/min, fast $0.005/min); admin-gated, tenant-scoped, 60s refetch. (3) Agents gallery enrichment on landing: invocation-channels strip (Chat · Slack · Email · MCP · Scheduled/cron · REST API).",
          "R98.20 — CI concurrency group on .github/workflows/ci.yml; cancel-in-progress collapses one-per-job email noise to one transient per supersession.",
          "R98.19+sec — Whole-app code review sweep, six bugs closed including five silent-bypass HIGH security primitives caused by a recurring require()-under-ESM bug class (provider-error redaction, gate_command stdout fence, wrapAsData fence builder, presenter constant-time HMAC compare, Claude-importer prompt-injection scanner).",
          "R98.19 — Memory v2: confidence-scored facts (0.0-1.0 + source enum), 30s debounced write queue, synthesis-time substring + Jaccard ≥0.8 dedup, 8K-token cap on recall context. All 16 personas re-seeded.",
          "R98.18+sec — Self-healing maintenance sweep: drizzle-orm 0.39 → 0.45 (closed SQL-injection HIGH GHSA-gpj5-g38j-94v9), xlsx removed entirely (HIGH Prototype Pollution + ReDoS, no upstream fix) with the runtime call site migrated to exceljs + RFC 4180 CSV escaping, health-monitor ALERT_THRESHOLD 2 → 3.",
          "R98.17 — Cairo Cross-Pollination: 4-tier risk-class taxonomy on TOOL_POLICIES, hard kill switch (file-backed atomic JSON, <2s halt), MC-1 chat-vs-background slot reservation.",
          "R98.16 + +sec + +wiring + +sec-2 — IJFW Cross-Pollination: run_command (#296) with large-output sandbox, wave-table parallelism on plan_deliverable, translateLlmError 13-family error UX, DeepSeek as fourth architect lineage, sanitizeUntrusted defang, atomicWriteFileSync at 6 critical sites, six whole-app architect findings closed.",
          "R98.14 — Felix Deliverable Reliability Plan COMPLETE: durable resumable long-video jobs, nightly Golden Path Replay with freeze-on-drift, learn_from_reference (SSRF-jailed YouTube/web URL → 3-8 concrete copyable patterns), quality-instinct cards (8 formats × 8-11 checkable rules each).",
          "R98.13 — plan_deliverable prompt→pipeline router for 10 formats + grade_deliverable vision/audio quality grader (0-100 with bounded auto-revise).",
          "R98.12 — verify_delivery_proof refuse-to-declare-done gate + build_html_app single-file utilities + record/recall_strategic_wins positive-exemplar memory.",
        ],
      },
      {
        title: "Platform Architecture (current state)",
        bullets: [
          "16-persona AI corporation with LLM-powered CEO (Felix) + CTO (Forge) + 14 specialists.",
          "AsyncLocalStorage tenant context end-to-end through every authenticated path for accurate per-tenant cost attribution.",
          "Multi-layered Adversarial Humanities Benchmark (AHB) defense: per-persona safety_profile, destructive-tool policy (fail-closed), 158 security tests across 16 files in 6 categories.",
          "Memory v2 (R98.19): confidence-scored facts + debounced queue + Jaccard dedup + 8K token cap on recall.",
          "Aggressive parallel orchestration: up to 8 parallel agents; chunk-and-parallel pattern splits long jobs into ≤5-min units to fit Replit Temporal StartToClose timeout.",
          "Deterministic deliverable pipelines: 10 formats with vision/audio quality grading, bounded auto-revise, refuse-to-declare-done gates.",
          "Instant-play media delivery: purpose-built /uploads/delivery-N-filename streaming routes — bypasses Google Drive 5-30 min video transcoding delay.",
          "Self-maintaining platform (R97): weekly auto-maintenance cron (npm audit + outdated + SAST + transitive-CVE + prod schema parity + Railway health + model SDK currency).",
          "Camofox stealth-browser microservice (R96) for hard-blocked sites with universal-recall escalation ladder.",
        ],
      },
      {
        title: `Complete Tool Inventory (${toolNames.length} tools)`,
        content:
          "Every tool registered in the live TOOL_DEFINITIONS table, alphabetized. Felix uses this list as his canonical capability map.",
        bullets: toolBullets,
      },
      {
        title: `Complete Skills Inventory (${skillNames.length} skills in DB)`,
        content:
          "Every skill currently registered in the skills table (62 entries). A separate count of 33 lives on disk under .agents/skills/ — these are agent operating runbooks, not user-runnable AI skills. Both numbers are canonical; surfaces should mention all three as 33 (.agents) + 62 (DB) + 38 (output-skills) = 133 reference surfaces.",
        bullets: skillNames.length
          ? skillNames
          : ["_skills table currently empty — see .agents/skills/ on disk for the 31 agent operating runbooks_"],
      },
      {
        title: `Persona Roster (${personas.length} active)`,
        table: {
          headers: ["ID", "Name", "Role"],
          rows: personas.map((p) => [String(p.id), String(p.name || ""), String(p.role || "")]),
        },
      },
      {
        title: "Operations & Reliability",
        bullets: [
          "Auto Git Push workflow: 90s quiet timer + secret-scanner; private repo Huskyauto/VisionClaw-Agent.",
          "Public Mirror Push workflow: sanitizes (strips EIN, address, phone, internal SKUs, Drive file IDs, secret patterns) + force-pushes to Huskyauto/VisionClaw-Agent-Public-Release + syncs GitHub About sidebar via PATCH API.",
          "Agentic CI Self-Healer: polls GitHub Actions every 120s, auto-fixes red CI runs.",
          "Golden Path Replay: nightly canonical-prompt regression suite with freeze-on-drift + email-on-regression; soft cost cap $1/run.",
          "Load Test Layer 1: tiers 10 / 50 / 100 / 250 concurrent against agenticcorporation.net.",
          "Weekly Maintenance: 7-day cadence; npm + SAST + CVE + prod-DB parity + Railway health + model SDK currency → triaged email to owner.",
          "Health Monitor: 5-min interval, alert threshold 3 (R98.18+sec), 30-min cooldown + off-hours skip.",
          "Tool Smoke-Test & Documentation Program (in progress: 40 / 394 tools, 2 / 20 stages signed off): a staged end-of-session program that smoke-tests and documents every one of the 394 tools — 20 stages of 20 (107 live-safe / 287 doc-only; doc-only tools are NEVER auto-invoked). Each work session advances exactly ONE stage at $0 / no LLM / no tenant (server/tools.ts is parsed statically, never imported), so coverage climbs steadily without a marathon. Driver scripts/tool-smoke-test.ts; plan + safety rules docs/tool-smoke-test/SCHEDULE.md.",
        ],
      },
      {
        title: "Security & Governance",
        bullets: [
          "41 governance rules covering tool risk classes (LOW/MEDIUM/HIGH/CRITICAL), HITL approval flows, tenant-isolation invariants, SSRF jail (CGNAT 100.64.0.0/10, multicast, IPv6, ::ffff: IPv4-mapped, .internal/.cluster.local/.svc TLDs), outbound redaction.",
          "Hard kill switch: file-backed atomic JSON at data/system-state.json, 5s in-memory cache, atomic write + fsync; <2s halt of all background work.",
          "MC-1 Gate: chat reserves 3 slots; background tasks blocked when chat saturated AND background ≥75% utilized.",
          "HMAC-SHA256 hashed auth secrets; AES-256-GCM encryption at rest for sensitive credentials.",
          "Constant-time HMAC compare on /api/presenter (R98.19+sec restored).",
          "Prompt-injection scanner on every persona/mind/imported-Claude-agent body. R98.19+sec tightened importer scanner from false-fail-closed to true fail-closed quarantine.",
          "Per-tenant hourly escalation quota (20/hr) prevents one noisy tenant from draining platform escalation budget.",
        ],
      },
      {
        title: "Company",
        bullets: [
          "[Your Company]",
          "EIN: [YOUR-EIN]",
          "[Your City, State]",
          "Owner: Bob Washburn",
          "Email: huskyauto@gmail.com",
          "Production URL: https://agenticcorporation.net",
          "QR Code asset (Drive file ID): REDACTED_DRIVE_FILE_ID",
        ],
      },
    ];

    const pdfRes = await generateStyledPdf({
      title: "VisionClaw Agent Platform",
      subtitle: `Comprehensive Features — ${today}`,
      companyLines: [
        "[Your Company] | EIN: [YOUR-EIN]",
        "Owner: Bob Washburn | [Your City, ST]",
        "https://agenticcorporation.net | huskyauto@gmail.com",
      ],
      coverStats: stats,
      sections,
      footerLines: ["VisionClaw — Autonomous AI operations, built for real work."],
      orientation: "portrait",
      fileName: `VisionClaw-Comprehensive-Features-${today}.pdf`,
      folderLabel: "Platform Documentation",
      uploadToDrive: true,
    });
    if (!pdfRes.success || !pdfRes.viewUrl) {
      console.error("PDF_FAILED:", JSON.stringify(pdfRes));
      process.exit(1);
    }
    console.log(
      "PDF_RESULT:",
      JSON.stringify({ ok: true, viewUrl: pdfRes.viewUrl, fileId: pdfRes.fileId, size: pdfRes.size }),
    );

    // Build companion text file
    const txtLines: string[] = [];
    txtLines.push("================================================================");
    txtLines.push(`VISIONCLAW AGENT PLATFORM — COMPREHENSIVE FEATURES — ${today}`);
    txtLines.push("================================================================");
    txtLines.push("");
    txtLines.push("[Your Company] | EIN: [YOUR-EIN] | [Your City, ST]");
    txtLines.push("Owner: Bob Washburn | huskyauto@gmail.com");
    txtLines.push("Production: https://agenticcorporation.net");
    txtLines.push("QR Code: https://agenticcorporation.net  (Drive asset REDACTED_DRIVE_FILE_ID)");
    txtLines.push("");
    txtLines.push("-- LIVE STATS ---------------------------------------------------");
    for (const s of stats) txtLines.push(`  ${s.label.padEnd(22)} ${s.value}`);
    txtLines.push("");
    for (const sec of sections) {
      txtLines.push("");
      txtLines.push(`## ${sec.title}`);
      txtLines.push("-".repeat(64));
      if (sec.content) {
        txtLines.push(sec.content);
        txtLines.push("");
      }
      if (sec.bullets) for (const b of sec.bullets) txtLines.push(`  • ${b}`);
      if (sec.table) {
        txtLines.push("  " + sec.table.headers.join(" | "));
        txtLines.push("  " + sec.table.headers.map((h: string) => "-".repeat(h.length)).join("-+-"));
        for (const r of sec.table.rows) txtLines.push("  " + r.join(" | "));
      }
    }
    txtLines.push("");
    txtLines.push("================================================================");
    txtLines.push("END OF DOCUMENT");
    txtLines.push("================================================================");

    const snapshotDir = `/home/runner/workspace/docs/snapshots`;
    fs.mkdirSync(snapshotDir, { recursive: true });
    const txtPath = `${snapshotDir}/VisionClaw-Comprehensive-Features-${today}.txt`;
    fs.writeFileSync(txtPath, txtLines.join("\n"));

    let txtRes: any;
    try {
      txtRes = await uploadAndShare({
        filePath: txtPath,
        fileName: `VisionClaw-Comprehensive-Features-${today}.txt`,
        description: "VisionClaw Agent Platform — Complete Feature Document (Text)",
        folderLabel: "Platform Documentation",
        share: true,
      } as any);
    } catch (e: any) {
      console.error("TXT_UPLOAD_FAILED:", e?.message || e);
      process.exit(2);
    }
    console.log("TXT_RESULT:", JSON.stringify({ viewUrl: txtRes.viewUrl, fileId: txtRes.fileId }));

    // Register both in project_files for Felix (project 15). project_files schema
    // has file_url, NOT file_path; no tenant_id column.
    try {
      await db.execute(sql`
        INSERT INTO project_files (project_id, file_name, file_url, file_type, file_size, uploaded_by)
        VALUES
          (15, ${`VisionClaw-Comprehensive-Features-${today}.pdf`}, ${pdfRes.viewUrl}, 'application/pdf', ${pdfRes.size || 0}, 'VisionClaw Agent'),
          (15, ${`VisionClaw-Comprehensive-Features-${today}.txt`}, ${txtRes.viewUrl}, 'text/plain', ${fs.statSync(txtPath).size}, 'VisionClaw Agent')
        ON CONFLICT DO NOTHING
      `);
      console.log("REGISTERED: project_files project_id=15");
    } catch (e: any) {
      console.warn("REGISTER_WARN:", e?.message);
    }

    if (process.env.FEATURES_SKIP_EMAIL === "1") {
      console.log("EMAIL_SKIPPED (FEATURES_SKIP_EMAIL=1)");
    } else {
      try {
        const inboxResult: any = await getOrCreateTenantInbox(1);
        const inboxId =
          typeof inboxResult === "string"
            ? inboxResult
            : inboxResult.inboxId || inboxResult.email;
        const ownerEmail = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";
        const emailBody = [
          `Hi Bob,`,
          ``,
          `The updated VisionClaw Comprehensive Features document is ready in two formats. Both are live in Google Drive — open either link in any browser or device.`,
          ``,
          `📄 PDF (styled, dark gradient cover, stats grid, branded sections):`,
          `   ${pdfRes.viewUrl}`,
          ``,
          `📝 Text (Felix's machine-readable knowledge base — same exhaustive content):`,
          `   ${txtRes.viewUrl}`,
          ``,
          `Both files include latest releases, live stats (${HEADLINE_STATS.tools} tools, ${HEADLINE_STATS.skills} skills, ${HEADLINE_STATS.personas} personas, ${HEADLINE_STATS.capabilities} active capabilities, ${HEADLINE_STATS.tables} tables, ${HEADLINE_STATS.indexes} indexes, ${HEADLINE_STATS.governance} governance rules), the complete tool inventory (all ${toolNames.length} live tools by name), the persona roster, and ops/security sections.`,
          ``,
          `GitHub:`,
          `  • Private: https://github.com/Huskyauto/VisionClaw-Agent`,
          `  • Public:  https://github.com/Huskyauto/VisionClaw-Agent-Public-Release`,
          ``,
          `— VisionClaw`,
        ].join("\n");

        await sendEmail({
          inboxId,
          to: ownerEmail,
          subject: `VisionClaw Updated Features — PDF + Text (${today})`,
          text: emailBody,
        } as any);
        console.log("EMAIL_SENT:", ownerEmail);
      } catch (e: any) {
        console.error("EMAIL_FAILED:", e?.message || e);
        process.exit(3);
      }
    }

    console.log("");
    console.log("==== FINAL LINKS ====");
    console.log("PDF:  " + pdfRes.viewUrl);
    console.log("TXT:  " + txtRes.viewUrl);
    process.exit(0);
  } catch (e: any) {
    console.error("PIPELINE_ERROR:", e?.stack || e?.message || e);
    process.exit(4);
  }
})();
