# Tool Smoke-Test — Stage 16 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `score_post`  —  **doc-only**
R79 (MarTech Bundle, after Charlie Hills' post-scorer MIT) — score a draft post 0-100 against the tenant's voice profile and (optionally) historical performance data. Returns scoreOutOf100, letter grade, sub-scores (voiceMatch / hook / body / cta), patternsMatched, patternsViolat
- categories: content, social, evaluation · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: draft*:string, platform:string, historical_posts_json:string, voice_profile_name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `scraped_page_read`  —  **doc-only**
Read the full content of a specific scraped page by its database ID. Use after scraped_pages_query to get the complete markdown content of a page.
- categories: scraping · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: pageId*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `scraped_pages_delete`  —  **doc-only**
Use when cleaning up the scraped-pages cache — typically before re-scraping fresh content, when removing pages from a deprecated source, or when pruning to free DB space. Three sub-ops: by ID(s), by domain, or by age (older than N days). Returns deleted count. Irreversible — re-s
- categories: scraping · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; irreversible (snapshot-guarded)
- params: pageIds:array, domain:string, olderThanDays:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; irreversible (snapshot-guarded))

## `scraped_pages_query`  —  **live-safe**
Search and browse the database of previously scraped/crawled web pages. Filter by domain, search content, or browse by tags. Returns page summaries with content previews.
- categories: scraping · speed: normal · network: no
- risk: safe (LOW)
- params: domain:string, search:string, limit:number, offset:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `sculptor_review`  —  **doc-only**
Review a completed sculptor session's work. An AI reviewer evaluates the output for quality, completeness, and correctness, providing a verdict (approve/revise/reject), score, strengths, issues, and suggestions.
- categories: experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sessionId:number, command*:string, comparisonGroup:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sculptor_session`  —  **doc-only**
Launch a structured agent session with an execution plan. The agent follows the plan step-by-step with progress tracking. Use for complex tasks that benefit from structured execution. Can also launch parallel sessions with different models/personas to compare approaches.
- categories: experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: task*:string, title:string, plan:array, personaId:number, model:string, parallel:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `search_knowledge`  —  **live-safe**
Use BEFORE freeform reasoning on any topic the platform might already have learned about — facts about Bob, [Your Product] operating procedures, product specs, customer history, prior decisions. Cheap hybrid (vector + keyword) search across the curated knowledge base. Returns ranked KB
- categories: knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: query*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `search_memory`  —  **live-safe**
Search the agent's Memory Palace for facts about the user. Supports hierarchical search by wing (project/domain) and room (topic). Use when the user asks 'do you remember...' or when you need to recall stored information. Filter by wing to search within a specific project or doma
- categories: memory · speed: normal · network: no
- risk: safe (LOW)
- params: query*:string, wing:string, room:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `search_stock_media`  —  **doc-only**
Search for free, high-quality stock photos and videos from Pexels. Returns professional images and video clips with direct download URLs. Perfect for sourcing slide backgrounds, social media visuals, video footage, and marketing materials. All results are free to use commercially
- categories: marketing, media · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, type:string, per_page:number, orientation:string, size:string, color:string, download:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `second_opinion`  —  **doc-only**
R125+52.41 — Get an INDEPENDENT second opinion / cross-check from OpenRouter Fusion (a managed panel of frontier models that answer in parallel → a judge compares them → a final model synthesizes, with built-in web search). Use when YOUR current answer feels shaky, unsubstantiate
- categories: reasoning, research, system · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: question*:string, draft_answer:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `select_best_image`  —  **doc-only**
R99 — Felix Visual Continuity (ViMax #2). Given N candidate images (typically 3-4 generated for the same target frame) plus their reference shots, ask a vision LLM to grade each on character_consistency / spatial_consistency / description_accuracy and return the winner. Used by m
- categories: media, system · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: candidates*:array, references:array, target_description*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `select_references_for_frame`  —  **doc-only**
R99 — Felix Visual Continuity (ViMax #1, second half). For a target frame description and a video job_id, pick the ≤8 most-relevant references from the pool (tenant portraits + recent prior frames in this job) AND return the prompt-prefix that names them ('Image 0 = bob (front vi
- categories: media, system · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: job_id:string, frame_description*:string, max_references:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `self_diagnose`  —  **doc-only**
Diagnose why a tool execution didn't produce the expected result. Analyzes the tool's schema against the parameters you used and the result you got, then suggests corrections. Automatically stores actionable lessons in memory so you don't repeat the same mistake. Use this AFTER a
- categories: system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tool_name*:string, params_used:object, result_received:string, expected_outcome*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `self_heal`  —  **doc-only**
Manually trigger Blueprint's self-healing supervisor on a failed run or arbitrary failure context. Diagnoses the failure and proposes a fix (replan, custom_tool, code_snippet, escalate, give_up). Reversible fixes auto-apply; irreversible fixes auto-escalate via request_approval. 
- categories: agentic, governance, ai · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: runId:number, originalGoal*:string, error*:string, lastToolName:string, lastToolArgs:object, recentSteps:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `self_heal_inspect`  —  **doc-only**
Read the full record of one self-heal attempt — diagnosis, proposed fix, generated code snippet (if any), and outcome. Use this when you want to see whether a past auto-fix should be promoted into the main platform.
- categories: agentic, governance, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: attemptId*:number, markPromoted:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `self_heal_log`  —  **doc-only**
List past self-heal attempts for the tenant — outcomes, fix types, and which ones are candidates for promotion into platform code. Use this to audit which auto-fixes worked, which failed, and what gaps the agents have filled in on the fly.
- categories: agentic, governance, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: limit:number, runId:number, outcome:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `send_email`  —  **doc-only**
Send an email from the platform corporate inbox. Use for outreach, notifications, customer communication, or automated correspondence. IMPORTANT: If you're delivering a file to a customer, prefer using deliver_product instead — it handles Drive upload, link generation, and brande
- categories: email · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: to*:string, subject*:string, text:string, body:string, html:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `send_message`  —  **doc-only**
Deliver a message to a user via any channel: telegram, sms, whatsapp, email, or web (in-app). Use to reach users wherever they are. Auto-falls-back if a target fails. Returns delivery status.
- categories: messaging, delivery · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: channel*:string, telegramChatId:number, phoneNumber:string, email:string, conversationId:number, text*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `seo_content_audit`  —  **live-safe**
Analyze content for SEO quality, readability, and keyword optimization. Returns a comprehensive SEO score (0-100) with category breakdowns: readability (Flesch Reading Ease, Flesch-Kincaid Grade Level), keyword density and distribution, content structure (heading hierarchy, parag
- categories: legal · speed: normal · network: no
- risk: safe (LOW)
- params: content*:string, primary_keyword*:string, secondary_keywords:string, meta_title:string, meta_description:string, url:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `sessions_history`  —  **doc-only**
Use when continuing another agent's work, when auditing inter-agent communication, or when Bob asks "what did <persona> say about X in that other thread". Returns the full transcript of a target session by id. Pair with list_conversations to find the right session_id first.
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sessionKey*:string, limit:number, includeTools:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 16`
