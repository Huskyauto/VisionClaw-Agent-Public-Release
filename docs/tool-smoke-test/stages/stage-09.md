# Tool Smoke-Test — Stage 9 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `inbox_sender_block`  —  **doc-only**
R104 — Block an inbound email sender. Future inbound messages from this address remain quarantined permanently and cannot reach personas. Trusted-only.
- categories: system, communication, security · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: address*:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `ingest_paper`  —  **doc-only**
Ingest a research paper (PDF or arXiv source tarball) into the knowledge library so future ensemble_query / search_knowledge / autoresearch can cite it. Idempotent — re-running on the same source is a no-op. Use when Bob attaches a paper in chat and wants it remembered, or when a
- categories: research, memory · speed: slow · network: no
- risk: safe (LOW) · gates: speed=slow (likely LLM/expensive)
- params: file_path*:string, title_hint:string, source_url:string, image_summaries:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (speed=slow (likely LLM/expensive))

## `init_character_portraits`  —  **doc-only**
R99 — Felix Visual Continuity (ViMax #1). Generate the canonical multi-view portrait set for one or more recurring characters/assets and store them in the registry. IDEMPOTENT — portraits already in the registry are skipped (no re-generation cost). Generates via gpt-image-2; view
- categories: media, product_output · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: characters*:array, default_views:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `introspect_tools`  —  **doc-only**
Inspect your own tool registry. Use 'list' to see all available tools, 'inspect' to get a specific tool's full parameter schema, or 'search' to find tools matching a capability query. This is your self-awareness layer — use it to understand what you can do before attempting a tas
- categories: tools, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, tool_name:string, query:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `invoice_aging_report`  —  **doc-only**
Generate accounts receivable aging report — shows current, 30-day, 60-day, and 90+ day overdue invoices with totals. Essential for cash flow management.
- categories: invoicing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `jury_triage`  —  **doc-only**
R125+3.6 — Multi-model jury triage for an open issue/finding. Runs the issue through 3 frontier proposers (ensemble_query frontier pool) asking for FIX/ACCEPT/REJECT verdict + rationale; computes 2-of-3 majority. Use when you face a decision you don't want to single-handedly clas
- categories: reasoning, system, safety · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly
- params: issue_text*:string, context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly)

## `knowledge_navigate`  —  **doc-only**
WALK a long uploaded document by its heading structure (TOC-style) instead of vector search. Use for long PDFs/contracts/reports where you need a specific section by name and chunk-vector retrieval might miss cross-section context. Two modes: mode='list' returns the heading tree(
- categories: knowledge, research · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: mode*:string, query:string, collection:string, doc_path:string, collection_id:number, heading_path:array, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `knowledge_nudge_stats`  —  **live-safe**
View statistics about proactively-saved knowledge nudges — information the system auto-detected as high-value from user messages and saved without being asked. Shows total nudges, recent activity, and categories.
- categories: skillEvolution · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `kpi_dashboard`  —  **doc-only**
View the KPI dashboard — shows latest values for all tracked metrics with target percentages, organized by category.
- categories: kpi · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `kpi_trend`  —  **doc-only**
View the trend history for a specific KPI metric over time. Shows values, targets, and whether it's improving or declining.
- categories: kpi · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: metric_name*:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `learn_from_reference`  —  **doc-only**
R98.14 — TASTE TRANSFER. Point Felix at a real high-quality example on the open web (YouTube video, polished webpage, public PDF, slide deck, HTML utility) and he extracts 3-8 specific, copyable patterns that make it work — then stores them as STRATEGIC_REFERENCE_V1 memory rows s
- categories: memory, self_improvement, research · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: reference_url*:string, deliverable_type*:string, what_to_learn:string, model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `legal_review`  —  **doc-only**
Analyze a contract or legal document with comprehensive risk scoring. Returns a Contract Safety Score (0-100) with letter grade, clause-by-clause risk analysis with severity ratings, missing protections detection, obligations timeline, and prioritized negotiation recommendations.
- categories: legal · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: document_text*:string, document_type*:string, party_perspective:string, industry:string, jurisdiction:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `list_adrs`  —  **live-safe**
List ARCHITECTURE DECISION RECORDS for this tenant. CALL THIS BEFORE designing anything new so you don't relitigate settled choices. Filter by status (accepted|deprecated|superseded) or tag.
- categories: memory, planning, reasoning, system · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, tag:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_agent_runs`  —  **live-safe**
List recent agent runs (parallel research, supervisor dispatches, etc.) with their status, timing, and summary. Useful for reviewing what the agentic system has been doing.
- categories: agentic, system · speed: normal · network: no
- risk: safe (LOW)
- params: limit:number, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_background_tasks`  —  **live-safe**
Use when checking on long-running work ("is my video done?"), when investigating why a follow-up tool call is blocked, or before launching another expensive job to avoid stacking. Returns active/queued/completed tasks for this tenant with status, tool name, and elapsed time.
- categories: ai · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_character_portraits`  —  **live-safe**
R99 — Felix Visual Continuity (ViMax #1). List every portrait in this tenant's registry, optionally filtered to one identifier. Call this BEFORE start_video_job to check whether a recurring character already has portraits — if not, call init_character_portraits.
- categories: media, system · speed: normal · network: no
- risk: safe (LOW)
- params: identifier:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_competitors`  —  **live-safe**
Use BEFORE producing competitive analysis, pricing decisions, or positioning copy — also when Bob asks "what changed at <competitor>" the watchlist will show snapshot deltas. Returns each tracked competitor with snapshot count and recent change count. Pair with the competitor-sna
- categories: competitorIntel · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_contracts`  —  **live-safe**
Use BEFORE renewals, when reviewing legal exposure, or when Bob asks "what contracts are expiring" — also before customer outreach to know what they signed. Returns contract rows with party, status, value, and dates. Filter by status (draft/sent/signed/active/expired/cancelled).
- categories: contracts · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_conversations`  —  **live-safe**
Use when Bob asks "find the chat where we discussed X" or when continuing work from a prior session and you need the conversation_id. Returns recent conversations with title, date, model, and message count. Pair with sessions_history for the actual transcript content.
- categories: conversations · speed: normal · network: no
- risk: safe (LOW)
- params: limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_critiques`  —  **live-safe**
Use BEFORE re-running cross_critique on the same target (don't pay twice for the same review), when Bob asks "what did the panel say about X", or when reviewing brand-voice/code-change history. Returns recent cross-critique runs with top finding and consensus count for each.
- categories: reasoning, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: limit:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 9`
