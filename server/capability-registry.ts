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
  { kind: "fulfillment", name: "unified_memory_context", category: "memory", description: "R122 — Single read surface across 11 memory-adjacent tables a tenant accumulates: memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations. Read-only, tenant-isolated via R120 withTenantTx. Normalized envelope {source,id,ts,title,body,category,status,personaId,link} with per-source totals + filtered counts. Exposed three ways: agent tool get_unified_memory_context, HTTP GET /api/memory/unified, CLI scripts/memory-find.ts. Powers the /memory page's Unified tab so 'where did I put that?' never has a dark corner.", codePath: "server/memory/unified-context.ts + server/routes/memory.ts (GET /api/memory/unified) + server/tools.ts (case 'get_unified_memory_context') + scripts/memory-find.ts", codeSymbol: "getUnifiedMemoryContext" },
  { kind: "fulfillment", name: "chain_of_verification", category: "quality", description: "R123 — Chain-of-Verification (Dhuliawala et al., Meta FAIR, arXiv:2309.11495). 4-step factuality pass over any longform draft: (1) extract atomic claims, (2) rewrite each as a standalone question, (3) answer each in a FRESH context with NO draft visible (the trick — model can't repeat its own bias), (4) revise softening UNCERTAINs and replacing contradictions. Cheaper than ensemble_query (single model, ~maxQuestions+2 short calls vs N proposers + κ). NEVER throws — fail-safe returns original draft + warning. Wired as opt-in `verify` flag on research-report fulfillment (Cassandra longform reports) and exposed as agent tool verify_with_cove for any persona to call before shipping a narrative. Treat as 'second pass' that catches obvious contradictions, not a hallucination silver bullet (paper reports ~5-25% factuality lift, not the 94% influencer math).", codePath: "server/lib/cove-verifier.ts + server/tools.ts (case 'verify_with_cove') + server/research-report-fulfillment.ts (opt-in verify flag)", codeSymbol: "verifyWithCoVe" },
  { kind: "fulfillment", name: "adaptive_plan_node_budgets", category: "planning", description: "R108 A (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — plan_graph_edit ADD_NODE / UPDATE_NODE accept an optional `maxSteps` int (1-200) per node. Hard nodes (multi-stage retry, blind exploration) get a larger budget than the orchestrator default; easy nodes get tighter ones. plan_graph_query surfaces each node's maxSteps so orchestrators can honor it.", codePath: "server/lib/plan-graph.ts", codeSymbol: "applyPlanEdits + queryPlan" },
  { kind: "fulfillment", name: "causal_evidence_edges", category: "reasoning", description: "R108 B (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — hypothesis_attach_evidence + hypothesis_evidence_chain tools + hypothesis_evidence_edges table. Each pinned hypothesis can carry a directed evidence chain (memory_entry / finding / tool_result / free_text) with per-edge confidence. Top-3 evidence edges auto-render under each hypothesis in the system-prompt block so the executor sees the grounding without an extra tool call. Forces personas to ground load-bearing claims rather than assert them.", codePath: "server/lib/pinned-hypotheses.ts (attachEvidence + listEvidence)", codeSymbol: "attachEvidence + listEvidence + renderPinnedBlock" },
  { kind: "fulfillment", name: "cold_start_hypothesis_nudge", category: "context", description: "R108 C (LuaN1aoAgent second-pass cherry-pick, Apache-2.0) — chat-engine injects a one-line nudge into the system prompt when a complex task (≥300 chars OR planning-keyword) arrives with ZERO pinned hypotheses for the conversation. Steers personas toward hypothesis_pin + hypothesis_attach_evidence at task start instead of blind exploration.", codePath: "server/chat-engine.ts", codeSymbol: "coldStartNudge" },
  { kind: "fulfillment", name: "pre_delivery_secret_scan", category: "security", description: "R110 +sec (elementalsouls/Claude-OSINT 48-pattern catalog, MIT) — fail-CLOSED structural gate in delivery-pipeline.attemptUpload() that scans every primary + bundle file for 48 credential-shaped secret patterns (AWS / GCP / GitHub / Stripe live / Anthropic / OpenAI / ElevenLabs / Slack / SendGrid / Twilio / Discord / Telegram / npm / PyPI / Docker / all PEM private-key armor / JWT / Basic-Auth URLs / generic api_key) BEFORE Drive upload. CRITICAL or HIGH hits abort the upload, alert owner, and surface a structured error. The same scanner runs ingest-side in validateUploadedFile() to reject leaked keys in customer uploads, and is exposed agent-callable as scan_for_secrets (Felix/Forge/Robert call it explicitly before deliver_product on code-bearing artifacts). Pure-stdlib, sub-second, no LLM. Closes the gap that env-driven redactSecrets() cannot — it can only mask values present in process.env, not hardcoded keys Felix invents on the fly.", codePath: "server/lib/secret-scan.ts + server/delivery-pipeline.ts (scanDeliverablesForSecrets) + server/routes.ts (validateUploadedFile) + server/tools.ts (case 'scan_for_secrets')", codeSymbol: "scanForSecrets + scanFileForSecrets + redactSecretsByPattern" },
];

