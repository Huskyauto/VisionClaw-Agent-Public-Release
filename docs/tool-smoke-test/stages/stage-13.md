# Tool Smoke-Test — Stage 13 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `profit_and_loss`  —  **doc-only**
Generate a Profit & Loss (P&L) statement — revenue vs expenses with net income and profit margin. The core financial report for any business.
- categories: reporting · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: start_date:string, end_date:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `project`  —  **doc-only**
Manage projects — the filing cabinet system. Every customer/job gets a project folder. All files, conversations, notes, and assets are linked to the project so agents can pick up where they left off. Commands: create, get, list, update, get_state, update_state, add_file, add_note
- categories: code · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, id:number, name:string, description:string, status:string, customerName:string, customerEmail:string, tags:array, currentState:string, filename:string, filePath:string, fileType:string, fileDescription:string, driveLink:string, driveFileId:string, note:string, conversationId:number, query:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `promote_skill_candidate`  —  **doc-only**
Approve a skill_candidate and promote it to a live skill. Once promoted, it surfaces in the persona's skills documentation on next persona-sync. Use after reviewing a candidate from list_skill_candidates.
- categories: skillEvolution, tools · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `propose_procedure_edit`  —  **doc-only**
Propose a minimal surgical edit to an output-skill playbook based on accumulated evidence (lookup telemetry, delivery failures, near-miss grades). The meta-agent reads the current playbook + evidence summary and proposes a revised markdown. Inserts a row into procedure_edits with
- categories: governance, system · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: targetKind*:string, targetId*:string, evidenceWindowDays:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `propose_skill`  —  **doc-only**
R98.21 / Bob 2026-06-03 — AUTONOMOUS SKILL BUILD (jury-gated, NO human queue). Call this when you notice a reusable pattern worth saving as a skill (a recurring multi-step recipe, a tricky failure-mode workaround, a known-good prompt template, a third-party API quirk, etc.). A 3-
- categories: self_improvement, memory, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, description*:string, body*:string, category:string, source_context:string, confidence:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `publish_social_post`  —  **doc-only**
Publish a social media post to a connected platform account (X/Twitter, LinkedIn, or Instagram). Requires the platform account to be connected via Settings → Social Media. Can publish text-only or text+image posts.
- categories: marketing · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: platform*:string, content*:string, image_drive_url:string, campaign:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `pubmed_search`  —  **doc-only**
R125+4 — Search PubMed/MEDLINE for biomedical literature via NCBI E-utilities (esearch+esummary, JSON). FREE public API, no key required at modest volume. Returns normalized ScholarResult[]; abstracts are NOT included by default (esummary doesn't carry them — the agent can web_fe
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_results:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `qualify_leads`  —  **doc-only**
View the lead qualification pipeline — shows qualified, nurture, and disqualified leads with their ICP scores and grades.
- categories: leadEnrichment · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: minScore:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `quality_baseline_check`  —  **live-safe**
R98.7 — Re-scan the codebase and compare to a previously-saved baseline. CALL THIS before declaring any multi-file coding task done. Returns score delta, new god files, god files that grew >50 LOC, file/LOC deltas, and a `regressed` boolean (true if score dropped >100 OR a new go
- categories: code, system, self_improvement · speed: normal · network: no
- risk: safe (LOW)
- params: label:string, include_cycles:boolean, action:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `quality_baseline_save`  —  **doc-only**
R98.7 — Take a structural snapshot of the codebase and save it under a label. Inspired by sentrux's structural-signal sensor. CALL THIS at the START of any multi-file coding task (label='before-<task-name>'). Computes file count, total LOC, god-files (>1000 LOC), top fan-in/fan-o
- categories: code, system, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: label*:string, include_cycles:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `query_causal`  —  **live-safe**
GraphRAG causal retrieval. Returns cause→effect chains extracted from this tenant's memories and tensions. Use when the user asks 'why did X happen', 'what causes X', or 'what does X lead to'. Direction: forward = what does X cause; backward = what causes X; both = default.
- categories: memory, knowledge, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: term*:string, direction:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `query_communities`  —  **live-safe**
GraphRAG global retrieval. Search community summaries built from your knowledge graph (Louvain-clustered memories + triples) for the current tenant. Use when the user asks 'what are the themes / topics / clusters', or for high-level overviews. Returns up to N communities with lab
- categories: memory, knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: query:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `query_evidence`  —  **live-safe**
Search the evidence store for previously saved research findings. Filter by query, theme, or minimum confidence. Returns claims with their citations and confidence scores.
- categories: evidence · speed: normal · network: no
- risk: safe (LOW)
- params: query:string, theme:string, minConfidence:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `query_trace`  —  **doc-only**
R101 — Causality graphs. Fetch the full span tree for a trace_id (the unified observability layer that ties every tool call, LLM call, delegate, and subagent back to the originating user turn). Use to debug 'why did X happen' questions: pass the trace_id surfaced in result.__trac
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW) · gates: trustedPersonasOnly
- params: traceId*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (trustedPersonasOnly)

## `query_triples`  —  **live-safe**
Query temporal knowledge triples. Search by subject, predicate, and/or object. By default returns only currently-valid facts. Set include_expired=true to see historical facts. Use for answering 'what is X?', 'who does Y?', 'what changed about Z?' questions.
- categories: knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: subject:string, predicate:string, object:string, as_of:string, include_expired:boolean, wing:string, room:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `read_channels`  —  **live-safe**
Read recent messages from internal communication channels. Use to stay updated on what other personas are communicating about.
- categories: sessions · speed: normal · network: no
- risk: safe (LOW)
- params: channel:string, unreadOnly:boolean, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `read_file`  —  **live-safe**
Read the contents of a local file. Use this to read scripts, text files, configs, or any file in the workspace. Safe — read-only, cannot modify files. Supports text files only.
- categories: files · speed: normal · network: no
- risk: safe (LOW)
- params: path*:string, maxLines:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `read_output_blob`  —  **live-safe**
R117 token-saver: partial read of a sandbox blob (offloaded large tool output). When a previous tool returned a wrapped result like {truncated:true, sandboxLabel:'web_fetch-20260519...', head, tail, hint}, use this to fetch JUST the lines you need instead of pulling the whole fil
- categories: files, system · speed: normal · network: no
- risk: safe (LOW)
- params: label*:string, slice_lines:array, grep:string, grep_flags:string, context_lines:number, max_bytes:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `read_scratchpad`  —  **live-safe**
Read all entries from the delegation scratchpad for a given chain. Returns entries written by any agent in the chain.
- categories: notes · speed: normal · network: no
- risk: safe (LOW)
- params: chain_key:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `readability_extract`  —  **doc-only**
Extract clean article text from any URL using Mozilla's Readability.js (the Firefox Reader View engine). Free, runs locally, zero per-call API cost. Best for articles, blog posts, docs, news. Returns title, byline, excerpt, and clean text. Use this BEFORE firecrawl_scrape when yo
- categories: research · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: url*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 13`
