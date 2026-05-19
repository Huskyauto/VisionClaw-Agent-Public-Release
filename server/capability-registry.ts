/**
 * Capability Registry — single source of truth for what this system can do.
 *
 * Why this file exists:
 *   The platform has grown to 14+ agents, ~40 event types, multiple
 *   webhooks, ~10 integrations, and several fulfillment paths.
 *   Knowledge of "what exists" was scattered across routes.ts,
 *   delivery-pipeline.ts, research-engine.ts, event-bus.ts, the
 *   integrations folder, and Bob's head. That scattering is exactly
 *   what causes the "absent-minded rebuilding" problem — the planner
 *   (Minerva) cannot route work to capabilities it doesn't know exist.
 *
 * Two layers:
 *   1. This file is the SOURCE OF TRUTH (typed, code-reviewed).
 *      Anyone adding a new agent / event / webhook / integration /
 *      fulfillment path / tool MUST register it here in the same PR.
 *   2. On boot, syncCapabilities() upserts everything below into the
 *      `capabilities` table. The DB row is the QUERYABLE SURFACE that
 *      Minerva (and the dashboard) read at runtime. Anything in the
 *      table that isn't in this file gets is_active=false marked.
 *
 * Adding a capability = add an entry below + restart. That's it.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { getEventTypes } from "./event-bus";

export type CapabilityKind =
  | "agent"
  | "event"
  | "webhook"
  | "integration"
  | "fulfillment"
  | "route"
  | "tool";

export interface CapabilityRecord {
  kind: CapabilityKind;
  name: string;
  category?: string;
  description: string;
  codePath?: string;
  codeSymbol?: string;
  metadata?: Record<string, any>;
}

// =============================================================================
// AGENTS — the 15 personas that actually do work
// Names must match personas.name in the DB exactly (case-sensitive).
// =============================================================================
const AGENTS: CapabilityRecord[] = [
  { kind: "agent", name: "VisionClaw",      category: "general",     description: "General AI assistant; default fallback chat persona.",                                  codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[VisionClaw]" },
  { kind: "agent", name: "Felix",           category: "leadership",  description: "CEO; sole decision-maker for plans, approvals, escalations. Owner-mirror.",            codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Felix]" },
  { kind: "agent", name: "Forge",           category: "engineering", description: "Staff engineer; scaffolds, builds, refactors code in the customer-facing product.",   codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Forge]" },
  { kind: "agent", name: "Teagan",          category: "marketing",   description: "Content marketing strategist; tone, audience, distribution plan.",                    codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Teagan]" },
  { kind: "agent", name: "Agent Blueprint", category: "operations",  description: "Multi-agent system operator; designs and oversees agent crews.",                       codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Agent Blueprint]" },
  { kind: "agent", name: "Chief of Staff",  category: "operations",  description: "Operations director; final-mile delivery to customer (email + Drive).",                codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Chief of Staff]" },
  { kind: "agent", name: "Scribe",          category: "content",     description: "Long-form writer; reports, whitepapers, documentation, marketing copy.",               codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Scribe]" },
  { kind: "agent", name: "Proof",           category: "qa",          description: "Content reviewer + QA; verifies deliverables meet success criteria before shipping.",  codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Proof]" },
  { kind: "agent", name: "Radar",           category: "research",    description: "Surface-scan intelligence analyst; quick-turn fact gathering and scope clarification.", codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Radar]" },
  { kind: "agent", name: "Neptune",         category: "research",    description: "Deep research specialist; long-running multi-source investigations.",                  codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Neptune]" },
  { kind: "agent", name: "Apollo",          category: "sales",       description: "Revenue & pipeline manager; outreach, sequences, deal-stage progression.",             codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Apollo]" },
  { kind: "agent", name: "Atlas",           category: "analytics",   description: "Metrics & reporting analyst; dashboards, KPIs, performance summaries.",                codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Atlas]" },
  { kind: "agent", name: "Cassandra",       category: "finance",     description: "CFO; cash-flow, pricing, unit economics, budget gates.",                                codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Cassandra]" },
  { kind: "agent", name: "Luna",            category: "legal",       description: "Legal & compliance officer; contracts, ToS, privacy review.",                          codePath: "server/seed.ts", codeSymbol: "DEFAULT_PERSONAS[Luna]" },
  { kind: "agent", name: "Minerva",         category: "planning",    description: "Chief planner; converts objectives into structured plans for Felix to decide on.",     codePath: "server/minerva-planner.ts", codeSymbol: "createPlan / decidePlan" },
];

// =============================================================================
// WEBHOOKS — inbound HTTP endpoints that listen to external systems
// =============================================================================
const WEBHOOKS: CapabilityRecord[] = [
  { kind: "webhook", name: "stripe",      category: "payment", description: "Stripe webhook: checkout.session.completed, invoice.*, subscription.*. Drives delivery pipeline.", codePath: "server/webhookHandlers.ts", codeSymbol: "handleStripeWebhook" },
  { kind: "webhook", name: "coinbase",    category: "payment", description: "Coinbase Commerce webhook: charge:confirmed, charge:failed. Crypto checkout path.",                  codePath: "server/coinbase-commerce.ts", codeSymbol: "verifyCoinbaseSignature" },
  { kind: "webhook", name: "agentmail",   category: "email",   description: "AgentMail inbound email webhook; routes replies into agent conversations.",                          codePath: "server/routes.ts", codeSymbol: "POST /api/webhooks/agentmail" },
  { kind: "webhook", name: "x_mentions",  category: "social",  description: "X (Twitter) mention notifications; tracked separately via polling, not push webhook.",               codePath: "server/x-monitor.ts", codeSymbol: "pollXMentions" },
];

// =============================================================================
// INTEGRATIONS — third-party services this system can call out to
// =============================================================================
const INTEGRATIONS: CapabilityRecord[] = [
  { kind: "integration", name: "openai",          category: "llm",      description: "OpenAI GPT-4o, GPT-4o-mini, o1, o3 for reasoning + writing.",       codePath: "server/llm.ts", metadata: { secretKey: "OPENAI_API_KEY" } },
  { kind: "integration", name: "anthropic",       category: "llm",      description: "Anthropic Claude Sonnet, Opus, Haiku for reasoning + writing.",      codePath: "server/llm.ts", metadata: { secretKey: "ANTHROPIC_API_KEY" } },
  { kind: "integration", name: "gemini",          category: "llm",      description: "Google Gemini Pro / Flash for multimodal + long-context tasks.",     codePath: "server/llm.ts", metadata: { secretKey: "(replit-managed)" } },
  { kind: "integration", name: "xai",             category: "llm",      description: "xAI Grok models for reasoning + realtime web context.",               codePath: "server/llm.ts", metadata: { secretKey: "XAI_API_KEY" } },
  { kind: "integration", name: "openrouter",      category: "llm",      description: "OpenRouter aggregator; DeepSeek, Qwen, Llama, Kimi, GLM, Nemotron.", codePath: "server/llm.ts", metadata: { secretKey: "OPENROUTER_API_KEY" } },
  { kind: "integration", name: "elevenlabs",      category: "voice",    description: "ElevenLabs TTS for voice synthesis.",                                  codePath: "server/elevenlabs.ts", metadata: { secretKey: "ELEVENLABS_API_KEY" } },
  { kind: "integration", name: "stripe",          category: "payment",  description: "Stripe payments, subscriptions, Connect, Customer Portal.",            codePath: "server/stripeClient.ts", metadata: { secretKey: "STRIPE_LIVE_SECRET_KEY" } },
  { kind: "integration", name: "coinbase",        category: "payment",  description: "Coinbase Commerce + CDP for crypto checkout.",                         codePath: "server/coinbase-commerce.ts", metadata: { secretKey: "COINBASE_COMMERCE_API_KEY" } },
  { kind: "integration", name: "google_drive",    category: "storage",  description: "Google Drive uploads for customer deliverables.",                      codePath: "server/replit_integrations", metadata: { connector: "google-drive" } },
  { kind: "integration", name: "google_mail",     category: "email",    description: "Gmail send + read via Replit connector.",                              codePath: "server/replit_integrations", metadata: { connector: "google-mail" } },
  { kind: "integration", name: "google_sheets",   category: "data",     description: "Google Sheets read/write for ops dashboards.",                         codePath: "server/replit_integrations", metadata: { connector: "google-sheet" } },
  { kind: "integration", name: "google_calendar", category: "calendar", description: "Google Calendar read/write for scheduling.",                           codePath: "server/replit_integrations", metadata: { connector: "google-calendar" } },
  { kind: "integration", name: "onedrive",        category: "storage",  description: "Microsoft OneDrive uploads (alternate to Drive).",                     codePath: "server/replit_integrations", metadata: { connector: "onedrive" } },
  { kind: "integration", name: "x_api",           category: "social",   description: "X (Twitter) v2 API: post, mentions, reply, like, retweet, search.",   codePath: ".agents/skills/x-api", metadata: { secretKey: "X_API_KEY" } },
  { kind: "integration", name: "browserless",     category: "browser",  description: "Browserless for headless browser automation + PDF rendering.",         codePath: ".agents/skills/browserless-pdf", metadata: { secretKey: "BROWSERLESS_API_KEY" } },
  { kind: "integration", name: "firecrawl",       category: "scraping", description: "Firecrawl for clean web scraping and crawl jobs.",                    codePath: "(server-side scraping)", metadata: { secretKey: "FIRECRAWL_API_KEY" } },
];

// =============================================================================
// FULFILLMENT PATHS — end-to-end pipelines that take a trigger and ship to a customer
// =============================================================================
const FULFILLMENT_PATHS: CapabilityRecord[] = [
  { kind: "fulfillment", name: "service_product_delivery", category: "delivery", description: "Stripe checkout → service_orders row → QA + admin review → auto-ship → delivery.completed event.", codePath: "server/delivery-pipeline.ts", codeSymbol: "processServiceOrder" },
  { kind: "fulfillment", name: "research_report_$49",     category: "delivery", description: "$49 research report on-demand: Neptune deep research → Scribe write → PDF → Drive upload → Gmail.",  codePath: "server/research-report-fulfillment.ts", codeSymbol: "fulfillResearchReport" },
  { kind: "fulfillment", name: "minerva_plan_loop",       category: "planning", description: "Minerva creates plan → plan.proposed wakes Felix → Felix decides → on approve, downstream agents execute.", codePath: "server/minerva-planner.ts", codeSymbol: "createPlan + decidePlan" },
  { kind: "fulfillment", name: "research_program_eval",   category: "research", description: "Autoresearch loop: experiment → judge or cost-eval → ±% baseline → safe-apply with verifier.",            codePath: "server/research-engine.ts", codeSymbol: "runExperiment" },
];

// =============================================================================
// R106 — LuaN1aoAgent reflexive operating primitives (Apache-2.0). Five new
// capabilities wired across all 16 personas via PLATFORM_TOOLS_CONTRACT.
// =============================================================================
const R106_PRIMITIVES: CapabilityRecord[] = [
  { kind: "fulfillment", name: "failure_attribution_l0_l5", category: "reflection", description: "R106 N1 — Strict-progressive L0–L5 failure attribution; reflector reads recent attributions and decides RETRY / FIX_PREREQ / BACKOFF / REGENERATE_PLAN / ESCALATE_HITL. ≥3 consecutive L4s auto-promote to strategic L5.", codePath: "server/lib/failure-attribution.ts", codeSymbol: "recordAttribution + decideNextAction" },
  { kind: "fulfillment", name: "parallel_findings_bus", category: "orchestration", description: "R106 N2 — Sibling chunk-and-parallel subtasks share high-confidence findings mid-flight via parallel_job_findings (append-only, tenant-scoped, 0.6 confidence floor for sibling visibility).", codePath: "server/lib/parallel-findings-bus.ts", codeSymbol: "publishFinding + readFindings" },
  { kind: "fulfillment", name: "near_miss_grading", category: "quality", description: "R106 N3 — grade_deliverable surfaces nearMissDimension + nearMissNote when a failed deliverable scored within 7 points of the bar. Steers auto-revise to the highest-leverage fix instead of regenerating from scratch.", codePath: "server/deliverable-grader.ts", codeSymbol: "deriveNearMiss" },
  { kind: "fulfillment", name: "pinned_hypotheses", category: "memory", description: "R106 N4 — Load-bearing hypotheses survive chat-engine context compression. Auto-injected into system prompt under 'Pinned hypotheses (must survive context compression)' block. Default 4h TTL.", codePath: "server/lib/pinned-hypotheses.ts", codeSymbol: "pinHypothesis + renderPinnedBlock" },
  { kind: "fulfillment", name: "plan_on_graph", category: "planning", description: "R106 N5 — Plans modelled as DAGs with structured ADD_NODE / UPDATE_NODE / DEPRECATE_NODE edits. Topological readiness (ready[] / blocked[] / completed[] / failed[]) drops out for free; underlying primitive for parallel orchestration. Auto cycle-check on every batch.", codePath: "server/lib/plan-graph.ts", codeSymbol: "applyPlanEdits + queryPlan" },
  { kind: "fulfillment", name: "page_context_injection", category: "context", description: "R106.3 (kite-org/kite cross-pollination, Apache-2.0) — Frontend chat surface auto-sends current route + best-effort recordType/recordId; chat-engine sanitizes (allowlisted record types, route + id regex, fixpoint instruction-prefix strip) and injects into finalSystemPrompt so the executor default-scopes unscoped questions. Tenant isolation + RBAC still enforced at the storage layer. Fail-open.", codePath: "server/lib/page-context.ts", codeSymbol: "sanitizePageContext + renderPageContextBlock" },
  { kind: "fulfillment", name: "memory_geometry_probe", category: "memory", description: "R107 N1 — Pure-math helpers (computeClusterGeometry + pairRegime) computing mean within-cluster cosine distance d̄ and participation-ratio dimension d_eff for any cluster of memory embeddings. Underlies the R107 regime-aware consolidation gate. Vangara & Gopinath 2026 'The Geometry of Consolidation' (MIT, niashwin/geometry-of-consolidation).", codePath: "server/lib/memory-geometry.ts", codeSymbol: "computeClusterGeometry + pairRegime" },
  { kind: "fulfillment", name: "regime_aware_consolidation_gate", category: "memory", description: "R107 N2 — Dedup decisions in memory-intelligence.resolveMemoryActions and pair-merge decisions in dream-consolidation.findDuplicateCandidates now consult the geometry probe; pairs in the SPREAD regime (d̄ ≥ θ') are kept distinct rather than merged under a centroid that would force identity collapse. Fail-open: missing embeddings fall through to legacy dedup.", codePath: "server/memory-intelligence.ts + server/dream-consolidation.ts", codeSymbol: "resolveMemoryActions + findDuplicateCandidates" },
  { kind: "fulfillment", name: "memory_geometry_audit", category: "memory", description: "R107 N3 — Agent-callable memory_geometry_scan tool samples a tenant's active embeddings (optionally per persona/wing/category), computes cluster geometry, and surfaces SPREAD-regime would-be-merge pairs at risk of silent identity collapse. Each scan is persisted to memory_geometry_audits for trend analysis.", codePath: "server/tools.ts (case 'memory_geometry_scan')", codeSymbol: "memory_geometry_scan" },
  { kind: "fulfillment", name: "adaptive_plan_node_budgets", category: "planning", description: "R108 A (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — plan_graph_edit ADD_NODE / UPDATE_NODE accept an optional `maxSteps` int (1-200) per node. Hard nodes (multi-stage retry, blind exploration) get a larger budget than the orchestrator default; easy nodes get tighter ones. plan_graph_query surfaces each node's maxSteps so orchestrators can honor it.", codePath: "server/lib/plan-graph.ts", codeSymbol: "applyPlanEdits + queryPlan" },
  { kind: "fulfillment", name: "causal_evidence_edges", category: "reasoning", description: "R108 B (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — hypothesis_attach_evidence + hypothesis_evidence_chain tools + hypothesis_evidence_edges table. Each pinned hypothesis can carry a directed evidence chain (memory_entry / finding / tool_result / free_text) with per-edge confidence. Top-3 evidence edges auto-render under each hypothesis in the system-prompt block so the executor sees the grounding without an extra tool call. Forces personas to ground load-bearing claims rather than assert them.", codePath: "server/lib/pinned-hypotheses.ts (attachEvidence + listEvidence)", codeSymbol: "attachEvidence + listEvidence + renderPinnedBlock" },
  { kind: "fulfillment", name: "cold_start_hypothesis_nudge", category: "context", description: "R108 C (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — chat-engine injects a one-line nudge into the system prompt when a complex task (≥300 chars OR planning-keyword) arrives with ZERO pinned hypotheses for the conversation. Steers personas toward hypothesis_pin + hypothesis_attach_evidence at task start instead of blind exploration.", codePath: "server/chat-engine.ts", codeSymbol: "coldStartNudge" },
  { kind: "fulfillment", name: "pre_delivery_secret_scan", category: "security", description: "R110 +sec (elementalsouls/Claude-OSINT 48-pattern catalog, MIT) — fail-CLOSED structural gate in delivery-pipeline.attemptUpload() that scans every primary + bundle file for 48 credential-shaped secret patterns (AWS / GCP / GitHub / Stripe live / Anthropic / OpenAI / ElevenLabs / Slack / SendGrid / Twilio / Discord / Telegram / npm / PyPI / Docker / all PEM private-key armor / JWT / Basic-Auth URLs / generic api_key) BEFORE Drive upload. CRITICAL or HIGH hits abort the upload, alert owner, and surface a structured error. The same scanner runs ingest-side in validateUploadedFile() to reject leaked keys in customer uploads, and is exposed agent-callable as scan_for_secrets (Felix/Forge/Robert call it explicitly before deliver_product on code-bearing artifacts). Pure-stdlib, sub-second, no LLM. Closes the gap that env-driven redactSecrets() cannot — it can only mask values present in process.env, not hardcoded keys Felix invents on the fly.", codePath: "server/lib/secret-scan.ts + server/delivery-pipeline.ts (scanDeliverablesForSecrets) + server/routes.ts (validateUploadedFile) + server/tools.ts (case 'scan_for_secrets')", codeSymbol: "scanForSecrets + scanFileForSecrets + redactSecretsByPattern" },
];

// =============================================================================
// TOOLS — internal capabilities the LLM can dispatch as function calls
// =============================================================================
const TOOLS: CapabilityRecord[] = [
  { kind: "tool", name: "web_search",      category: "research",  description: "Web search via Firecrawl/Perplexity for real-time information.",        codePath: "server/tool-dispatcher.ts" },
  { kind: "tool", name: "create_memory",   category: "memory",    description: "Persist a memory record for an agent.",                                  codePath: "server/tool-dispatcher.ts" },
  { kind: "tool", name: "search_memory",   category: "memory",    description: "Semantic search over an agent's memory store.",                          codePath: "server/tool-dispatcher.ts" },
  { kind: "tool", name: "send_email",      category: "comms",     description: "Send email via Gmail connector.",                                        codePath: "server/tool-dispatcher.ts" },
  { kind: "tool", name: "drive_upload",    category: "storage",   description: "Upload a file to Google Drive and return shareable link.",               codePath: "server/tool-dispatcher.ts" },
  { kind: "tool", name: "post_x",          category: "social",    description: "Post a tweet on X.",                                                     codePath: ".agents/skills/x-api" },
  { kind: "tool", name: "render_pdf",      category: "documents", description: "Render HTML to PDF via Browserless.",                                    codePath: ".agents/skills/browserless-pdf" },
  { kind: "tool", name: "llm_task",        category: "llm",       description: "Delegate an arbitrary prompt to a chosen LLM provider.",                 codePath: "server/llm.ts" },
  { kind: "tool", name: "code_proposal",   category: "engineering", description: "Generate a unified-diff code proposal for an autoresearch experiment.", codePath: "server/research-engine.ts" },
  { kind: "tool", name: "verify_proposal", category: "engineering", description: "Shadow-apply a proposal + tsc --noEmit; refuses to apply if verification fails.", codePath: "server/proposal-verifier.ts" },
  { kind: "tool", name: "cost_eval",       category: "research",  description: "Run frozen 20-query cost-eval suite, return totalCostUsd + judgeScoreAvg.", codePath: "server/cost-eval-runner.ts" },
  { kind: "tool", name: "create_plan",     category: "planning",  description: "Ask Minerva to compose a plan for an objective; emits plan.proposed.",   codePath: "server/minerva-planner.ts", codeSymbol: "createPlan" },
  // R85/R88/R89 — Hermes Alpha agent-callable tools
  { kind: "tool", name: "scan_for_prompt_injection", category: "security",  description: "Scan untrusted text (web fetches, files, third-party output) for prompt-injection threats BEFORE feeding it to another LLM. Returns findings + a treat-as-data summary.", codePath: "server/prompt-injection-scanner.ts", codeSymbol: "scanContextContent" },
  { kind: "tool", name: "get_usage_analytics",        category: "analytics", description: "Per-tenant usage analytics over the last N days: sessions, messages, tokens, cost USD, model breakdown, tool histogram, hour-of-day + day-of-week activity, top sessions.",   codePath: "server/insights-engine.ts",          codeSymbol: "getUsageInsights" },
  { kind: "tool", name: "compress_context",           category: "memory",    description: "Compress a long conversation by keeping head + tail and summarizing the middle through a cheap auxiliary model. Repairs orphan tool_call/tool_result pairs.",                  codePath: "server/context-compressor.ts",       codeSymbol: "compressMessages" },
  { kind: "tool", name: "monid_discover",             category: "discovery", description: "Search Monid catalog (hundreds of paid agentic web/data endpoints) BEFORE writing a scraper or saying 'I can't access that'.",                                              codePath: "server/lib/monid.ts",                codeSymbol: "monidDiscover" },
  { kind: "tool", name: "monid_inspect",              category: "discovery", description: "Read a Monid endpoint's input schema + pricing before running it. Never guess parameter shape.",                                                                            codePath: "server/lib/monid.ts",                codeSymbol: "monidInspect" },
  { kind: "tool", name: "monid_catalog_browse",       category: "discovery", description: "FREE local browse of curated VCA-fit Monid endpoints by category (no API call). Recognize what's available before paying for monid_discover. Snapshot in data/monid/catalog-curated.json.", codePath: "server/tools.ts",                    codeSymbol: "executeTool:monid_catalog_browse" },
  { kind: "tool", name: "monid_run",                  category: "discovery", description: "Execute a Monid endpoint with structured input. PAID per call — only after discover+inspect.",                                                                              codePath: "server/lib/monid.ts",                codeSymbol: "monidRun" },
  { kind: "tool", name: "scan_for_secrets",           category: "security",  description: "R110 +sec — Scan text or a file for credential-shaped secrets using the 48-pattern catalog. Returns hits[] with severity + line/col + masked preview + shouldBlock verdict. Call BEFORE deliver_product on code-bearing artifacts; pre-delivery gate runs it fail-CLOSED automatically.", codePath: "server/lib/secret-scan.ts", codeSymbol: "scanForSecrets + scanFileForSecrets" },
  // R114 — AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821)
  { kind: "tool", name: "aevo_meta_editing",          category: "governance", description: "R114 — AEvo Meta-Editing of Procedure Context. Meta-agent proposes minimal surgical edits to output-skill playbooks under data/output-skills/ based on accumulated evidence (agent_trace_spans + delivery_verifications + grade_deliverable, ≥3 rows). HITL-gated, CAS sha256-pinned, rollback-capable. Edit-surface allowlist HARDCODED to 'output_skill' only; forbidden-pattern catalog fails CLOSED on safety_profile / intentGate / restrictedCategories / destructiveToolPolicy / refusalCopy / AHB regression / .agents/skills/ / TOOL_POLICIES / doctrine markers / persona souls. Six tools: propose_procedure_edit, list_procedure_edits, approve_procedure_edit, reject_procedure_edit, apply_procedure_edit (destructive HIGH + requiresApproval), rollback_procedure_edit (destructive HIGH + requiresApproval).", codePath: "server/lib/aevo-meta-editor.ts", codeSymbol: "proposeProcedureEdit + applyProcedureEdit + rollbackProcedureEdit" },
];

/** All static capabilities except `event` (events come from event-bus at runtime). */
export const STATIC_CAPABILITIES: CapabilityRecord[] = [
  ...AGENTS,
  ...WEBHOOKS,
  ...INTEGRATIONS,
  ...FULFILLMENT_PATHS,
  ...R106_PRIMITIVES,
  ...TOOLS,
];

