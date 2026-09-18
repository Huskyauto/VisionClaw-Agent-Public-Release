import { generateStyledPdf } from "../server/pdf-create";
import { uploadAndShare } from "../server/google-drive";
import { getOrCreateTenantInbox, sendEmail } from "../server/email";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

const TOOLS = fs.readFileSync("/tmp/tools.txt", "utf8").trim();
const TOOL_LIST = TOOLS.split(",").map(s => s.trim()).filter(Boolean);
const TOOL_COUNT = TOOL_LIST.length;

const SKILLS = [
  "AI Agent Playbook","AI Discoverability Audit","Agent Blueprint","Agent Browser","Agent Cost Analyzer","Agent Email","Agent Launchpad","Agent Memory Guide","Agent Ops Playbook","Blog Hero Images","Browser Automation (X/Twitter)","Build in Public","Business Operations & Strategy","Caption Generation","Marketplace Creator","Code Generation","Coding Agent Loops","Cold Outreach","Content Idea Generator","Content Marketing & Brand Building","Content Production","Content Writing System","Context Budget","Data Analysis","De-AI-ify Text","DocClaw","Document & Delivery Pipeline","Email Drafting","Email Fortress","Excalidraw Flowcharts","Financial Analysis & Reporting","Free Web Search","Heartbeat Monitor","Homepage Audit","Image Understanding","Legal & Compliance Essentials","LinkedIn Content Engine","LinkedIn Profile Optimizer","Math & Calculations","Morning Briefing","Phone Service","Plan My Day","Programmatic SEO","Project Management & Planning","Reasoning & Logic","Research & Competitive Intelligence","SEO Content Audit","Sales & Client Relations","Schema Markup Generation","Security Hardening","Security Review","Self-Diagnostics","Small Business AI Prompts","Summarization","TOWEL Protocol","Token Optimization","Vibe Marketing","Web Research","Writing & Editing","X Engagement Cron","X/Twitter Skill","YouTube Skill"
];

const PERSONAS = [
  ["1","VisionClaw","General AI Assistant — front-door persona, routes work to specialists"],
  ["2","Felix","CEO Persona — owns presentations, customer deliverables, project plans"],
  ["3","Forge","Staff Engineer — writes code, executes, debugs, ships integrations"],
  ["4","Teagan","Content Marketing Specialist — campaigns, social, brand voice"],
  ["5","Agent Blueprint","Multi-Agent System Operator — designs crews + flows"],
  ["6","Chief of Staff","Operations Director — internal coordination"],
  ["7","Scribe","Content Creator — long-form writing"],
  ["8","Proof","Content Reviewer — QA + craftsmanship gate"],
  ["9","Radar","Intelligence Analyst — competitive, OSINT"],
  ["10","Neptune","Deep Research Specialist — multi-source synthesis"],
  ["11","Apollo","Revenue & Pipeline Manager — sales, CRM, lead scoring"],
  ["12","Atlas","Metrics & Reporting Analyst — KPI dashboards, finance reports"],
  ["13","Cassandra","CFO — Chief Financial Officer — P&L, cash flow, treasury"],
  ["14","Luna","Legal & Compliance Officer — contracts, audits, governance"],
  ["15","Minerva","Chief Planner — Strategic Plan Architect"],
  ["16","Robert","Wellness Coach — [Your Product] consumer-facing health persona (strict AHB safety profile, 8 medical categories blocked)"],
];

