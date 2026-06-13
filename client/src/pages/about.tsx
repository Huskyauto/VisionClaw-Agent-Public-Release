import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Cpu, ArrowLeft, Users, Target, Lightbulb, Rocket, Bot, Crown, Wrench, PenTool, Shield, Search, BarChart3, Brain, Globe, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";

const LEADERSHIP: { name: string; role: string; description: string }[] = [];

const MILESTONES = [
  { year: "2024", event: "Platform development begins" },
  { year: "2025", event: "14 AI personas, 100+ tools, 37+ models live" },
  { year: "2026", event: "Round 74.13w: Felix Autonomous Loop (dry-run) — scheduled 4-hourly Daily Operating Loop wakes Felix to read inbox, scan recent conversations, and decide whether to draft a proactive action, synthesize a skill, delegate, or stand down. 14-day dry-run, per-project opt-in, monthly cost cap, hard 'ask Bob first' on customer/finance/external touch points" },
  { year: "2026", event: "Round 74.13x: Felix Verification Rail (SWD-inspired) — every Felix proposal must declare an `expected_post_state` spec; new `server/felix-verify.ts` captures pre-state and validates post-state via parameterized Drizzle SQL (LLM output never reaches sql.raw); proposal status flips to verification_failed on mismatch. Currently dry-run until 2026-05-12" },
  { year: "2026", event: "Round 74.13y: 'Fix anything that needs fixing' sweep — 8 surgical code fixes (registered 8 missing Felix tools, replaced ESM-incompatible require, added cross_critique + video_transcribe_words to expensive-tools, repaired auto-tuner heartbeat-logs join, named PLATFORM_OWNER_TENANT_ID constant, un-swallowed Felix proposal catch, normalized checkout idempotency key) + cleaned 7 stale test tenants in one atomic transaction. Architect: zero HIGH/MEDIUM" },
  { year: "2026", event: "Round 74.13z: Recursive language-model recovery + `recursive_synthesize` tool — when a model emits an overflow/error signature, automatic recursive synthesis falls back to summarize-then-retry instead of dropping the conversation" },
  { year: "2026", event: "Round 74.13z-quat: 8-point Operating Doctrine + 1M-context auto-escalation chain — Gemini 3.1 Pro (1M, free) → Claude Opus 4.7 (1M, free) → Nemotron 3 Super (1M) → Grok 4.1 Fast (2M); lossy truncation only fires if every chain entry overflows (essentially never). Long-running conversations finish with full history intact" },
  { year: "2026", event: "Round 74.13z-quint+2: DreamGraph nuggets — three first-class primitives (tensions table for 'predicted X, got Y' mismatches; architecture_decisions table with full Michael Nygard ADR shape; /api/graph-explorer admin page with SVG node-link visualization). 6 new tools across all 16 personas, surprise-scorer auto-creates a tension on every red-band proposal (15-min cooldown), Doctrine #10 appended platform-wide" },
  { year: "2026", event: "Round 74.13z-quint+3: Tool Sommelier + flounder detector — async curator boots 5 minutes after server start, runs every 24h, reads tool_performance + dormant-tool list per tenant, calls gpt-5-mini, writes ≤5 short ADR playbooks per cycle ('when X, use Y because Z') that auto-inject into every persona's system prompt. Flounder detector files a tension whenever a response promises action without invoking a single tool — closing the loop self-correctingly" },
  { year: "2026", event: "Personality system, 5 congruence safeguards, live agent board" },
  { year: "2025", event: "MCP Server integration — open protocol for any AI client" },
  { year: "2025", event: "AI Tinkerers Chicago technical showcase" },
  { year: "2026", event: "Round 13: zero-cost article extraction (Mozilla Readability) + LLM-Scraper template recipes that graduate to deterministic parsers after 3 cache hits" },
  { year: "2026", event: "Round 18: Per-tenant personalization (user profile + skill disable lists) and 3-phase Dreaming (Light/Deep/REM) with Dream Diary entries" },
  { year: "2026", event: "Round 20: Glasses Gateway — Meta Ray-Ban smart glasses streaming live vision and audio to Gemini Live with sub-second voice replies" },
  { year: "2026", event: "Round 21: Mixture of Agents (MoA) — 4 parallel proposers + Claude Opus aggregator for ensemble-quality answers, with full per-call cost ledger" },
  { year: "2026", event: "Round 22: Cost Optimizer — cost-eval-runner.ts runs a frozen 20-query benchmark against each candidate model and stores numeric cost + judge score; ±% baseline deltas now visible on every experiment row" },
  { year: "2026", event: "Round 25: Self-Improving Codebase — nightly research generates real code edits, proposal-verifier.ts shadow-compiles each in an isolated git worktree, only verified proposals reach the admin Apply button" },
  { year: "2026", event: "Round 32: Minerva (15th persona) joins as Chief Planner — Strategic Plan Architect" },
  { year: "2026", event: "Round 34: Internal Event Resolver — CAS-overlay finalizes every event_log entry into one of 5 terminal statuses with watchdog scanning for orphans every 30s" },
  { year: "2026", event: "Round 35: Cost-Telemetry Parity — every chat, embedding, TTS, and Whisper call now flows through the metered OpenAI client factory" },
  { year: "2026", event: "Round 55: Autonomous research loop closed — 6 sessions running concurrently, 225+ experiments/day, weekly cron correctly advanced" },
  { year: "2026", event: "Round 56: Felix-wellness intervention cluster — Robert (persona 16) wellness-coaching coach, fatigue/intervention/effectiveness pipeline, somatic circuit-breaker, shame-spiral grounding scripts ([Your Product])" },
  { year: "2026", event: "Round 60.B: Durable agent job queue — single work queue with crash recovery, exponential backoff, dead-letter handling, and lease fencing for true autonomy" },
  { year: "2026", event: "Round 63: Proactive self-healing engine — insights auto-apply on safe categories, HIGH-priority items auto-route to Minerva → Felix queue, dead-lettered tasks self-remediate, idempotent plan creation, heartbeat hardened to 600s for heavy engines" },
  { year: "2026", event: "Round 64: File-upload + prompt-injection defenses — Magika MIME sniffing, fail-closed scan_file, treat-as-data wrapping for KB blocks, sanitized prior-message previews" },
  { year: "2026", event: "Round 68: Step ledger + SSE + world replay (OpenThymos-inspired) — every agent step persisted, live-streamed to UI, fully replayable post-hoc" },
  { year: "2026", event: "Round 70: Health Audit Module — bidirectional tool-registry integrity scan, dormant-tool flagging, wiring tripwire on every boot" },
  { year: "2026", event: "Round 71: Audit hardening + nightly auto-run — health audit fires every night, results pinned to a permanent slot, drift surfaces within 24h" },
  { year: "2026", event: "Round 73: Magentic-One ledger orchestrator + universal model catalog — 36 core models in registry plus 1000+ discovered daily via OpenRouter probe" },
  { year: "2026", event: "Round 74: Security hot-fix bundle — cross-tenant email fail-closed, Stripe Connect tenant fail-open patched, pre-auth operational endpoints gated to admin" },
  { year: "2026", event: "Round 74.2: Transient 5xx auto-retry — `fetchWithTransientRetry` wraps every API call so cold-start hiccups recover transparently instead of surfacing as hard errors" },
  { year: "2026", event: "Round 74.3: Whole-app 3-pass architect review — 5 HIGH + 6 MEDIUM hardening bundle (Minerva CAS, KB-injection wrapper, R74.A/B/C closures, /api/cache/stats + /api/drive-health admin gates)" },
  { year: "2026", event: "Round 74.4: Persona augmentation pass — 4 nuggets mined from MIT-licensed agency-agents repo: Forge gains Incident Response Commander (SEV1-4 protocol + 48hr blameless post-mortem), Teagan gains AEO/GEO citation playbook (ChatGPT/Claude/Gemini/Perplexity audit-fix-recheck cycle), Atlas gains YouTube/Shorts/TikTok/Reels analytics (CTR + retention curve + 30s-hook test), Robert gains purposeful-warmth principle (lightness serves emotional purpose, never replaces empathy)" },
  { year: "2026", event: "Round 74.5: Tenant-isolation hardening — 14 fail-open patches: cross-tenant session-key access closed (sessions_list/history/send), manage_skills admin-gated, workflow fast-path now sanitized, writeDailyNote tenant-required, /api/upload-base64 byte-level type validation, presenterToken redacted in logs, public-chat tool dispatch fail-closed" },
  { year: "2026", event: "Round 74.9: Auto-route ensemble + active clarification + Skill-RAG analytics — chat engine auto-detects technical/strategic/multi-step queries via regex+keyword scorer and force-invokes the R74.7 4-LLM MoA pipeline; 2-stage gate asks one targeted clarifying question instead of guessing when input ambiguity is high; every Skill-RAG decision persisted to skill_rag_decisions for observability and threshold tuning" },
  { year: "2026", event: "Round 74.13d: Eleven-fix security sweep across two architect passes — WAVE 1 multi-tenant isolation extended to background services (heartbeat memory + knowledge + daily notes + task list + activity logs all tenant-scoped at storage layer); WAVE 2 encryption at rest (Telegram bot tokens + WhatsApp/Baileys session creds, AES-256-GCM via SESSION_SECRET-derived key, backward-compatible); WAVE 3 auth-secret hashing (HMAC-SHA256 for password reset tokens + email verification codes), upload-signing fail-closes in production without SESSION_SECRET, OAuth callback host pinned to allowlist. Republish hot-fix recovered an auto-migrate that wanted to drop the new whatsapp_auth table — fixed via direct psql ALTER without touching encrypted creds" },
  { year: "2026", event: "Round 74.13g + fix1-4: Tenant-context hardening — full audit of all 138 schema tables (80 strict / 5 fail-open documented / 3 nullable / 4 parent-linked / 8 global); new tenantScope() storage helper rejects every fail-open shape (zero, NaN, negative, fractional, string-coerced, null, boolean, object) and now backs 8 storage-layer call sites; new STRICT_TENANT_CONTEXT env flag + assertTenantContext() runtime guard rolled out at 4 entry points (heartbeat L599/L679/L788, chat-engine L1973) and threaded through 17 chat-engine sites, 4 hardcoded tenantId:1 writes in processTaskOutput, and 5 daily-note + memory-archive helpers; end-to-end propagation test exercises live-DB persist round-trip through chat → assertTenantContext → step-ledger → AsyncLocalStorage → recordExecution; 5-pass Furrow architect review found and closed 31 distinct defects before returning PASS in a single session; 41 new tests bring the security suite to 158 tests across 16 files in 6 categories, all green; full code-location map in docs/EVIDENCE.md Round 15 section" },
  { year: "2026", event: "Round 74.13u-sec: Five-fix security sweep — platform-admin routes hard-gated to requirePlatformAdmin (admin tenant + admin role); Stripe Checkout validates priceId against live stripe.prices+stripe.products (active=true) and refuses non-canonical domains in production; decryptApiKey throws DecryptionError on enc:v1: failure (no silent ciphertext leak); Drive backup of conversations now scoped by tenant_id; CSRF tokens keyed per-session (Bearer-hash → Replit sub → tenantId)" },
  { year: "2026", event: "Round 74.13u-2: Webhook reliability rebuild — durable webhook_events table with claim-then-commit dedupe pattern (PK on provider+event_id, completed_at NULL until side effects succeed); transient processing failure leaves the row uncommitted so the next provider retry is allowed through; 6-hour scheduler GCs committed dedupe rows older than 14 days while explicitly preserving in-flight claims; swallow-catches across the webhook subsystem removed" },
  { year: "2026", event: "Round 74.13v: Borrowed-Best-Practice Pass — MCP plugin manifests for Claude Code/Cursor/Codex CLI marketplaces (per-tenant VISIONCLAW_MCP_KEY Bearer auth, all 264 tools under tenant isolation), 'search-before-reading' discipline injected as a non-negotiable preamble into the operating loops of personas 1/2/3 (closes Felix's stale-blocker failure mode), code-health scanner made resumable with JSON checkpoint sidecar (every 50 files, 1h freshness window), new Agentic Edge landing section with four pinned numbers, and new AGENTS.md companion file at repo root for non-Replit coding hosts" },
  { year: "2026", event: "Round 74.13y: Felix Loop closure — 8 surgical hardening fixes (verification-rail edge cases, plan-step idempotency, expected-state schema validation, retry/escalate path, operator-inbox enrichment, plan-step audit-log indexing, post-state contract typing, performance backfill); 7 abandoned test tenants archived in a single sweep; comprehensive features PDF + text regenerated and emailed; public mirror force-pushed clean (1162 files, all 90+ leak checks passed)" },
  { year: "2026", event: "Round 74.13z + bis + tris: Recursive Language Model recovery — Algorithm 1 from Zhang/Kraska/Khattab (arXiv:2512.24601v2, MIT CSAIL Jan 2026) implemented as last-ditch chat recovery using a sandboxed Node vm REPL with delete-after-bridge isolation and modelfarm gpt-5.4 root + gpt-5-mini sub (both $0); recursive_synthesize exposed as a first-class tool any persona can call explicitly; whole-app multi-area architect review fixed Felix monthly cap atomicity (pg_advisory_xact_lock), wired AbortController into RLM recovery so client disconnects don't leak sub-call capacity, gated direct executeTool callers through the rate limiter, and added Stripe webhook livemode parity check (test events can no longer trigger production plan activations)" },
  { year: "2026", event: "Round 74.13z-quat: Operating Doctrine + 1M-context auto-escalation — 8-point Operating Doctrine (Drive to Completion, Use the Tools You Have, When Stuck Change Strategy, Three-Strike Rule, Don't Hand Back Solvable Problems, Recognize Leverage, Finish-Line Self-Review, Trust the 1M-Context Auto-Escalation) added to the top of the platform tools contract — first thing every persona reads — and synced to all 16 active personas (tools_doc grew ~17K → ~21.5K chars); context-overflow auto-escalation chain Gemini 3.1 Pro (1M, free) → Claude Opus 4.7 (1M, free) → Nemotron 3 Super (1M, cheap) → Grok 4.1 Fast (2M) replaces lossy emergency truncation, so long-context jobs finish with the full conversation intact instead of dying mid-thought" },
  { year: "2026", event: "Round 75 — GraphRAG Five (graphrag-rs port, MIT, additive only): PageRank node importance via graphology (alpha=0.85), Louvain community detection with LLM-summarized clusters (gpt-5-mini, deduped via tenant_id+chain_hash unique index), causal chain extraction (cause→effect with confidence + time-lag), context-aware code chunking (cAST regex splitter), and dual-level retrieval in `recall_context` (level=local|global|causal|auto routing). Three new tools — `query_communities`, `query_causal`, `chunk_code` — registered, surfaced in the per-persona reference manual, and routed by both keywords and semantic similarity. Wired into the existing 3-phase dreaming scheduler (importance every Deep cycle, communities gated ≥10 nodes/6h, causal in REM phase only). All 16 active personas updated with Doctrine #11 — GraphRAG Routing. Verified by 8/8 IDOR regression matrix + architect PASS" },
  { year: "2026", event: "Round 75.1 — Wiring + hardening follow-up: closed three architect findings. CRITICAL — removed the unsafe filesystem fallback in `recallCompactionArchive` that previously read archive files filtered only by `conv-{id}_*` prefix with no tenant check on DB outage (cross-tenant leak path); now fail-closed. MEDIUM — `recallCompactionArchive` now strictly requires `tenantId` (was fail-open via `(tenantId||0)=0 OR ...`); `recall_context` no longer hard-fails when no `conversationId` is in scope (the cause of the historical 30% fail rate) — falls back to a tenant-scoped query with strict `_tenantId>0` guard preserved upstream. Re-verified 8/8 PASS" },
  { year: "2026", event: "Round 76 — Trust-Tier Policy Engine + Deliverable Contract Verification (additive only): new `tool_policies` table (per-tenant: tool, sub-action, recipient_pattern, amount_cap, expires_at, action ∈ {allow, deny, require_approval}) + `policy_audit` table; `evaluatePolicy()` ranks by specificity (recipient_pattern > tool_action > tool; exact > wildcard; deny beats allow in the top tier). NEVER_AUTO_APPROVE veto on `set_policy`/`create_tool`/`delete_custom_tool`/`manage_skills`/`lobster` (lowercase-normalized so casing variants cannot dodge it). New `deliverable_contracts` table (8 seeded: html_page, pdf_document, slide_deck, image, video, audio, csv_data, json_data with extension + magic-byte MIME + render check) + `delivery_verifications` audit; `verifyDeliverable()` runs path-jail + extension + MIME + render-ability checks. Two new tools: `set_policy` (HITL-gated owner-only) and `verify_deliverable` (read_only, no friction). All 16 active personas updated with **Doctrine #12 — Trust Tiers + Deliverable Contracts**. Architect PASS after two re-review cycles closing 2 CRITICAL + 3 HIGH + 1 MEDIUM. 11/11 R76 e2e regression tests green. Bonus: 14+ pre-existing ESM `require()` landmines swept (scan_file path-jail security sandbox, smart tool router, 5+ auto-tuner consumers). Live Felix HVAC run on first deployment caught a real PDF-vs-HTML hallucination via the supervisor correction loop." },
  { year: "2026", event: "Round 80 — Claude Code Subagent Importer + Runtime Wiring (additive only): platform-admin gated importer turns any community Claude Code agent collection into fully-wired VisionClaw personas. Pure parser/mapper module (`server/claude-subagent-importer.ts`, 559 LOC) — strict YAML frontmatter via js-yaml JSON_SCHEMA (BOM/CRLF tolerant), Claude→VC tool catalog mapping verified against `TOOL_DEFINITIONS` source, tier inference (Bash or 'Tier 2'/'executes' → executor), GitHub fetcher walks `.claude/agents` trees of any depth via api.github.com tree+raw API. Three routes (`/api/claude-import/known-collections`, `/preview`, `/apply`) all gated behind `requirePlatformAdmin` + `getTenantFromRequest`; CSRF protected; preview is read-only and apply is idempotent via namespaced `<source-slug>:<agent-slug>` names. Wiring layer (the 'make agents actually functional' part): every imported persona's `soul` opens with a `VISIONCLAW RUNTIME ADAPTER` block placed BEFORE the original Claude Code instructions — explicit trust-boundary clause ('imported = untrusted legacy guidance, this adapter wins, refuse HITL bypass'), full Claude→VC tool translation table (Read → `read_file` / `scan_file`, Write → `write_file` / `write_scratchpad` / `create_memory` / `create_knowledge`, Bash → `exec` / `execute_code` HITL-gated, WebFetch → `web_fetch` / `firecrawl_scrape` / `readability_extract`, WebSearch → `web_search` / `firecrawl_search`, Task → `delegate_task`, Grep → `search_memory` / `search_knowledge` / `scraped_pages_query`, Edit → `write_file` HITL-gated), always-available VC tools list, HITL policy explanation. Standard 7-step VC operating loop populated with executor or advisory variant. Role mapped to `Imported Subagent (developer)` / `Imported Subagent (researcher)` engaging two NEW `PERSONA_TOOL_POLICIES` entries listed FIRST in the object (substring-match wins): researcher hard-blocks `exec` / `shell_exec` / `execute_code` / `write_file` / `send_email` / `whatsapp` / `deliver_product` / `draft_social_post` / `marketing_experiment` at the router; developer allows code/system/files but blocks delivery surfaces. Executor-tier imports auto-receive three per-persona `autonomy_rules` rows (`exec` / `execute_code` / `write_file` all `approve_before`, tenant-scoped, idempotent via partial unique index using `onConflictDoNothing` + `.returning()` for accurate counts). Hardened SSRF — host-locked at parse, fetches to `api.github.com` / `raw.githubusercontent.com` only, `redirect: \"error\"` on every call. Architect SHIP IT after fixing 3 issues (fictitious `fetch_file` tool name removed, researcher policy gaps closed, trust boundary made explicit). 43 importer tests + 62 security tests green, tsc clean." },
  { year: "2026", event: "Round 83-93 — Comprehensive 24h Security Sweep (additive, fully shipped May 2-3 2026): nine R-bundles closing every defect surfaced by three parallel architect reviews of the entire app. R83 streaming-aware AnthropicPromptCache with per-tenant entry quotas; R84 audit-reasoning + reasoning-extractor sandbox; R85 prompt-injection scanner ported from Hermes Alpha (10 threat patterns + invisible-unicode steganography); R86/R91 streaming wiring + glasses fail-closed on missing tenant binding; R87 context-compressor with token-aware budgets; R88 error-context-parser + tool-call-fallback-parser (LLM emits malformed XML/JSON tool-calls and the parser still recovers); R89 orphan tool_call/tool_result repair after truncation (Anthropic + OpenAI strict-alternation); R90 context-files-loader with scanner gate; R92 self-heal + auto-memorize explicit ADMIN tenant attribution; R93 tenant-attribution propagated to 7 cross-cutting callsites (felix-loop, plan-executor, ceo-orchestrator, cross-critique, distributed-slides, auto-memorize, self-heal). Plus the comprehensive R94 batch shipped same window: write_file shared blocklist + symlink-ancestor walk; claude-import scanContextContent injection scan on every imported persona/agent body BEFORE persistence; escalation per-tenant hourly quota (20/hr) so a single noisy tenant cannot drain the platform escalation budget; SHA256 cache keys on metered OpenAI clients (collision-resistant, periodic prune); truncateWithSummary system→user role demotion (history summaries are now untrusted reference data, not policy — closes a prompt-injection privilege-escalation path); cleanedFullResponse `<tool_call>` tag stripping; disconnect persistence guard (client-aborted streams no longer trigger title-gen + hook side effects); 5 tools.ts runLlmTask sites tenant-threaded" },
  { year: "2026", event: "Round 94 — Tenant Cost-Attribution Integrity (additive, May 3 2026): brand-new server/lib/tenant-context.ts with AsyncLocalStorage-backed tenant context propagation. authMiddleware now wraps every authenticated path (vc_ API key, session token, Replit OIDC) in runWithTenant() so every downstream await — including singleton replitOpenai chat/embeddings/audio/STT calls — bills the correct tenant. AsyncLocalStorage wraps extended to: glasses gateway (api-key auth), MCP server (both global-key and per-tenant derived keys), background job worker (job.tenantId), and tool-sommelier nightly cron (per-tenant cycle). Public chat passes convTenantId explicitly to getClientForModel. createMeteredOpenAIClient resolveTenant() priority chain: explicit opts.tenantId → AsyncLocalStorage current → ADMIN warn-once-per-stack-trace fallback (so misses are loud, not silent). truncateWithSummary now merges the summary into the first kept user turn when needed (Anthropic strict-alternation safe). scan_file gains symlink rejection + realpath re-validation (parity with read_file/write_file). Persona create/update routes scan soul/agentsDoc/heartbeatDoc/brandVoiceDoc/identity/tools for prompt injection BEFORE DB write; mind soul scanned identically. **Critical runtime bug caught in Felix HVAC live test:** the original implementation used CommonJS require() inside the resolver, which threw silently in tsx/ESM dev mode and made every cost lookup fall back to ADMIN — fixed by promoting to a top-of-file static import (no circular risk; tenant-context.ts only depends on node:async_hooks). Three parallel architect reviews + Felix HVAC end-to-end test confirmed clean boot, no `require is not defined` warnings, no `cost-track failed` warnings under normal traffic. 9 distinct High-severity findings closed in a single session." },
  { year: "2026", event: "Current state: 16 built-in personas + unlimited Claude Code imports, 391 tools, 126 active capabilities, R105 three-nugget cherry-pick from VectifyAI/PageIndex (hierarchical heading-tree at PDF ingest into the new doc_heading_trees table + new knowledge_navigate tool with list/read modes + low-κ HITL fallback hint), R105.1 +sec same-pass closed two architect findings (HIGH cross-tenant disclosure in commitments owner-digest now redacted; MEDIUM owner-email-digest persistence now uses atomicWriteFile), R104 four-nugget cherry-pick from openclaw/openclaw (image-gen SSRF audit codified + bounded subprocess output helper + unknown-sender inbox quarantine gate with 4 trusted-only tools + commitments primitive with 5 tools and 30-min scanner; architect cross-app sweep same-pass-fixed two HIGH regressions: R102 per-tenant chat rate limit was unwired, R104 quarantine bypassable via check_inbox), R103 owner email digest gate (sendEmail() batches owner-only sends into one daily summary), R102 admission control with per-tenant 60 req/min token-bucket rate limit, R101 causality graphs (per-turn span tree, agent_trace_spans table, query_trace tool), R100 transactional no-regression with undo_last_action, R98.19+sec Whole-App Code Review Sweep (3 architect rounds, 6 real bugs closed including 5 silent-bypass HIGHs in security primitives — provider-error secret redaction was passing through unredacted, gate_command untrusted-stdout fence was silently degrading, wrapAsData fence builder crash, presenter constant-time HMAC compare was hard-blocking every request with 403, and the Claude-agent GitHub importer's prompt-injection scanner was being skipped entirely allowing imported personas to carry 'ignore previous instructions' payloads into the durable system prompt; scanner catch tightened from 'false fail-closed' to true fail-closed quarantine), R98.19 Memory v2 (confidence-scored facts + 30s debounced write queue + synthesis-time Jaccard dedup + 8K token cap on recall context, all 16 personas re-seeded), 557 production indexes, 62 skills, 189 tables, 41 governance rules, 41 curated models + 4-model 1M+ context fallback chain (Gemini 3.1 Pro / Claude Opus 4.7 / Nemotron 3 Super / Grok 4.1 Fast) + 1000+ daily OpenRouter catalog, ~115K server LOC + ~42K client LOC, 158 security tests across 16 files in 6 categories — R98.18+sec Self-Healing Maintenance Sweep (Bob asked the platform to fix three alert emails on its own and it did: GitHub CI was already auto-resolved by the Agentic CI Self-Healer, then drizzle-orm 0.39 → 0.45 closed HIGH SQL-injection CVE GHSA-gpj5-g38j-94v9, xlsx removed entirely with the one runtime call site migrated to existing exceljs to close HIGH Prototype Pollution + ReDoS, health-monitor ALERT_THRESHOLD bumped 2 → 3 so transient Neon blips no longer page; npm audit dropped 2 HIGH → 0 HIGH / 0 CRITICAL; architect caught a real regression in the initial xlsx swap and both fixes shipped in-session), R98.17 Cairo Cross-Pollination, R98.16 IJFW Cross-Pollination (8 features lifted from gitlab.com/therealseandonahoe/ijfw: run_command #296 with large-output sandbox + wave-table parallelism on plan_deliverable + translateLlmError actionable error UX + sanitizeUntrusted heading/system-tag defang + atomicWriteFileSync at 6 critical persistence sites + DeepSeek architect lineage + minResponsesFanOut productive-only counting + Gemini ?key= URL audit clean), R98.16+sec (HIGH access-control hoist on run_command list_outputs/get_output), R98.16+wiring (Felix + Forge operating_loop sections re-seeded across all 16 personas), R98.16+sec-2 (whole-app architect sweep — 6 of 16 findings closed: CRITICAL secret-redact in translateLlmError, HIGH SSRF jail extended for CGNAT/multicast/IPv6/internal cluster TLDs, HIGH output-sandbox switched to atomicWriteFileSync, MEDIUM retrieve_hint absolute-path leak removed, LOW atomic-write tmp-file cleanup on rename failure), R94 Tenant Cost-Attribution Integrity (AsyncLocalStorage tenant context end-to-end with persona/mind injection-scan-on-write and scan_file symlink defense), R83-R93 Comprehensive 24h Security Sweep (9 R-bundles closing every defect from three parallel architect reviews), R80 Claude Code Subagent Importer with runtime adapter / tier-aware tool-router policies / per-persona autonomy rules, R79 MarTech Bundle (build_voice_profile / get_voice_profile / generate_hooks / format_post / generate_content_matrix / score_post), Operating Doctrine on every persona (R74.13z-quat), tensions + ADRs + graph-explorer primitives (R74.13z-quint+2), Tool Sommelier with self-correcting flounder loop (R74.13z-quint+3), 1M-context auto-escalation, recursive language model recovery + recursive_synthesize tool (R74.13z), Felix Verification Rail (R74.13x), Felix Daily Operating Loop (R74.13w, dry-run), MCP plugin marketplaces (Claude Code/Cursor/Codex CLI, R74.13v), cross-AI critique panel, auto-memory loop, brand-voice contract, proactive self-healing, encryption at rest for sensitive credentials (AES-256-GCM), HMAC-SHA256 hashed auth secrets, strict tenant-context propagation end-to-end (request scope + background jobs + cron + glasses + MCP + public chat), durable webhook event dedupe with claim-then-commit semantics + livemode parity check, atomic Felix monthly cap, AbortController-wired RLM recovery, ~97% autonomy" },
];

