# Tool Smoke-Test — Stage 19 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `venture_discovery`  —  **doc-only**
OWNER-ONLY business/venture discovery loop — a 9-stage HITL pipeline (discovery → scoring → synthetic_customers → market_validation → mvp_feasibility → financial_model → legal_risk → decision_gate → deliverables) that takes a business OBJECTIVE and works it from raw idea to a go/
- categories: research, planning · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly
- params: action*:string, objective:string, dryRun:boolean, runId:number, format:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly)

## `verify_deliverable`  —  **live-safe**
R76 — Verify a customer-facing artifact against its deliverable contract before claiming success. Returns passed/failed with concrete failure reasons (extension mismatch, MIME mismatch, render-check failure, size out of bounds). MUST be called by personas before claiming an HTML 
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: deliverable_type*:string, file_path:string, file_url:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `verify_delivery_proof`  —  **live-safe**
R98.12 W2 — REFUSE-TO-DECLARE-DONE GATE. Felix MUST call this before saying a deliverable is done. Confirms three independent proofs of delivery exist: (1) artifact passes deliverable-contract verification (extension/MIME/render/size), (2) a customer-reachable URL is provided AND
- categories: validation, system · speed: normal · network: no
- risk: safe (LOW)
- params: deliverable_type*:string, file_path:string, file_url:string, project_id:number, file_name:string, require_project_file:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `verify_felix_proposal_spec`  —  **live-safe**
Read-only sanity check: validates a Felix proposal's expected_post_state spec without executing anything. Tells you whether the proposal is safe to approve+execute (verifier registered, spec well-formed, columns whitelisted). Use this BEFORE approve_felix_proposal when you want t
- categories: agentic, felix, governance, system · speed: normal · network: no
- risk: safe (LOW)
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `verify_math_chain`  —  **live-safe**
R77.5 (KisMATH-style Causal CoT graph for arithmetic) — re-executes a sequence of named arithmetic steps (revenue/cost/profit-style) deterministically and reports per-step pass/fail, claimed vs computed value mismatches, unit mismatches on +/-, the final value, optional finalMatc
- categories: reasoning, finance, system · speed: normal · network: no
- risk: safe (LOW)
- params: steps*:array, bindings:object, expected_final:number, tolerance:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `verify_outbound_safety`  —  **live-safe**
R95 outbound redaction preflight. Scan a payload (email body, file contents, inter-agent message, public post) for tenant secrets, API keys, private keys, credit-card numbers, SSNs, JWTs, and bearer tokens BEFORE you put it on a wire. Returns verdict (clean/redact/block), per-fin
- categories: security, system · speed: normal · network: no
- risk: safe (LOW)
- params: payload*:string, surface:string, strict:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `verify_with_cove`  —  **doc-only**
R123 — Chain-of-Verification (Dhuliawala et al., Meta FAIR, arXiv:2309.11495). Takes a DRAFT longform answer you (or another persona) just generated and runs a 4-step factuality pass: (1) extract atomic factual claims from the draft, (2) rewrite each as a standalone verification 
- categories: system, quality, research · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: draft*:string, topic:string, maxQuestions:number, modelTier:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `vibevoice_transcribe`  —  **doc-only**
Transcribe audio using Microsoft VibeVoice ASR — a frontier speech-to-text model that handles up to 60 minutes of audio in a single pass. Returns structured transcriptions with speaker diarization (who said what), timestamps, and content. Supports 50+ languages, custom hotwords, 
- categories: media · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: audio_path:string, audio_url:string, language:string, hotwords:array, enable_diarization:boolean, enable_timestamps:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `video_burn_captions`  —  **doc-only**
Burn TikTok/Reels-style captions onto a video — short UPPERCASE chunks (default 2 words at a time) timed to the speech. Pass the words[] from video_transcribe_words. Returns a new MP4 with captions baked in. Optional Drive upload.
- categories: media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: source*:string, words*:array, wordsPerChunk:number, fontSize:number, upperCase:boolean, position:string, outputName:string, uploadToDrive:boolean, driveLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `video_cut_fillers`  —  **doc-only**
Auto-edit a raw video by cutting filler words (um, uh, like, you know...) and dead silence. Pass the words[] from video_transcribe_words. Renders a polished MP4 with 30ms audio fades at every cut so it sounds clean. Optional: upload result to Drive and share the link.
- categories: media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: source*:string, words*:array, customFillers:array, cutSilenceLongerThan:number, outputName:string, uploadToDrive:boolean, driveLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `video_transcribe_words`  —  **doc-only**
Transcribe a video or audio file with WORD-LEVEL timestamps and speaker labels using ElevenLabs Scribe. Returns words[] with {word, start, end, speaker}. Use this BEFORE video_cut_fillers or video_burn_captions — both need the words[] output. Accepts a local path or /uploads/<fil
- categories: media · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: source*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `vision_browse`  —  **doc-only**
Vision-first web page analysis. Captures a screenshot and page content, then uses AI vision to analyze and understand the page layout, extract data, and describe what it sees. Powered by Magnitude concepts. Superior to plain text scraping for understanding page layouts, charts, i
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string, task*:string, extract_schema:object, max_steps:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `web_fetch`  —  **doc-only**
Use when you ALREADY have a specific URL and need its content (do NOT use to discover URLs — that is web_search). Cheap, fast. Multi-tier extraction: Defuddle (R125+13, local linkedom-based extractor, kepano/obsidian-skills — free, no API, 60–80% token reduction on cluttered arti
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `web_search`  —  **doc-only**
Search the web for information. Uses Perplexity Sonar (when configured) for AI-powered research with citations, with Wikipedia and Jina AI as fallbacks. Use when the user asks a factual question, needs current information, or you need to research a topic before responding.
- categories: web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `whatsapp`  —  **doc-only**
Send messages via WhatsApp. Use this to send text messages to phone numbers through the connected WhatsApp account. Can also check connection status.
- categories: whatsapp · speed: normal · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: action*:string, to:string, message:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `workspace_finalize`  —  **live-safe**
R98.27.7 — Close out a workspace with a final summary + optional handoff note for any successor session. Writes final_summary.md and stamps current_status.md with FINALIZED. Doesn't delete the directory — the breadcrumb survives for replay/audit. Use when the job is complete, aba
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, outcome*:string, summary*:string, next_session_handoff:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `workspace_init`  —  **live-safe**
R98.27.7 — Open a durable per-task workspace on disk for a multi-step or long-running job (Anthropic long-running-agent pattern). Creates `data/task-workspaces/<tenant>/<job_id>/{task_plan,current_status,next_steps,open_questions}.md` plus a `tool_results/` artifact directory. Us
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, goal*:string, plan:array, context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `workspace_list`  —  **live-safe**
R98.27.7 — List workspaces for the current tenant so a persona can DISCOVER resumable jobs without remembering job_ids. Returns the most-recently-modified workspaces first with {jobId, finalized, last_modified, artifact_count, status_tail}. By default skips finalized workspaces (
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: include_finalized:boolean, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `workspace_log_artifact`  —  **live-safe**
R98.27.7 — Drop a small text artifact (tool result, diagnostic log, intermediate plan, transcript) into the workspace's tool_results/ folder. NOT for binary deliverables — those still go through deliverDigitalProduct / deliver_product. This is for the breadcrumb trail. Hard caps:
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, name*:string, content*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `workspace_read`  —  **live-safe**
R98.27.7 — Read back everything currently persisted for a workspace: task_plan, current_status, next_steps, open_questions, and the list of tool_results/ artifacts (paths + sizes, not contents). CALL THIS at the start of any session that may be resuming a prior job — checks if a 
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 19`