// =============================================================================
// WEDGES — R125+13.8 — three concurrent validation-stage wedge tracks.
// Each wedge has a tracker project (created by scripts/wire-wedges.ts),
// a heartbeat task driving its cron pipeline, an output-skill SOP Felix
// consults when work needs doing, and a tag namespace in projects/leads.
// =============================================================================
const WEDGES: CapabilityRecord[] = [
  { kind: "fulfillment", name: "wedge_audit_pro",              category: "wedge", description: "R125+13.8 — AI-Native Readiness Audit Pro wedge ($299 one-shot, 7-day path-to-first-dollar). Lives on /audit waitlist. SOP: data/output-skills/wedge-audit-pro-sop.md. Tracker: project tagged 'wedge:audit-pro'. Cron: weekly-wedge-digest.ts metric line + lead-nurture-cron.ts for stale waitlist follow-ups.", codePath: "data/output-skills/wedge-audit-pro-sop.md", codeSymbol: "lookup_output_skill:wedge-audit-pro-sop" },
  { kind: "fulfillment", name: "wedge_built_with_x",           category: "wedge", description: "R125+13.8 — Built-With-X Channel-in-a-Box wedge ($99-$999/mo, 14-day validation, Bob is case-study #1 via BWB). SOP: data/output-skills/wedge-built-with-x-sop.md. Tracker: project tagged 'wedge:built-with-x'. Felix produces creator-onboarding content + sample channel deliverables via the existing scripts/build-bwb-video.ts pipeline.", codePath: "data/output-skills/wedge-built-with-x-sop.md", codeSymbol: "lookup_output_skill:wedge-built-with-x-sop" },
  { kind: "fulfillment", name: "wedge_youtube_portfolio_ops", category: "wedge", description: "R125+13.8 — YouTube Portfolio Ops wedge ($199/$499/$999 per month, 21-day validation, top S-tier Isenberg IOTD pick). SOP: data/output-skills/wedge-youtube-portfolio-ops-sop.md. Tracker: project tagged 'wedge:youtube-portfolio-ops'. MVP = portfolio dashboard + Felix-narrated weekly digest in creator's voice.", codePath: "data/output-skills/wedge-youtube-portfolio-ops-sop.md", codeSymbol: "lookup_output_skill:wedge-youtube-portfolio-ops-sop" },
  { kind: "fulfillment", name: "wedge_auto_score_iotd",         category: "wedge", description: "R125+13.8 — Daily auto-score of newly-ingested Isenberg/IdeaBrowser IOTD entries against the 5-dim VC-fit rubric (S/A/B/C/Park). Idempotent (skips already-scored). Surfaces new S/A picks to the weekly digest. Script: scripts/auto-score-new-isenberg.ts.", codePath: "scripts/auto-score-new-isenberg.ts", codeSymbol: "auto-score-cron" },
  { kind: "fulfillment", name: "wedge_weekly_digest",           category: "wedge", description: "R125+13.8 — Monday 08:00 weekly digest across all active wedges: per-track waitlist deltas, content shipped, new S/A IOTDs, agent recommendation per track. Writes markdown + uploads to project #234 Drive folder. Script: scripts/weekly-wedge-digest.ts.", codePath: "scripts/weekly-wedge-digest.ts", codeSymbol: "weekly-digest-cron" },
  { kind: "fulfillment", name: "wedge_lead_nurture",            category: "wedge", description: "R125+13.8 — Daily 09:00 lead-nurture pass: scans waitlist leads stale ≥7d, generates wedge-aware personalized draft emails into lead_nurture_drafts table for HITL review. NEVER auto-sends. Script: scripts/lead-nurture-cron.ts.", codePath: "scripts/lead-nurture-cron.ts", codeSymbol: "lead-nurture-cron" },
  { kind: "fulfillment", name: "wedge_archive_rescue",           category: "wedge", description: "R125+13.11 — Archive Rescue (Cabinet to Cloud) wedge: phone-camera → searchable digital archive for small museums, law firms, historical societies. Starter $99/500pg, Standard $299/2500pg, Pro $999+$49/mo. Public landing /archive-rescue + free 5-page demo + Stripe checkout. SOP: data/output-skills/wedge-archive-rescue-sop.md. Tracker: project tagged 'wedge:archive-rescue'.", codePath: "data/output-skills/wedge-archive-rescue-sop.md", codeSymbol: "lookup_output_skill:wedge-archive-rescue-sop" },
  { kind: "fulfillment", name: "wedge_creator_sponsor_ops",     category: "wedge", description: "R125+13.12 — Creator Sponsor Ops wedge (CONCIERGE-MODE): sponsor-back-office for creators with 5+ brand deals. Starter $99 90-day audit / Standard $299/mo extraction + digests / Pro $499/mo + Monid-powered brand-discovery outreach. No public landing until 3 paying Standard customers. SOP: data/output-skills/wedge-creator-sponsor-ops-sop.md. Tracker: project tagged 'wedge:creator-sponsor-ops'. Crons: cso:deadline-scan-daily, cso:weekly-digest, cso:pro-brand-discovery-monthly.", codePath: "data/output-skills/wedge-creator-sponsor-ops-sop.md", codeSymbol: "lookup_output_skill:wedge-creator-sponsor-ops-sop" },
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

// =============================================================================
// R125+ SELF-REPAIR LOOP — detect → classify → remedy → ledger (Tasks #51–#54)
// Internal infrastructure (NOT agent-callable tools): agents feed it via
// attribute_failure + honest status reports; the loop runs autonomously.
// Registered here so Minerva's planner + the orphan-skill audit know it exists.
// =============================================================================
const R125_SELF_REPAIR: CapabilityRecord[] = [
  { kind: "fulfillment", name: "incident_capture_classifier", category: "self_repair", description: "R125+ (#51) — captureIncident: on any tool/step/CI/deliverable failure, classify it (code_defect vs guard/safety vs transient) via heuristic-then-jury, persist to the repair_incidents ledger, and route. Primary signal is agents' own attribute_failure calls (clean L1/L4/L5 levelling lets it route a real bug to the surgeon instead of blind retry). Sources: runtime_self_heal, ci_self_heal, felix_deliverable.", codePath: "server/agentic/repair-incident.ts", codeSymbol: "captureIncident" },
  { kind: "fulfillment", name: "incident_dispatch_remedy", category: "self_repair", description: "R125+ (#51) — dispatchIncidentRemedy: detached worker that turns the classifier's routing into action — repo_surgeon (guarded auto-fix), escalate_owner (Bob), or no-op when the caller's own loop owns the retry (retry / felix_revise / surface). Writes action_taken/action_outcome/resolved back to the ledger; a throwing surgeon is contained, never crashes the caller.", codePath: "server/agentic/repair-incident.ts", codeSymbol: "dispatchIncidentRemedy" },
  { kind: "fulfillment", name: "repo_surgeon", category: "self_repair", description: "R125+ (#52) — runRepoSurgeon: guarded code-fix executor. Diagnoses root cause, writes a MINIMAL diff, verifies for real (typecheck → targeted tests → optional golden-path replay → re-run the failed tool), lands on green or rolls back cleanly on red. 3 fail-closed invariants: NEVER weakens a guard/test/safety surface; auth/payments/schema/safety changes PAUSE for owner HITL; durable 2-failed-attempts stop then escalate. Auto-apply is OPT-IN via REPAIR_AUTOFIX_ENABLED (default OFF — most defects escalate to Bob, not silently rewritten).", codePath: "server/agentic/repo-surgeon.ts", codeSymbol: "runRepoSurgeon" },
  { kind: "fulfillment", name: "pipeline_checkpoint_resume", category: "self_repair", description: "R125+ (#53) — runStage / pipeline-checkpoint: long multi-stage jobs persist each stage/UNIT's artifact to pipeline_stage_artifacts as it completes. A retry loads the manifest, REUSES every finished stage/unit, and REPAIRS only the first incomplete/failed unit — it never re-runs the whole job. Ghost-safe (a completed checkpoint whose file vanished is re-run via verify). Wired end-to-end on the BWB weekly recap. Doctrine: repair, don't re-run.", codePath: "server/agentic/pipeline-checkpoint.ts", codeSymbol: "runStage" },
  { kind: "fulfillment", name: "repair_incident_ledger", category: "self_repair", description: "R125+ (#54) — owner-visible decision ledger for the self-repair loop. GET /api/admin/repair-incidents (admin-tenant gated; filters ?status=open|resolved|escalated|needs_review, ?source=, ?limit=) returns incidents + summary stats. The repair_incidents table carries action_taken/action_outcome/action_detail/resolved/resolved_at/dispatched_at. There is NO agent tool to trigger a repair — surfacing a clean failure IS the interface.", codePath: "server/routes/admin.ts", codeSymbol: "GET /api/admin/repair-incidents" },
];

// =============================================================================
// R125+62 — AUTONOMOUS-LOOP CONTRACT SYSTEM. Governance infrastructure (NOT
// agent-callable tools): a typed contract for every long-running autonomous
// loop (objective/check/feedback/stop/escalate/authority/failMode) plus the
// Loop Doctor audit that fails CI if any live workflow has no contract.
// Registered here so Minerva's planner + the orphan-skill audit know the loop
// fleet exists and is governed. The per-loop knowledge lives in agent_knowledge
// (walkLoopContracts in scripts/agent-knowledge-refresh.ts) for search_knowledge
// / recall_capabilities retrieval; this is the high-level "it exists" pointer.
// =============================================================================
const LOOP_ENGINEERING: CapabilityRecord[] = [
  { kind: "fulfillment", name: "loop_engineering_patterns", category: "self_repair", description: "R125+137.80 — Loop Engineering prompt patterns: seven goal-based iterative-fix loops (Type Error Killer, Test Gap Closer, Dead Code Sweeper, Dependency Updater, Pattern Migrator, Lint Fixer, Doc Gap Filler) plus a template for composing new ones. Every loop = Goal + Rules (one unit at a time, explicit do-NOTs) + Verify-after-each-step (undo if the count went up) + Exit-when. Use when grinding down a countable defect class or building anything that benefits from fix-one → verify → repeat. Retrievable via search_knowledge (skill:loop-engineering). Pairs with the 2-failed-corrections rule — log and move on after 2 failed attempts on the same item.", codePath: ".agents/skills/loop-engineering/SKILL.md", codeSymbol: "loop-engineering skill" },
];

const GOLD_EXEMPLARS: CapabilityRecord[] = [
  { kind: "fulfillment", name: "gold_exemplar_library", category: "quality", description: "R125+137.81 — Gold Exemplar Library: the platform learns from its own best work. When grade_deliverable scores a deliverable ≥90, pass content_excerpt (the production TEXT — narration script, doc outline+copy, slide contents) and it is auto-captured into deliverable_exemplars (tenant-scoped, sha256-deduped, cap 5 auto_grade per tenant+format; owner_marked rows are permanent). At plan time classifyDeliverable auto-injects the top-2 exemplars as few-shot structure/style reference (delimited as untrusted data, never instructions). Agents' ONE job: ALWAYS pass content_excerpt when calling grade_deliverable so top work gets captured — retrieval/injection is automatic.", codePath: "server/lib/deliverable-exemplars.ts", codeSymbol: "maybeStoreExemplar + getExemplarGuidance" },
];

const LOOP_GOVERNANCE: CapabilityRecord[] = [
  { kind: "fulfillment", name: "loop_contract_registry", category: "loop_governance", description: "R125+62 — Typed LoopContract registry for every autonomous loop in the platform (8 loops: 6 workflow-backed — agentic-ci-self-healer, auto-git-push, jury-queue-drainer, skill-optimizer-nightly, tenant-isolation-audit, agent-knowledge-refresh; + 2 in-process — heartbeat-scheduled-tasks, bwb-weekly-render). Each contract declares objective / check / feedback / stop[] / escalate[] / authority / failMode / verifier (generator≠evaluator independence) / spend (token-cap ceiling); every mutating or destructive loop is failMode 'closed', no loop may grade its own output (verifier 'self') or spend uncapped (spend 'unbounded') — VisionClaw invariants. Source of truth that the Loop Doctor, the agent-knowledge walker, and this registry all read — no loop runs uncontracted.", codePath: "server/loop-contracts.ts", codeSymbol: "LOOP_CONTRACTS + getLoopContract + auditLoopCoverage" },
  { kind: "fulfillment", name: "loop_doctor_audit", category: "loop_governance", description: "R125+62 — Loop Doctor: audits every contract for completeness (non-empty stop + escalate, mutating⇒failMode closed, verifier≠self [generator/evaluator split], spend≠unbounded [token cap], source file exists) AND derives the live .replit workflow set + IN_PROCESS_LOOPS, ERRORing on any uncontracted loop so a new loop can't ship as stale-doc theater. Exit 0/1/2/3, --json. Harnessed as weekly-maintenance Pass 12 and covered by tests/unit/loop-contracts.test.ts.", codePath: "scripts/loop-contract-audit.ts", codeSymbol: "loop-contract-audit (Loop Doctor)" },
];

/** All static capabilities except `event` (events come from event-bus at runtime). */
export const STATIC_CAPABILITIES: CapabilityRecord[] = [
  ...AGENTS,
  ...WEBHOOKS,
  ...INTEGRATIONS,
  ...FULFILLMENT_PATHS,
  ...R106_PRIMITIVES,
  ...R125_SELF_REPAIR,
  ...LOOP_ENGINEERING,
  ...GOLD_EXEMPLARS,
  ...LOOP_GOVERNANCE,
  ...WEDGES,
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