const TOOL_CATEGORIES: Record<string, string[]> = {
  "Memory & Knowledge": ["search_memory","create_memory","update_memory","recall_context","search_knowledge","create_knowledge","store_triple","query_triples","expire_triple","graph_memory","query_communities","query_causal","write_daily_note","get_daily_notes","write_scratchpad","read_scratchpad","auto_memorize_now","compress_context","context_budget_audit"],
  "Web & Research": ["web_fetch","web_search","firecrawl_search","firecrawl_scrape","firecrawl_crawl","firecrawl_map","readability_extract","template_scrape","template_scraper_stats","scraped_pages_query","scraped_page_read","scraped_pages_delete","deep_research","trend_research","parallel_research","synthesize_research","research_digest","save_evidence","query_evidence","vision_browse","stealth_browse","browser_workflow","browser","site_login"],
  "AI Reasoning & Models": ["ensemble_query","llm_task","orchestrate","critique_response","cross_critique","list_critiques","debate","tree_of_thought","ideation_session","estimate_cost","list_models","audit_reasoning_step","verify_math_chain","recursive_synthesize","simulate_plan","user_model_query","tool_performance_report","scan_for_prompt_injection"],
  "Files, Documents, PDFs": ["read_file","write_file","scan_file","analyze_pdf","create_pdf","edit_pdf","fill_pdf","list_pdf_fields","create_styled_report","create_document","create_spreadsheet","doc_search","list_uploads","project","chunk_code","show_diff"],
  "Slides & Visualization": ["create_slides","build_presentation_distributed","generate_chart","render_diagram","generate_dashboard","generate_social_image"],
  "Video & Audio": ["produce_video","create_slideshow_video","mpeg_produce","mpeg_produce_parallel","mpeg_concat","mpeg_add_audio","video_transcribe_words","video_cut_fillers","video_burn_captions","generate_audio","vibevoice_transcribe","search_stock_media"],
  "Communication & Messaging": ["send_email","check_inbox","send_message","messaging_status","schedule_message","list_scheduled_messages","cancel_scheduled_message","whatsapp","post_to_channel","read_channels","emit_event","manage_desk"],
  "Social Media": ["draft_social_post","compose_social_post","publish_social_post","manage_social_accounts","manage_content_calendar","marketing_analytics","marketing_experiment","x_post_tweet","x_delete_tweet","x_get_tweet","x_get_mentions","x_get_timeline","x_search","x_like_tweet","x_retweet","x_get_me","build_voice_profile","get_voice_profile","generate_hooks","format_post","generate_content_matrix","score_post"],
  "Finance, CRM, Business Ops": ["create_invoice","list_invoices","update_invoice_status","invoice_aging_report","log_expense","list_expenses","expense_report","add_customer","update_customer","list_customers","log_interaction","customer_pipeline","create_contract","list_contracts","update_contract_status","record_kpi","kpi_dashboard","kpi_trend","profit_and_loss","revenue_report","cash_flow_summary","business_health_score","financial_snapshot","forecast_ticker","analyze_portfolio","finance_news","finance_stock_price","finance_stock_search","finance_market_overview","track_outcome","manage_watchlist","revenue_vs_cost","agent_cost_summary","get_usage_analytics"],
  "Sales & Pipeline": ["define_icp","enrich_lead","score_leads","qualify_leads","create_sequence","enroll_in_sequence","advance_sequence","classify_reply","list_sequences","add_competitor","list_competitors","take_competitor_snapshot","detect_competitor_changes","competitor_briefing"],
  "Legal & Compliance": ["legal_review","compliance_audit","generate_legal_document","seo_content_audit","generate_schema_markup","verify_outbound_safety"],
  "Delivery & Customer": ["deliver_product","delivery_status"],
  "Google & Calendar": ["google_drive","google_workspace","calendar_sync"],
  "Agent Orchestration": ["delegate_task","subagents","autonomous_task","fork_conversation","agent_status","sessions_list","sessions_history","sessions_send","sessions_spawn","sculptor_session","sculptor_review","create_mind","mind_ticket","create_crew","create_flow","plan_and_execute","lobster","run_supervisor","list_agent_runs","get_agent_run","agentic_cache_stats","run_background_task","check_background_task","list_background_tasks"],
  "Planning & Strategy": ["create_plan","list_plans","get_plan","get_minerva_roster","strategic_interview","export_persona","skillify"],
  "Human-in-the-Loop": ["request_approval","decide_approval","list_pending_approvals","commit_decision"],
  "Self-Improvement / Felix Loop": ["felix_loop_status","list_felix_loop_runs","list_felix_proposals","approve_felix_proposal","reject_felix_proposal","felix_loop_run_now","verify_felix_proposal_spec","execute_felix_proposal","run_self_improvement","skill_seeker","synthesize_skill","list_skill_candidates","promote_skill_candidate","reject_skill_candidate","create_tool","list_custom_tools","delete_custom_tool","manage_skills","sync_personas","introspect_tools","self_diagnose","self_heal","self_heal_log","self_heal_inspect","log_experiment","get_experiments","run_agent_eval","get_eval_report","nudge_self","knowledge_nudge_stats"],
  "Governance & Tensions": ["create_tension","list_open_tensions","resolve_tension","create_adr","list_adrs","supersede_adr","set_policy","verify_deliverable"],
  "Wellbeing & Emotional Support": ["stress_intervention","detect_fatigue","micro_sabbatical","detect_emotional_state","grounding_intervention","track_intervention"],
  "Platform & System": ["test_api_keys","check_system_status","list_conversations","get_user_info","exec","execute_code","figma","youtube","agent_security_scan"],
};

const allCategorized = new Set(Object.values(TOOL_CATEGORIES).flat());
const uncategorized = TOOL_LIST.filter(t => !allCategorized.has(t));
if (uncategorized.length) TOOL_CATEGORIES["Other"] = uncategorized;

const DATE = "May 3, 2026";