/** Build the full registry, pulling EVENT capabilities live from event-bus. */
export function buildFullRegistry(): CapabilityRecord[] {
  const eventCaps: CapabilityRecord[] = getEventTypes().map((e) => ({
    kind: "event",
    name: e.name,
    category: e.category,
    description: e.description,
    codePath: "server/event-bus.ts",
    codeSymbol: `EVENT_TYPES["${e.name}"]`,
  }));
  return [...STATIC_CAPABILITIES, ...eventCaps];
}

/**
 * Sync the static + event registry into the `capabilities` table.
 * Anything in the table not present in the source-of-truth gets
 * is_active=false (soft-deleted, never destroyed — preserves audit).
 */
export async function syncCapabilities(): Promise<{ upserted: number; deactivated: number }> {
  const all = buildFullRegistry();
  // Capture a SQL-side run marker BEFORE upserting. Anything whose
  // last_seen_at is strictly less than this value at the end of the run
  // was not touched by this sync and is soft-deactivated. This replaces
  // the earlier 30-second wall-clock window, which could falsely
  // deactivate rows on slow runs (>30s upsert loop) — race-free now.
  const runMarkerR: any = await db.execute(sql`SELECT CURRENT_TIMESTAMP AS ts`);
  const runStartedAt: string = (runMarkerR.rows ?? runMarkerR)[0].ts;

  let upserted = 0;
  for (const cap of all) {
    await db.execute(sql`
      INSERT INTO capabilities (kind, name, category, description, code_path, code_symbol, metadata, is_active, last_seen_at, created_at, updated_at)
      VALUES (${cap.kind}, ${cap.name}, ${cap.category ?? null}, ${cap.description}, ${cap.codePath ?? null}, ${cap.codeSymbol ?? null}, ${JSON.stringify(cap.metadata ?? {})}::jsonb, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (kind, name) DO UPDATE SET
        category = EXCLUDED.category,
        description = EXCLUDED.description,
        code_path = EXCLUDED.code_path,
        code_symbol = EXCLUDED.code_symbol,
        metadata = EXCLUDED.metadata,
        is_active = true,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `);
    upserted++;
  }

  // Soft-deactivate anything not refreshed by this run.
  const r: any = await db.execute(sql`
    UPDATE capabilities
    SET is_active = false, updated_at = CURRENT_TIMESTAMP
    WHERE last_seen_at < ${runStartedAt}
      AND is_active = true
    RETURNING id
  `);
  const deactivated = (r.rows ?? r).length;
  return { upserted, deactivated };
}

