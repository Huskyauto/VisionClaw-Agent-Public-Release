# Tool Smoke-Test — Stage 12 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 12`