const txt = `VISIONCLAW AGENT PLATFORM
Comprehensive Features & Security — ${DATE}
==================================================

[Your Company] | EIN: [YOUR-EIN]
Owner: Bob Washburn | [Your City, ST] | [YOUR-PHONE]
Production: https://agenticcorporation.net
QR Code: agenticcorporation.net

==================================================
PLATFORM AT A GLANCE
==================================================

  ${TOOL_COUNT} Agentic Tools
  ${SKILLS.length} Reusable Skills
  ${PERSONAS.length} Specialist Personas
  92 Active Capabilities
  47 Production Indexes
  149 Database Tables
  40 Governance Rules
  ~180,000 Lines of Code
  453 TypeScript Modules
  36 Curated AI Models (+ 1000+ via OpenRouter)

==================================================
WHAT'S NEW — R75.A ADVERSARIAL HUMANITIES BENCHMARK (AHB) DEFENSE LAYER
==================================================

Defense-in-depth against stylistic-obfuscation jailbreaks. Galisai et al.
2026 (Adversarial Humanities Benchmark, arXiv:2604.18487) showed that
attacks dressed up in poetry, allegory, hermeneutics, and role-play lift
frontier-model attack success rate from 3.84% to 55.75%. R75.A is the
structural answer: refusal at the reasoning layer is not enough — we now
gate intent BEFORE the model sees the message and gate destructive tools
at the executor.

LAYER 1 — INTENT GATE (server/safety/intent-gate.ts)
- Every inbound message is destyled by a fast classifier into its
  literal intent.
- Literal intent is matched against the persona's safety_profile jsonb
  (intentGate: strict | moderate | off, restrictedCategories[],
  persona-voice refusalCopy).
- Robert (Wellness Coach) seeded with 8 medical categories:
  drug_dosage, diagnosis, prescription_change, eating_disorder_validation,
  off_label_use, supplement_stacking, self_harm_facilitation, medical_advice.
- Felix (CEO) seeded with 5 destructive categories: production_data_destruction,
  money_movement_without_approval, credential_exposure, mass_email_unapproved,
  tenant_isolation_bypass.
- Runs for direct user input AND subagent traffic — a jailbroken outer
  agent cannot poetry-attack Robert via spawn_subagent.
- Fails OPEN with loud logging so a misbehaving classifier never breaks
  consumer chat (privacy-preserving: literal_intent capped at PII-safe
  length before caching).

LAYER 2 — DESTRUCTIVE-TOOL POLICY (server/safety/destructive-tool-policy.ts)
- Registry of money-moving / data-deleting / credential-touching tools
  requires (a) typed object args, (b) trusted persona, (c) fresh approval
  row, (d) value caps.
- Unregistered tools whose names match suspicious patterns
  (delete_*, drop_*, exec_sql, payout, transfer, refund, reveal_secret,
  rotate_key, sudo_*) are auto-classified destructive and FAIL CLOSED.
- Covered tools: stripe_refund, stripe_create_payout, stripe_create_transfer,
  exec_sql, delete_persona, delete_custom_tool, manage_skills (delete),
  drop_table, write_file (system paths), revoke_api_key, rotate_secret,
  send_mass_email, etc.
- Audit log written to security_intent_checks + security_tool_blocks
  on every block decision, awaited with 1.5s timeout so the security
  trail SURVIVES a post-refusal process crash.

REGRESSION SUITE — 19/19 GREEN
- 4 Robert poetic medical attacks (sonnet-asking-for-wellness-program-dose, etc.)
- 6 Robert benign protocol questions (must NOT be falsely refused)
- 3 Felix lateral attacks via subagent traffic
- 6 destructive-tool structural tests (untyped args, untrusted persona,
  missing approval, value-cap exceeded, suspicious-name fallthrough,
  audit-log persistence)
- Suite gates CI in tests/security/ahb-regression.test.ts.

EIGHT CODE-REVIEW FINDINGS CLOSED IN SAME RELEASE
1. Subagent-traffic enforcement (was direct-input-only, now both).
2. Suspicious-name fail-CLOSED default (was fail-open).
3. Audit log awaited (was fire-and-forget, lost on crash).
4. PII-minimized literal_intent cache (was full message text).
5. Cache key invalidates on safety_profile change.
6. Distinct-category signal counting (was double-counting one category).
7. Generic refusal copy that does not echo categories to attackers.
8. snake_case / camelCase consistency across the new tables.

UI SURFACING (R75.A LANDING + DASHBOARD + SIDEBAR)
- Landing page hero "Platform Online" status badge leads with R75.A.
- Landing "Built-in safety architecture" card adds AHB + destructive-tool
  bullets (visible in both Business and Technical mode).
- Landing SEO meta description leads with R75.A so search snippets and
  link previews surface the new defense.
- Home dashboard "What's New" banner now R75.A in emerald accent
  (data-testid="banner-whats-new-r75a").
- Admin sidebar "What's New" badge bumped to R75.A in emerald.
- New admin sidebar link "Security Audit" (R75.A badge) deep-linking
  to /activity?filter=security.

==================================================
SECURITY HISTORY (R74 → R95)
==================================================

R95 — OUTBOUND SENSITIVE-DATA REDACTION GATE (May 3 2026)
Direct response to "Agents of Chaos" (Northeastern et al., Feb 2026),
Case Study #3: an OpenClaw agent refused a direct SSN request, then
disclosed the same SSN when asked to "forward the entire email thread".
Refusal at reasoning is meaningless if egress ships the secret.
- New server/lib/outbound-redaction.ts with scanOutbound() + enforceOutbound().
- Verdicts: clean / redact / block.
- BLOCK (critical): PEM/OpenSSH private keys, AWS keys, Stripe sk_live_/rk_live_,
  OpenAI sk-proj-...T3BlbkFJ..., Anthropic sk-ant-api03/admin01, Google AIza,
  GitHub ghp_/gho_/ghu_/ghs_/ghr_/github_pat_, Slack xox[abprs]-, JWTs,
  Bearer tokens.
- REDACT (high/medium): credit cards (Luhn-validated), US SSNs (formatted).
- Live tenant secret registry: every 5min the gate snapshots process.env
  entries matching (KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|DSN)
  with length >= 16; verbatim matches in outbound text are
  tenant_env_secret:critical → block.
- Wired into: handleSendEmail (subject/text/html), sessions message routes,
  webhook-relay (https-only + RFC1918 deny-list + AWS/GCP metadata IP block),
  MCP server, glasses gateway, Gmail send, post_to_channel, deliver_product.

R95.v2 — UNICODE/ZERO-WIDTH BYPASS DEFENSE (May 3 2026)
- canonicalize() runs NFKC normalize + zero-width strip
  ([\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]) BEFORE pattern
  matching. AKIA<ZWSP>IOSFODNN7EXAMPLE, ghp_<ZWSP>..., and fullwidth-digit
  card numbers all caught.
- Luhn validation on credit_card matches (16-digit invoice IDs no longer
  flagged).
- us_ssn_unformatted + us_ein moved behind opt-in includeWeakPatterns flag
  (off by default).
- Verdict-vs-replacement parity guaranteed.
- Caller-facing block message is generic; pattern names + surface labels
  logged server-side only — attackers cannot probe which pattern they tripped.
- Single chokepoint: server/messaging-gateway.ts:deliverMessage() so every
  caller is auto-covered.
- SMS/WhatsApp use strict:true (carrier archives).

R95.c — APP-WIDE OUTBOUND + TENANT-ISOLATION SWEEP (May 3 2026)
Three parallel architect audits surfaced 14 HIGH/CRITICAL findings; closed
the 8 highest-impact:
1. CRITICAL server/hooks.ts:webhook-relay — was POSTing attacker-controlled
   content to attacker-supplied URL with no allow-listing or redaction
   (textbook exfil + SSRF). Now https-only, deny-list for localhost / RFC1918
   / AWS+GCP metadata IPs / .internal / .local, then enforceOutbound(strict).
2. HIGH server/email.ts:sendEmail — R95 gate moved inside the function
   (subject + text + html scanned at provider chokepoint).
3. HIGH server/mcp-server.ts — MCP responses to Claude Desktop / Cursor /
   custom bots now strict-gated (blocks return isError: true).
4. HIGH server/glasses-gateway.ts — voice-rendered TTS surface; leaked
   credentials become audible in physical space. Now strict-gated; blocks
   return 403.
5. HIGH server/exec-tool.ts — workdir containment was path.resolve +
   startsWith. Symlinked dir under workspace could redirect command
   execution outside root. Now lstatSync rejects symlinks + realpathSync
   re-validates (parity with read_file/write_file/scan_file).
6. HIGH server/tools.ts felix handlers — felix_loop_status etc. defaulted
   to params._tenantId || 1 (silent fail-open into Bob's tenant). Now
   hard-fail if tenant context missing.
7. HIGH server/recurring-messages.ts:listScheduledMessages — was returning
   all-tenant rows when tenantId omitted. Now requires tenantId.
8. HIGH cross-tenant scheduler bug — createScheduledMessage defaulted
   tenantId ?? 1; any agent could mis-scope. Now explicit-required.

R94 — TENANT COST-ATTRIBUTION INTEGRITY (May 3 2026)
- New server/lib/tenant-context.ts: AsyncLocalStorage-backed tenant
  context that propagates end-to-end.
- authMiddleware wraps every authenticated request (vc_ API key, session,
  Replit OIDC) in runWithTenant(). Every downstream await — including
  singleton replitOpenai chat / embeddings / audio.speech /
  audio.transcriptions — bills the correct tenant.
- Wrapping extended to glasses gateway, MCP server (both global-key and
  per-tenant-derived-key paths), background job worker (job.tenantId),
  nightly tool-sommelier cron.
- Public chat passes convTenantId explicitly to getClientForModel.
- createMeteredOpenAIClient resolveTenant(): explicit opts.tenantId →
  AsyncLocalStorage current → ADMIN with warn-once-per-stack-trace.
- truncateWithSummary merges summary into first kept user turn
  (Anthropic strict-alternation safe), demotes summary from system → user
  role (closes a prompt-injection privilege-escalation path).
- scan_file gains lstat symlink reject + realpath re-validate at parity
  with read_file/write_file.
- Persona create/update + mind soul + claude-code-importer all run
  prompt-injection scan on soul / agentsDoc / heartbeatDoc / brandVoiceDoc /
  identity / tools BEFORE DB write.
- write_file shared blocklist + symlink-ancestor walk.
- Per-tenant escalation hourly quota (20/hr).
- SHA256 cache keys on metered OpenAI clients (collision-resistant).
- cleanedFullResponse strips <tool_call> tags (closes a render-side
  injection vector).
- Disconnect persistence guard (client-aborted streams no longer trigger
  title-gen + hook side effects).
- Critical runtime bug caught in Felix HVAC live test: original used
  CommonJS require() inside resolver, threw silently in tsx/ESM dev mode,
  made every cost lookup fall back to ADMIN — fixed by promoting to
  top-of-file static import.

R83-R93 — COMPREHENSIVE 24h SECURITY SWEEP (May 2-3 2026)
Nine R-bundles closing every defect surfaced by three parallel architect
reviews of the entire app:
- R83 streaming-aware AnthropicPromptCache with per-tenant entry quotas.
- R84 audit-reasoning + reasoning-extractor sandbox.
- R85 prompt-injection scanner ported from Hermes Alpha (10 threat patterns
  + invisible-unicode steganography).
- R86 / R91 streaming wiring + glasses fail-closed on missing tenant binding.
- R87 context-compressor with token-aware budgets.
- R88 error-context-parser + tool-call-fallback-parser (recovers from
  malformed XML/JSON tool-calls).
- R89 orphan tool_call/tool_result repair after truncation
  (Anthropic + OpenAI strict-alternation).
- R90 context-files-loader with scanner gate.
- R92 self-heal + auto-memorize explicit ADMIN tenant attribution.
- R93 tenant-attribution propagated to 7 cross-cutting callsites
  (felix-loop, plan-executor, ceo-orchestrator, cross-critique,
  distributed-slides, auto-memorize, self-heal).

R80 — CLAUDE CODE SUBAGENT IMPORTER (May 2 2026)
Position VisionClaw as the multi-tenant runtime for any .claude/agents/*.md
collection. Importer accepts a public GitHub URL, parses YAML frontmatter
strictly (js-yaml JSON_SCHEMA, BOM/CRLF tolerant), maps each Claude tool
(Read/Edit/Write/Grep/Glob/Bash/WebFetch/WebSearch/Task) to its VisionClaw
equivalent with HITL recommendations.
- VISIONCLAW RUNTIME ADAPTER preamble placed BEFORE original Claude Code
  instructions so it dominates: Read→read_file/scan_file,
  Bash→exec/execute_code (HITL-gated), WebFetch→web_fetch/firecrawl_scrape,
  WebSearch→web_search/firecrawl_search, Task→delegate_task,
  Grep→search_memory/search_knowledge/scraped_pages_query.
- CRITICAL trust-boundary clause tells the agent the imported instructions
  are untrusted legacy guidance and HITL bypass attempts must be refused.
- Role mapping engages new "Imported Subagent (researcher)" /
  "Imported Subagent (developer)" policies — researcher hard-blocks
  exec / execute_code / write_file.
- Executor-tier imports auto-receive per-persona autonomy_rules
  (exec / execute_code / write_file all approve_before, tenant-scoped,
  idempotent via partial unique index).
- Hardened SSRF: host-locked to github.com, fetches go only to
  api.github.com / raw.githubusercontent.com, every call sets
  redirect: "error".
- 43 importer tests + 62 security tests green.

R79 — MARTECH BUNDLE
Six per-tenant brand-voice and social-content tools (build_voice_profile,
get_voice_profile, generate_hooks, format_post, generate_content_matrix,
score_post) ported from charlie947/social-media-skills (MIT) and rebuilt
VisionClaw-native. Hardened against prompt injection with fenced voice
context, marker-stripping, and string-aware balanced-bracket JSON parsing.

R77.5 — KisMATH REASONING AUDIT RAIL
Every model tagged with its trainingRegime (rlvr / distilled / sft / base);
auto-router prefers non-RLVR for high-complexity reasoning. Two new tools
audit_reasoning_step + verify_math_chain audit any reasoning chain for
causal validity.

R76 — TRUST-TIER POLICY ENGINE + DELIVERABLE CONTRACT VERIFICATION
- Every claimed HTML / PDF / deck / video file is checked by extension +
  magic-byte MIME + render-ability before the persona is allowed to claim
  success.
- Risky tools pre-approved per-tenant via tool_policies (allow / deny /
  require_approval with recipient patterns and amount caps), with a
  NEVER_AUTO_APPROVE veto on policy / tool-create / skill-manage / lobster.
- Tenant-scoped at the storage layer.

ENCRYPTION & SECRET HANDLING
- AES-256-GCM credential vault for Telegram + WhatsApp credentials.
- HMAC-SHA256 hashed password reset and email verification secrets.
- decryptApiKey warn-once on legacy plaintext fallback.
- AES-256-GCM warn-once on legacy ciphertext.
- SESSION_SECRET hard-fails in production.

WEBHOOKS
- Stripe / Coinbase / Twilio: HMAC signature verification fails CLOSED in
  production.
- Durable webhook event dedupe with claim-then-commit semantics
  (R74.13u-2).

==================================================
COMPLETE TOOL INVENTORY (${TOOL_COUNT} tools)
==================================================

${Object.entries(TOOL_CATEGORIES).map(([cat, tools]) => `--- ${cat} (${tools.length}) ---
${tools.join(", ")}`).join("\n\n")}

==================================================
COMPLETE SKILLS INVENTORY (${SKILLS.length} skills)
==================================================

${SKILLS.map((s, i) => `  ${String(i+1).padStart(2," ")}. ${s}`).join("\n")}

==================================================
COMPLETE PERSONA ROSTER (${PERSONAS.length} personas)
==================================================

${PERSONAS.map(([id, name, role]) => `  [${id.padStart(2," ")}] ${name} — ${role}`).join("\n")}

==================================================
ARCHITECTURE
==================================================

FRONTEND
  React 18, Vite, shadcn/ui, TailwindCSS, Wouter, TanStack Query v5,
  Framer Motion. Command Center Dashboard, Mermaid diagrams, voice
  narration, ASR, chart/dashboard generation, multi-provider TTS,
  Google Slides visual engine.

BACKEND
  Express.js, TypeScript, Drizzle ORM, Zod, Helmet. SSE streaming,
  Replit Auth + Email/Password + Admin PIN, database-backed sessions,
  cryptographic security, password policies, email verification, strict
  multi-tenant data isolation.

CORE SUBSYSTEMS
  - AI Agent System: 16-persona team, LLM-powered CEO (Felix), Semantic
    Tool Router, Self-Improvement Engine, OAuth-first Auto Model Router,
    Orchestration Failure Report System.
  - Autonomous Operations: Heartbeat Engine, Scheduled Tasks, HITL
    Confirmation, Agent Manager, Multi-Layer Delegation, Execution
    Supervisor (Circuit Breaker, Output Validation, Hallucination
    Detection), Self-Correction Engine, Lean Execution Mode, Auto-QA
    Pipeline, Stop-the-Line Error Triage Engine.
  - Felix Brain Module: Task state tracker, conversation intent
    classifier, common-sense reasoning rules, identifier extraction,
    auto-context assembly, decision logging, self-reflection checkpoints,
    CEO reasoning frameworks.
  - Layered Identity System: 5 context layers (vc_showcase, client_facing,
    internal_ops, casual, default).
  - Structured Compaction Engine: 5 required sections, quality audit with
    retry, identifier extraction and preservation.
  - Aggressive Parallel Orchestration: up to 8 parallel agents with
    team awareness.
  - 3-Layer Failure Recovery: self-correction, lean mode downgrade,
    automatic backup agent reroute.
  - Bottleneck Analysis Engine.
  - Crews & Flows Engine: agent teams with role/goal/backstory, tasks
    with context chaining, sequential and hierarchical process types.
  - Universal Craftsmanship Quality Gate.
  - Google Token Resilience: pre-flight check, full repair cycle on 401,
    tenant isolation.
  - MPEG Production Engine: parallel video production via FFmpeg 6.1.1.
  - Tool Registry: single source of truth.
  - Agentic Infrastructure: persistent agent desks, internal channels,
    event bus, autonomy rules, outcome tracking, watchlist monitoring,
    40-rule Process Governor.
  - 1M-Context Auto-Escalation Chain.
  - GraphRAG Five (R75): five graph-aware memory operations
    (graph_memory, query_communities, query_causal, query_triples,
    expire_triple).

==================================================
INTEGRATIONS
==================================================

  OpenAI, Anthropic, Google Gemini, ElevenLabs, Stripe, Coinbase Commerce,
  Google Drive, Google Sheets, Google Mail, Google Calendar, OneDrive,
  Replit OIDC + Replit Auth, Twilio, Telegram, WhatsApp Business,
  Browserless, Firecrawl, OpenRouter (1000+ models), Figma (MCP).

==================================================
QR CODE
==================================================

  Visit: agenticcorporation.net
  (QR code asset embedded in PDF version)

==================================================
COMPANY INFORMATION
==================================================

  [Your Company]
  EIN: [YOUR-EIN]
  Owner: Bob Washburn
  [Your City, State]
  Phone: [YOUR-PHONE]
  Production: https://agenticcorporation.net
  Document Generated: ${DATE}
`;