/** Query helpers for Minerva and the dashboard. */
export async function listCapabilities(opts?: { kind?: CapabilityKind; activeOnly?: boolean }): Promise<any[]> {
  const kind = opts?.kind ?? null;
  const activeOnly = opts?.activeOnly !== false; // default true
  const r: any = await db.execute(sql`
    SELECT id, kind, name, category, description, code_path, code_symbol, metadata, is_active, last_seen_at
    FROM capabilities
    WHERE ${activeOnly ? sql`is_active = true` : sql`true`}
      AND ${kind ? sql`kind = ${kind}` : sql`true`}
    ORDER BY kind, category NULLS LAST, name
  `);
  return r.rows ?? r;
}

export async function getCapabilityStats(): Promise<Array<{ kind: string; active_count: number; total_count: number }>> {
  const r: any = await db.execute(sql`
    SELECT kind,
           COUNT(*) FILTER (WHERE is_active) AS active_count,
           COUNT(*) AS total_count
    FROM capabilities
    GROUP BY kind
    ORDER BY kind
  `);
  return (r.rows ?? r).map((row: any) => ({
    kind: row.kind,
    active_count: Number(row.active_count),
    total_count: Number(row.total_count),
  }));
}

/** Roster shape Minerva uses to compose plans (replaces hardcoded constants). */
export interface MinervaRoster {
  agents: Array<{ name: string; category: string; description: string }>;
  tools: Array<{ name: string; category: string; description: string }>;
  integrations: Array<{ name: string; category: string; description: string }>;
}

export async function getMinervaRoster(): Promise<MinervaRoster> {
  const all = await listCapabilities({ activeOnly: true });
  const map = (kind: string) =>
    all
      .filter((c) => c.kind === kind)
      .map((c) => ({ name: c.name, category: c.category ?? "general", description: c.description }));
  return {
    agents: map("agent"),
    tools: map("tool"),
    integrations: map("integration"),
  };
}