const PERSONAS = [
  { name: "VisionClaw", role: "Personal AI Assistant", icon: Bot },
  { name: "Felix", role: "CEO & Orchestrator", icon: Crown },
  { name: "Forge", role: "CTO & Staff Engineer", icon: Wrench },
  { name: "Teagan", role: "CMO & Marketing", icon: PenTool },
  { name: "Blueprint", role: "VP Engineering", icon: Workflow },
  { name: "Chief of Staff", role: "Operations Director", icon: Crown },
  { name: "Proof", role: "QA Director", icon: Shield },
  { name: "Radar", role: "Intelligence Analyst", icon: Search },
  { name: "Neptune", role: "Wellness Specialist", icon: Globe },
  { name: "Apollo", role: "Strategy & Revenue", icon: BarChart3 },
  { name: "Atlas", role: "Data Analyst", icon: Brain },
  { name: "Cassandra", role: "Risk Analyst", icon: Shield },
  { name: "Luna", role: "Creative Director", icon: Lightbulb },
  { name: "Scribe", role: "Content Director", icon: PenTool },
  { name: "Minerva", role: "Chief Planner — Strategic Plan Architect", icon: Workflow },
  { name: "Robert", role: "Late-Night Companion & Wellness Coach", icon: Brain },
];

export default function AboutPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`About ${config.platformName}`}
        description={`Meet the team behind ${config.platformName}. An autonomous AI corporation platform with 16 built-in specialist agents (plus unlimited Claude Code subagent imports via the R80 GitHub importer with runtime adapter, tier-aware tool-router blocks, and per-persona HITL autonomy rules), 391 tools, 126 active capabilities (R105 PageIndex three-nugget cherry-pick: hierarchical heading-tree at PDF ingest into the new doc_heading_trees table, knowledge_navigate tool with list/read modes, and a low-κ HITL fallback hint that surfaces the tree-walk option before paging an operator; R105.1 +sec architect post-edit closed HIGH cross-tenant disclosure in the commitments owner-digest body and added an atomicWriteFile helper for digest persistence; including the R79 MarTech Bundle: brand-voice profiling, hook generation, format-driven post writing, content matrix planning, and brutally-honest post scoring; R98.10 added the slash_command tool, the 284th, with fail-closed persona gates from R98.10+sec / R98.11+sec / R98.11+sec2; R98.16 added run_command, the 296th, with large-output sandbox + auto-summary, owner-tenant + Felix/Forge gated, plus a +sec patch hoisting the auth gate above all three actions and a +sec-2 architect sweep that closed 6 findings including CRITICAL secret-redaction in translateLlmError and HIGH SSRF-jail extension for CGNAT/multicast/IPv6/internal cluster TLDs; R98.18+sec self-healing maintenance round closed two more HIGH dependency CVEs — drizzle-orm SQL-injection identifier-escape GHSA-gpj5-g38j-94v9 by upgrading 0.39 → 0.45, and xlsx Prototype Pollution + ReDoS by removing the package entirely and migrating the one runtime call site to the already-installed exceljs; npm audit went from 2 HIGH to 0 HIGH / 0 CRITICAL), 62 skills, 189 tables, 41 governance rules, 41 curated models in registry + 4-model 1M+ context fallback chain (Gemini 3.1 Pro, Claude Opus 4.7, Nemotron 3 Super, Grok 4.1 Fast) plus 1000+ discovered daily via OpenRouter, an 8-point Operating Doctrine on every persona, a recursive language model recovery hook (sandboxed Node vm REPL), a Felix Loop verification rail with expected-post-state contracts on every plan step, MCP plugin manifests for Claude Code/Cursor/Codex CLI marketplaces, a Donahoe-Trident cross-AI critique panel, an auto-memory synthesis loop, a proactive self-healing engine, encryption-at-rest for sensitive credentials, and HMAC-hashed auth secrets.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-about-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-about-title">About {config.platformName}</h1>
        <p className="text-lg text-muted-foreground mb-10">{config.platformTagline}</p>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Our Mission</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed text-lg">
            {config.platformName} is a multi-tenant agentic AI platform that gives every business access to a full corporate AI team. Instead of hiring separate specialists, you get 16 AI personas — each with deep expertise — working together through 391 tools and 41 curated AI models in the registry plus 1000+ models discovered daily via OpenRouter, with a 4-model 1M+ token context fallback chain (Gemini 3.1 Pro → Claude Opus 4.7 → Nemotron 3 Super → Grok 4.1 Fast) so long-context conversations never die mid-thought. As of Round 74.13d (April 2026) the platform is genuinely proactive AND defensively hardened across three layers: foreground tool execution is tenant-isolated and admin-gated where appropriate, background services (heartbeat memory, knowledge writes, daily notes, task list, activity logs) are tenant-scoped at the storage layer, and the most sensitive secrets — Telegram bot tokens, WhatsApp/Baileys session credentials, password reset tokens, email verification codes — are encrypted or HMAC-hashed at rest. Low-risk insights auto-apply on every engine run, high-priority items draft a Minerva plan and land in Felix's approval queue, dead-lettered scheduled tasks self-remediate. We believe powerful AI shouldn't require a Fortune 500 budget or a team of engineers. Whether you want a full AI workforce on subscription, or a one-off productized deliverable from our Store, we meet you where you are.
          </p>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Lightbulb className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">What Makes Us Different</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Multi-Agent Architecture</h3>
                <p className="text-sm text-muted-foreground">16 specialized AI personas that collaborate on complex tasks — from CEO-level strategy to code deployment to content marketing to strategic planning to wellness-coaching coaching.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">391 Integrated Tools</h3>
                <p className="text-sm text-muted-foreground">Email, Google Workspace, Stripe, browser automation, research engines, social media, presentations, memory palace, knowledge triples, recursive language model synthesis, and more — all accessible through natural conversation. Every call is cost-metered (R35), file uploads MIME-sniffed (R64), and the centralized Tool Registry catches drift on every boot (R70/R71). On context overflow the platform auto-escalates to a 1M-token-window model instead of truncating (R74.13z-quat). R106 added 7 reflexive operating primitives (failure attribution L0–L5, parallel findings bus, near-miss grading, pinned hypotheses, plan-on-Graph DAG editing) wired across all 16 personas.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Model Flexibility</h3>
                <p className="text-sm text-muted-foreground">41 curated AI models from OpenAI, Anthropic, Google, xAI, and DeepSeek, plus 1000+ additional models discovered daily via OpenRouter probe. Subscription-First Routing (BYOS) uses your ChatGPT Plus / Gemini OAuth tokens for $0/token primary inference. Claude Runner bridge active for $0/token Anthropic on Max plan. Cost-aware routing always prefers free → cheap → paid.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Open Protocol (MCP)</h3>
                <p className="text-sm text-muted-foreground">Full Model Context Protocol server — connect any MCP-compatible AI client to the platform's complete tool suite.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Productized AI Services</h3>
                <p className="text-sm text-muted-foreground">Don't want a subscription? Buy a finished deliverable. Our Store starts with the $49 Custom AI Research Report — your topic in, a polished, human-reviewed PDF out. More productized services rolling out as the pipeline graduates each one to fully autonomous delivery.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-2">Human-Reviewed Until Proven</h3>
                <p className="text-sm text-muted-foreground">Every service-product order is proofread by a human before it ships, with automated quality gates checking page count, content depth, and download-link integrity. A product graduates to autonomous delivery only after a clean track record — and snaps back to manual review if anything ever ships broken.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Leadership</h2>
          </div>
          {LEADERSHIP.map((person) => (
            <Card key={person.name} className="mb-4">
              <CardContent className="p-5">
                <h3 className="font-semibold text-lg">{person.name}</h3>
                <p className="text-primary text-sm mb-2">{person.role}</p>
                <p className="text-muted-foreground">{person.description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Bot className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">The AI Team</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {PERSONAS.map((p) => (
              <div key={p.name} className="flex items-center gap-2 p-3 rounded-lg border border-border bg-card">
                <p.icon className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.role}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Rocket className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Timeline</h2>
          </div>
          <div className="space-y-3">
            {MILESTONES.map((m, i) => (
              <div key={i} className="flex items-start gap-4 p-3 rounded-lg border border-border bg-card">
                <span className="text-primary font-bold text-sm min-w-[3rem]">{m.year}</span>
                <p className="text-sm text-muted-foreground">{m.event}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-6 h-6 text-primary" />
            <h2 className="text-2xl font-semibold">Company Information</h2>
          </div>
          <div className="text-muted-foreground space-y-1">
            <p><strong>Platform:</strong> {config.platformName} Agent Platform</p>
          </div>
        </section>

        <div className="mt-12 pt-8 border-t border-border flex gap-3 flex-wrap">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-about-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <Button variant="outline" onClick={() => navigate("/store")} data-testid="button-about-store">
            Shop Bob's Store
          </Button>
          <Button onClick={() => navigate("/contact")} data-testid="button-about-contact">
            Contact Us
          </Button>
        </div>
      </div>

      <footer className="border-t border-border py-8 px-6 mt-8">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <span data-testid="text-about-footer-copyright">&copy; {new Date().getFullYear()} {config.platformName}. All rights reserved.</span>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => navigate("/landing")} className="hover:text-foreground transition-colors" data-testid="link-about-footer-home">Home</button>
            <button onClick={() => navigate("/store")} className="hover:text-foreground transition-colors" data-testid="link-about-footer-store">Shop</button>
            <button onClick={() => navigate("/contact")} className="hover:text-foreground transition-colors" data-testid="link-about-footer-contact">Contact</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
