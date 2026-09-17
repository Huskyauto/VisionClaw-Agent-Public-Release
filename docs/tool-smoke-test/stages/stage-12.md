# Tool Smoke-Test — Stage 12 of 21

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `mission_portfolio_review`  —  **live-safe**
Deterministic ADVISORY review of the whole Revenue Mission portfolio (capital allocator): flags over-capacity (max 2 active unproven missions), kill signals (contacts with no traction), and scale candidates (verified realized margin only — revenue minus refunds minus spend from S
- categories: business · speed: fast · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `monid_catalog_browse`  —  **live-safe**
FREE local browse of the curated VCA-fit Monid endpoint snapshot (no API call, no spend). Returns category-organized endpoint slugs with descriptions, prices, and SQS quality scores. USE THIS FIRST to recognize 'is the kind of endpoint I need likely available?' before paying for 
- categories: research, discovery, web · speed: normal · network: no
- risk: safe (LOW)
- params: category:string, search:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `monid_discover`  —  **doc-only**
DISCOVER-FIRST: Search Monid's catalog of hundreds of agentic web/data endpoints (scrapers, enrichment, social media, search, product/company/people data, content monitoring) BEFORE writing a custom scraper or telling the user 'I can't access that'. Many tasks already have a fast
- categories: research, discovery, web · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: query*:string, limit:number, minScore:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `monid_inspect`  —  **doc-only**
Read a Monid endpoint's input schema (pathParams / queryParams / body / bodyType), pricing, and docs BEFORE calling monid_run. ALWAYS inspect before running — never guess at parameter shape. The `input` field returned here is the source of truth; its three sub-keys map 1:1 onto m
- categories: research, discovery, web · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `monid_run`  —  **doc-only**
Execute a Monid endpoint with structured input. Endpoints are PAID per call ($0.001–$0.05 typical) — ONLY call after monid_inspect confirms the right endpoint AND tells you the exact param shape. Mapping is 1:1: inspect's `input.body` → `body`, `input.queryParams` → `query`, `inp
- categories: research, discovery, web · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: id*:string, body:object, query:object, path:object, wait:boolean, timeoutMs:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `mpeg_add_audio`  —  **doc-only**
Use when finalizing a video deliverable that needs voice-over, music bed, or sound mix — typically AFTER produce_video has rendered the visual track and generate_audio has produced the narration. Two modes: replace original audio entirely, OR mix new audio under existing audio at
- categories: media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: videoPath*:string, audioPath*:string, outputName:string, replaceAudio:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `mpeg_concat`  —  **doc-only**
Concatenate multiple video clips into a single MP4. Supports transitions between clips. Use for joining separate video segments, combining b-roll, or assembling multi-part videos.
- categories: media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: clipPaths*:array, outputName*:string, transition:string, crossfadeMs:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `mpeg_produce`  —  **doc-only**
HIGH-PERFORMANCE MPEG video production engine with PARALLEL TTS generation. Creates MP4 videos from scenes with narration, images, transitions, and Ken Burns effects. Has a generous 10-minute timeout so it can produce full-length videos without interruption. IMPORTANT: For scenes
- categories: media · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: title*:string, scenes*:array, voice:string, voiceProvider:string, strictVoice:boolean, resolution:string, fps:number, transition:string, crossfadeMs:number, kenBurns:boolean, kenBurnsIntensity:number, backgroundMusicPath:string, musicVolume:number, introText:string, outroText:string, emailTo:string, projectId:number, uploadToDrive:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `mpeg_produce_parallel`  —  **doc-only**
PARALLEL CHAPTER-BASED video production. Splits a video into chapters, each built by a separate parallel worker (TTS + images + encoding all concurrent), then concatenates into the final MP4. Has a generous 10-minute timeout so it can produce full-length videos without interrupti
- categories: media · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: title*:string, chapters*:array, maxParallelChapters:number, voice:string, voiceProvider:string, strictVoice:boolean, resolution:string, fps:number, transition:string, crossfadeMs:number, kenBurns:boolean, kenBurnsIntensity:number, backgroundMusicPath:string, musicVolume:number, emailTo:string, projectId:number, uploadToDrive:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `nudge_self`  —  **doc-only**
Self-nudge — record a fact about the user, the project, or your own behavior that you noticed without being asked. Stored in long-term memory so future sessions remember it. Use sparingly for genuinely useful observations, e.g. 'Bob prefers metric units' or 'This tenant always wa
- categories: memory, skillEvolution, experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: fact*:string, category:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `openalex_search`  —  **doc-only**
R125+4 — Search OpenAlex, the universal scholarly graph (250M+ works, replaces the discontinued Microsoft Academic Graph). FREE public JSON API, polite mailto pool. Returns normalized ScholarResult[] with citation counts, reconstructed abstracts, venue, and open-access PDF URLs w
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_results:number, open_access_only:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `orchestrate`  —  **doc-only**
CEO Orchestrator: Break a complex, multi-step objective into a DAG execution plan and delegate each step to the right specialist persona. Use this when a request requires multiple departments (research + writing, analysis + reporting, etc.). The CEO plans and delegates — never do
- categories: ai · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: objective*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `outlook_list_inbox`  —  **doc-only**
R125+8 — List recent messages from Bob's personal Outlook inbox (admin-tenant only, READ-ONLY). Newest first. Optional filters: from sender address, unread-only, since/until ISO date. Returns up to 100 message summaries (id, subject, from, receivedDateTime, bodyPreview, isRead, h
- categories: communication, knowledge · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: top:number, from_address:string, unread_only:boolean, since_iso:string, until_iso:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `outlook_read_message`  —  **doc-only**
R125+8 — Read a single Outlook message in full (body included) by message id (admin-tenant only, READ-ONLY). Get the id from outlook_list_inbox or outlook_search_inbox first. Returns subject, from, to, cc, receivedDateTime, body (text or HTML), conversationId. Body is wrapped via
- categories: communication, knowledge · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: message_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `outlook_search_inbox`  —  **doc-only**
R125+8 — Full-text search across Bob's Outlook mail via Microsoft Graph $search (admin-tenant only, READ-ONLY). Searches subject + body + from. Use when you want to find messages by keyword/topic rather than by sender or date. Returns up to 100 message summaries, wrapped via wrap
- categories: communication, knowledge · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, top:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `parallel_research`  —  **doc-only**
Research multiple topics in parallel using Perplexity and Firecrawl. Dramatically faster than researching topics one at a time. Returns a structured result per topic with answers, citations, and timing. Use when the user asks about several related topics or wants a broad survey. 
- categories: web, ai, agentic · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: topics*:array, provider:string, concurrency:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `pin_done_condition`  —  **doc-only**
R115.5 — Pin a 'done condition' contract at job kickoff BEFORE any generation begins. Per the Osmani / Anthropic harness pattern: separating generation from evaluation outperforms self-grading, and writing the acceptance criteria down up-front catches more scope drift than any pr
- categories: planning, governance, system · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: refKind*:string, refId*:string, doneCondition*:string, criteria:object, force:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `plan_and_execute`  —  **doc-only**
Autonomously break a complex goal into ordered steps and execute them. The planner decomposes the goal, runs each step (using tools or LLM sub-tasks), handles dependencies between steps, and returns a structured report. Use for multi-step tasks that require coordination: research
- categories: ai · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: goal*:string, context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `plan_deliverable`  —  **doc-only**
R98.13 W4 — PROMPT→CONTRACT ROUTER. Felix calls this FIRST for any customer request that smells like a deliverable (video, audio, PDF, slides, HTML app, spreadsheet, document, image, or research). Returns {format, confidence, reasoning, extracted_params, suggested_pipeline:{steps
- categories: system, validation · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: prompt*:string, hints:string, model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `plan_graph_edit`  —  **live-safe**
R106 N5 — Apply a batch of structured edit operations to a Plan-on-Graph DAG. Three op kinds: ADD_NODE (create a planning node with optional dependsOn[]), UPDATE_NODE (change label/status/deps/metadata), DEPRECATE_NODE (mark dead with a reason). After the batch, the graph is cycl
- categories: system, planning, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: plan_id*:string, ops*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 12`