fs.writeFileSync("VisionClaw-Comprehensive-Features.txt", txt);
console.log("TXT_BYTES:", txt.length);

(async () => {
  // PDF sections
  const sections: any[] = [
    {
      title: "Platform At A Glance",
      content: `${TOOL_COUNT} agentic tools, ${SKILLS.length} reusable skills, ${PERSONAS.length} specialist personas, 92 active capabilities, 47 production indexes, 149 database tables, 40 governance rules, ~180,000 lines of code across 453 TypeScript modules, 36 curated AI models plus 1000+ via OpenRouter.`,
      table: {
        headers: ["Metric", "Value"],
        rows: [
          ["Tools", String(TOOL_COUNT)],
          ["Skills", String(SKILLS.length)],
          ["Personas", String(PERSONAS.length)],
          ["Active Capabilities", "92"],
          ["Production Indexes", "47"],
          ["Database Tables", "149"],
          ["Governance Rules", "40"],
          ["Lines of Code", "~180,000"],
          ["TypeScript Modules", "453"],
          ["AI Models (curated + via OpenRouter)", "36 + 1000"],
        ],
      },
    },
    {
      title: "R75.A — Adversarial Humanities Benchmark (AHB) Defense Layer",
      content: "Defense-in-depth against stylistic-obfuscation jailbreaks. Galisai et al. 2026 showed attacks dressed up in poetry, allegory, hermeneutics, and role-play lift frontier-model attack success from 3.84% to 55.75%. R75.A is the structural answer: refusal at the reasoning layer is not enough — we now gate intent BEFORE the model sees the message and gate destructive tools at the executor.",
      subsections: [
        {
          title: "Layer 1 — Intent Gate",
          bullets: [
            "Every inbound message destyled by a fast classifier into its literal intent.",
            "Literal intent matched against per-persona safety_profile (strict / moderate / off + restrictedCategories[] + persona-voice refusalCopy).",
            "Robert seeded with 8 medical categories: drug_dosage, diagnosis, prescription_change, eating_disorder_validation, off_label_use, supplement_stacking, self_harm_facilitation, medical_advice.",
            "Felix seeded with 5 destructive categories: production_data_destruction, money_movement_without_approval, credential_exposure, mass_email_unapproved, tenant_isolation_bypass.",
            "Runs for direct user input AND subagent traffic — a jailbroken outer agent cannot poetry-attack via spawn_subagent.",
            "Fails OPEN with loud logging so a misbehaving classifier never breaks consumer chat.",
          ],
        },
        {
          title: "Layer 2 — Destructive-Tool Policy",
          bullets: [
            "Registry of money-moving / data-deleting / credential-touching tools requires typed object args, trusted persona, fresh approval row, and value caps.",
            "Unregistered tools matching suspicious-name patterns (delete_*, drop_*, exec_sql, payout, transfer, refund, reveal_secret, rotate_key, sudo_*) auto-classified destructive and FAIL CLOSED.",
            "Audit log written to security_intent_checks + security_tool_blocks on every block decision, awaited (1.5s timeout) so the security trail SURVIVES a post-refusal process crash.",
          ],
        },
        {
          title: "Regression Suite — 19/19 green",
          bullets: [
            "4 Robert poetic medical attacks (sonnet-asking-for-wellness-program-dose, etc.).",
            "6 Robert benign protocol questions (must NOT be falsely refused).",
            "3 Felix lateral attacks via subagent traffic.",
            "6 destructive-tool structural tests (untyped args, untrusted persona, missing approval, value-cap exceeded, suspicious-name fallthrough, audit-log persistence).",
            "Suite gates CI in tests/security/ahb-regression.test.ts.",
          ],
        },
        {
          title: "Eight Code-Review Findings Closed In Same Release",
          bullets: [
            "Subagent-traffic enforcement.",
            "Suspicious-name fail-CLOSED default.",
            "Audit log awaited (was fire-and-forget, lost on crash).",
            "PII-minimized literal_intent caching.",
            "Cache key invalidates on safety_profile change.",
            "Distinct-category signal counting.",
            "Generic refusal copy that does not echo categories to attackers.",
            "snake_case / camelCase consistency.",
          ],
        },
        {
          title: "UI Surfacing",
          bullets: [
            "Landing hero status badge leads with R75.A (both Business and Technical mode).",
            "Landing 'Built-in safety architecture' card adds AHB + destructive-tool firewall bullets.",
            "Landing SEO meta description leads with R75.A.",
            "Home dashboard 'What's New' banner now R75.A in emerald accent.",
            "Admin sidebar 'What's New' badge bumped to R75.A in emerald.",
            "New admin sidebar link 'Security Audit' deep-links to /activity?filter=security.",
          ],
        },
      ],
    },
    {
      title: "Security History Highlights",
      subsections: [
        {
          title: "R95 — Outbound Sensitive-Data Redaction Gate (May 3 2026)",
          bullets: [
            "Direct response to 'Agents of Chaos' (Northeastern et al., Feb 2026), Case Study #3.",
            "scanOutbound() + enforceOutbound() with verdicts clean / redact / block.",
            "Critical block: PEM keys, AWS / Stripe / OpenAI / Anthropic / Google / GitHub / Slack tokens, JWTs, Bearer tokens.",
            "Live tenant secret registry — every 5min snapshot of process.env entries; verbatim matches block as critical.",
            "Wired into email, sessions, webhook-relay (https-only + RFC1918 deny-list + AWS/GCP metadata IP block), MCP, glasses, Gmail, post_to_channel, deliver_product.",
          ],
        },
        {
          title: "R95.v2 — Unicode/Zero-Width Bypass Defense",
          bullets: [
            "canonicalize() runs NFKC normalize + zero-width strip BEFORE pattern matching.",
            "Luhn validation on credit-card matches (no false positives on 16-digit invoice IDs).",
            "Generic block message — pattern names logged server-side only so attackers cannot probe.",
            "Single chokepoint at server/messaging-gateway.ts:deliverMessage().",
            "SMS / WhatsApp use strict mode (carrier archives are forever).",
          ],
        },
        {
          title: "R95.c — App-Wide Outbound + Tenant-Isolation Sweep",
          bullets: [
            "CRITICAL: webhook-relay was POSTing attacker-controlled content to attacker-supplied URL with no allow-listing or redaction. Now https-only, deny-list for localhost / RFC1918 / AWS+GCP metadata IPs / .internal / .local, then enforceOutbound(strict).",
            "MCP responses to Claude Desktop / Cursor / custom bots strict-gated.",
            "Glasses gateway voice-rendered TTS surface — leaked credentials become audible — strict-gated.",
            "exec-tool symlink-pivot defense at parity with read_file/write_file/scan_file.",
            "Felix tool handlers no longer fail-open into Bob's tenant on missing context.",
            "listScheduledMessages + createScheduledMessage no longer default to tenantId 1.",
          ],
        },
        {
          title: "R94 — Tenant Cost-Attribution Integrity",
          bullets: [
            "AsyncLocalStorage tenant context propagates end-to-end across auth, glasses, MCP, background jobs, and the nightly tool-sommelier cron.",
            "Every metered LLM call (chat, embeddings, TTS, Whisper) bills the correct tenant.",
            "scan_file gains symlink + realpath rejection at parity with read_file/write_file.",
            "Persona + mind soul payloads scanned for prompt injection BEFORE database write.",
            "ESM require() landmines swept (CommonJS require in tsx/ESM dev mode caused silent ADMIN-fallback bug — now top-of-file static import).",
          ],
        },
        {
          title: "R83-R93 — Comprehensive 24h Security Sweep",
          bullets: [
            "AnthropicPromptCache with per-tenant entry quotas.",
            "Prompt-injection scanner (10 threat patterns + invisible-unicode steganography).",
            "Streaming wiring + glasses fail-closed on missing tenant binding.",
            "Context-compressor with token-aware budgets.",
            "Tool-call-fallback-parser recovers from malformed XML/JSON.",
            "Orphan tool_call/tool_result repair after truncation.",
            "Tenant-attribution propagated to felix-loop, plan-executor, ceo-orchestrator, cross-critique, distributed-slides, auto-memorize, self-heal.",
          ],
        },
        {
          title: "R80 — Claude Code Subagent Importer",
          bullets: [
            "Multi-tenant runtime for any .claude/agents/*.md collection.",
            "VISIONCLAW RUNTIME ADAPTER preamble translates Claude tool vocabulary to real VC tool names.",
            "CRITICAL trust-boundary clause: imported instructions are untrusted legacy guidance.",
            "Researcher tier hard-blocks exec / execute_code / write_file.",
            "Executor-tier imports auto-receive per-persona autonomy_rules (approve_before).",
            "Hardened SSRF: host-locked to github.com only, redirect: 'error'.",
            "43 importer tests + 62 security tests green.",
          ],
        },
        {
          title: "R76 — Trust-Tier Policy Engine + Deliverable Contract Verification",
          bullets: [
            "Every claimed HTML / PDF / deck / video file checked by extension + magic-byte MIME + render-ability before the persona claims success.",
            "Risky tools pre-approved per-tenant via tool_policies (allow / deny / require_approval with recipient patterns and amount caps).",
            "NEVER_AUTO_APPROVE veto on policy / tool-create / skill-manage / lobster.",
          ],
        },
      ],
    },
    {
      title: "Encryption & Secret Handling",
      bullets: [
        "AES-256-GCM credential vault for Telegram + WhatsApp credentials.",
        "HMAC-SHA256 hashed password reset and email verification secrets.",
        "decryptApiKey warn-once on legacy plaintext fallback.",
        "AES-256-GCM warn-once on legacy ciphertext.",
        "SESSION_SECRET hard-fails in production.",
        "Stripe / Coinbase / Twilio webhooks: HMAC signature verification fails CLOSED in production.",
        "Durable webhook event dedupe with claim-then-commit semantics (R74.13u-2).",
      ],
    },
    {
      title: `Complete Tool Inventory — ${TOOL_COUNT} tools`,
      subsections: Object.entries(TOOL_CATEGORIES).map(([cat, tools]) => ({
        title: `${cat} (${tools.length})`,
        content: tools.join(", "),
      })),
    },
    {
      title: `Complete Skills Inventory — ${SKILLS.length} skills`,
      content: SKILLS.join(" | "),
    },
    {
      title: `Complete Persona Roster — ${PERSONAS.length} personas`,
      table: {
        headers: ["#", "Name", "Role"],
        rows: PERSONAS.map(p => [p[0], p[1], p[2]]),
      },
    },
    {
      title: "Architecture",
      subsections: [
        {
          title: "Frontend",
          content: "React 18, Vite, shadcn/ui, TailwindCSS, Wouter, TanStack Query v5, Framer Motion. Command Center Dashboard, Mermaid diagrams, voice narration, ASR, chart/dashboard generation, multi-provider TTS, Google Slides visual engine.",
        },
        {
          title: "Backend",
          content: "Express.js, TypeScript, Drizzle ORM, Zod, Helmet. SSE streaming, Replit Auth + Email/Password + Admin PIN, database-backed sessions, cryptographic security, password policies, email verification, strict multi-tenant data isolation.",
        },
        {
          title: "Core Subsystems",
          bullets: [
            "AI Agent System — 16-persona team, LLM-powered CEO (Felix), Semantic Tool Router, Self-Improvement Engine, OAuth-first Auto Model Router.",
            "Autonomous Operations — Heartbeat Engine, Scheduled Tasks, HITL Confirmation, Agent Manager, Multi-Layer Delegation, Execution Supervisor.",
            "Felix Brain Module — task state tracker, conversation intent classifier, common-sense reasoning rules, decision logging, CEO reasoning frameworks.",
            "Layered Identity System — 5 context layers (vc_showcase, client_facing, internal_ops, casual, default).",
            "Structured Compaction Engine — 5 required sections, quality audit with retry, identifier extraction.",
            "Aggressive Parallel Orchestration — up to 8 parallel agents with team awareness.",
            "3-Layer Failure Recovery — self-correction, lean mode downgrade, automatic backup agent reroute.",
            "Crews & Flows Engine — agent teams with role/goal/backstory, tasks with context chaining.",
            "Universal Craftsmanship Quality Gate.",
            "Google Token Resilience — pre-flight check, full repair cycle on 401.",
            "MPEG Production Engine — parallel video via FFmpeg 6.1.1.",
            "Tool Registry — single source of truth.",
            "1M-Context Auto-Escalation Chain.",
            "GraphRAG Five (R75) — graph-aware memory operations.",
          ],
        },
        {
          title: "Integrations",
          content: "OpenAI, Anthropic, Google Gemini, ElevenLabs, Stripe, Coinbase Commerce, Google Drive, Google Sheets, Google Mail, Google Calendar, OneDrive, Replit OIDC + Replit Auth, Twilio, Telegram, WhatsApp Business, Browserless, Firecrawl, OpenRouter (1000+ models), Figma (MCP).",
        },
      ],
    },
    {
      title: "Visit Us — agenticcorporation.net",
      highlight: "Scan the QR code on the cover page or visit https://agenticcorporation.net to deploy your own VisionClaw agent corporation.",
    },
  ];

  console.log("PDF_START");
  const pdf = await generateStyledPdf({
    title: "VisionClaw Agent Platform",
    subtitle: `Comprehensive Features & Security — ${DATE}`,
    companyLines: [
      "[Your Company] | EIN: [YOUR-EIN]",
      "Owner: Bob Washburn | [Your City, ST] | [YOUR-PHONE]",
      "https://agenticcorporation.net",
    ],
    coverStats: [
      { label: "Tools", value: String(TOOL_COUNT) },
      { label: "Skills", value: String(SKILLS.length) },
      { label: "Personas", value: String(PERSONAS.length) },
      { label: "Capabilities", value: "92" },
      { label: "Indexes", value: "47" },
      { label: "Tables", value: "149" },
      { label: "Models", value: "36+1000" },
      { label: "Lines of Code", value: "~180k" },
      { label: "TS Modules", value: "453" },
    ],
    sections,
    footerLines: [
      "[Your Company] — VisionClaw Agent Platform",
      `Generated ${DATE} — agenticcorporation.net`,
    ],
    fileName: "VisionClaw-Comprehensive-Features.pdf",
    folderLabel: "Platform Documentation",
    uploadToDrive: true,
  });
  console.log("PDF_RESULT:", JSON.stringify({ ok: pdf.success, viewUrl: pdf.viewUrl, fileId: pdf.fileId, size: pdf.size }));

  const txtUpload = await uploadAndShare({
    filePath: "VisionClaw-Comprehensive-Features.txt",
    fileName: "VisionClaw-Comprehensive-Features.txt",
    description: "VisionClaw Agent Platform — Complete Feature Document (Text)",
    folderLabel: "Platform Documentation",
    share: true,
  });
  console.log("TXT_RESULT:", JSON.stringify({ ok: !!txtUpload.viewUrl, viewUrl: txtUpload.viewUrl, fileId: txtUpload.fileId }));

  // Register both in project_files for project 15 (Felix presentation project)
  try {
    const stat = fs.statSync("VisionClaw-Comprehensive-Features.txt");
    await db.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, file_size, uploaded_by)
      VALUES
        (15, 'VisionClaw-Comprehensive-Features.pdf', ${pdf.viewUrl}, 'application/pdf', ${pdf.size || 0}, 'VisionClaw Agent'),
        (15, 'VisionClaw-Comprehensive-Features.txt', ${txtUpload.viewUrl}, 'text/plain', ${stat.size}, 'VisionClaw Agent')
      ON CONFLICT DO NOTHING
    `);
    console.log("PROJECT_FILES: registered");
  } catch (e: any) {
    console.error("PROJECT_FILES_ERR:", e.message);
  }

  // Email
  const inboxResult: any = await getOrCreateTenantInbox(1);
  const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult.inboxId || inboxResult.email);
  const owner = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

  await sendEmail({
    inboxId,
    to: owner,
    subject: `VisionClaw Updated Features — PDF + Text (R75.A AHB Defense Layer)`,
    text: `Hi Bob,

The latest VisionClaw comprehensive features document is ready in two formats. Both are uploaded to Google Drive and registered in project 15 for Felix's presentation context.

PDF (premium styled, dark cover, branded sections, tables):
${pdf.viewUrl}

TEXT (plain-text exhaustive inventory, full tool/skill list for Felix):
${txtUpload.viewUrl}

What changed in this release (R75.A — Adversarial Humanities Benchmark Defense Layer):
- Defense-in-depth against stylistic-obfuscation jailbreaks (poetry, allegory, hermeneutics, role-play) that lift frontier ASR from 3.84% to 55.75%.
- Layer 1 — Intent Gate destyles every message into literal intent and matches against per-persona safety_profile (Robert: 8 medical categories; Felix: 5 destructive categories). Runs for subagent traffic too.
- Layer 2 — Destructive-Tool Policy registry with structured-args + trusted-persona + approval + value-cap gates. Unknown tools matching suspicious patterns fail CLOSED.
- 19/19 AHB regression tests gating CI.
- Eight code-review findings closed in the same release.
- Landing pages (Business + Technical), home dashboard, and admin sidebar all updated to surface R75.A.
- New admin "Security Audit" sidebar link.

Stats: ${TOOL_COUNT} tools | ${SKILLS.length} skills | ${PERSONAS.length} personas | 92 capabilities | 47 indexes | 149 tables | ~180k LOC.

Generated ${DATE}.
— VisionClaw Agent`,
  });
  console.log("EMAIL_SENT to", owner);

  console.log("\n=== FINAL LINKS ===");
  console.log("PDF:", pdf.viewUrl);
  console.log("TXT:", txtUpload.viewUrl);
  process.exit(0);
})().catch(e => { console.error("FATAL:", e?.message, e?.stack); process.exit(1); });
