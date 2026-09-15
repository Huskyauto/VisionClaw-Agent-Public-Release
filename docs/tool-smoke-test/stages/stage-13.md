# Tool Smoke-Test — Stage 13 of 21

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `plan_graph_query`  —  **live-safe**
R106 N5 — Query a Plan-on-Graph by plan_id. Returns ALL nodes plus the topological partition: ready[] (deps satisfied — fire these in parallel NOW), blocked[] (waiting on incomplete deps), completed[], failed[]. Use BEFORE firing the next batch of subagents so you parallelize max
- categories: system, planning, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: plan_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `plan_video_production`  —  **doc-only**
R98.3 — VIDEO DIRECTOR. Use this BEFORE produce_video whenever a user asks for a high-quality narrated video on ANY subject (e.g. 'make a video explaining heat pumps', 'I need a 60-second cinematic ad for my coffee shop', 'turn this article into a video'). You give the director a
- categories: media, video, reasoning · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: topic*:string, target_duration_seconds:number, audience:string, tone:string, style_notes:string, source_material:string, voice_preference:string, call_to_action:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `post_to_channel`  —  **doc-only**
Post a message to an internal communication channel. Other personas subscribed to the channel will receive and can act on your message. Use for briefs, alerts, status updates, and cross-team communication.
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: channel*:string, content*:string, messageType:string, metadata:object, threadId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `produce_video`  —  **doc-only**
⛔ NOT for Bob's Built With Bob WEEKLY RECAP — use bwb_weekly_build instead. CINEMATIC NARRATED VIDEO. R125: this tool is now a thin compatibility shim — every call is transparently forwarded to `build_video_from_brief` so users get the consistent job-based UX (top progress banner
- categories: media · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: script:string, allow_silent_slides:boolean, allow_invented_face:boolean, slide_scripts:array, pdf_path:string, text_slides_only:boolean, title:string, voice_provider:string, voice:string, crossfade_ms:number, transition_type:string, ken_burns:boolean, ken_burns_intensity:number, background_music_path:string, music_volume:number, email_to:string, project_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `product_listing_create`  —  **doc-only**
Register a sellable digital product in the commerce catalog (DB-backed extension of the built-in static catalog). Owner-only. kind='static' ships a pre-built file (must live under project-assets/, uploads/, or data/products/ and exist on disk); kind='service' generates the artifa
- categories: business · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sku*:string, productName*:string, priceCents*:number, tagline:string, description:string, kind*:string, serviceType:string, primaryFileName:string, primaryFilePath:string, primaryMimeType:string, missionId:number, postPurchaseSequenceId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `product_listing_list`  —  **live-safe**
List commerce catalog products registered via product_listing_create (DB catalog): SKU, name, price, kind, Stripe payment-link URL if minted, active flag. Owner-only, read-only. Use before creating a new listing (avoid duplicate SKUs) or to find the payment link for an existing p
- categories: business · speed: fast · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 13`
