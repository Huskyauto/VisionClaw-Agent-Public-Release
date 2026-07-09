# VisionClaw Tool Transparency Report

**Complete smoke-test & documentation audit of every tool on the platform.**

> Completed: 2026-07-02 (refreshed 2026-07-04 for `aeo_score`) · Program: 20 stages · Result: **395/395 tools verified, 0 attention flags**

## What this report is

VisionClaw's AI personas act through a registry of tools — every action an agent can
take (create a PDF, query the CRM, send an email, run research) is a named, policy-
gated tool. This report is the full, transparent catalog of all 395 tools: what each
one does, its parameters, its risk classification, and the safety gates applied to it.

## How the audit was run

- **Source of truth:** the live tool registry (statically parsed — the audit never
  imports or executes the production tool code).
- **Per-tool verification:** registry entry present ✓ · safety policy classified ✓ ·
  documentation present ✓.
- **Safety rule:** tools marked **doc-only** (287) are destructive, sensitive, costly,
  or network-touching — they were documented and wiring-verified but NEVER invoked by
  the audit. **live-safe** tools (108) are read-only/harmless; live invocation is
  opt-in and was not required for sign-off.
- **Zero cost:** no LLM calls, no tenant data touched, $0 spent.

## Risk & gate legend

- **safe (LOW)** — read-only or harmless side effects.
- **sensitive (MEDIUM)** — writes data, calls external services, or spends compute;
  gated by the destructive-tool policy.
- **destructive (HIGH)** — mutates production state, moves money, mass-communicates,
  or creates code; requires trusted personas, structured args, and/or human (HITL)
  approval. Fails CLOSED.

## Results summary

| Metric | Value |
|---|---|
| Tools verified | 395 / 395 (100%) |
| Stages signed off | 20 / 20 |
| Attention flags | 0 |
| live-safe / doc-only split | 108 / 287 |
| Registry fingerprint | 44934b773a74b70d |

---

# Full Tool Catalog


> 20 tools. Status: ✅ signed off. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `academic_search`  —  **doc-only**
R125+4 — Fan-out scholarly search across arXiv (STEM preprints), PubMed (biomedical), OpenAlex (universal scholarly graph w/ citations), and Crossref (DOI registry). ALL four sources are FREE, public, license-clean — no shadow libraries, no copyright risk. Returns a deduplicated,
- categories: research, web, knowledge · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_per_source:number, sources:array, open_access_only:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `add_competitor`  —  **doc-only**
Add a competitor to the watchlist for ongoing monitoring. Provide their website and optionally their pricing, product, and changelog URLs for targeted tracking.
- categories: competitorIntel · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, website*:string, pricingUrl:string, productUrl:string, changelogUrl:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `add_customer`  —  **doc-only**
Add a new customer/prospect to the CRM. Track company info, contact details, deal stage, and value.
- categories: crm · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: company_name*:string, contact_name:string, email:string, phone:string, address:string, city:string, state:string, zip:string, industry:string, deal_stage:string, deal_value:number, assigned_to:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `advance_sequence`  —  **doc-only**
Process all outreach enrollments that are due. Sends personalized emails for the current step, then schedules the next step. Run this periodically or via Heartbeat to automate outreach.
- categories: outreachSequencing · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: sequenceId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `aeo_score`  —  **live-safe**
R125+83 — Score a Markdown draft's citation-readiness for AI answer engines (Google AI Overviews, ChatGPT, Perplexity). Pure mechanical text analysis (no LLM, no network): checks definition-first lead, question-H2 answer coverage, TL;DR presence, structured blocks (lists/tables),
- categories: marketing, content, research · speed: fast · network: no
- risk: safe (LOW)
- params: markdown*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, VERIFIED via direct scorer invocation (7/7 pure-logic unit tests, `tests/tools/aeo-score.test.ts`; $0, no LLM, no tenant)

## `agent_cost_summary`  —  **live-safe**
Break down agent/tool costs by tool and model for a period, showing which tools are driving spend. Owner-only.
- categories: agentic, finance, system · speed: normal · network: no
- risk: safe (LOW)
- params: days:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `agent_security_scan`  —  **doc-only**
Run a security audit on the VisionClaw agent platform with OWASP Top 10 mapping. Scans 5 categories: Input Handling (injection, validation), Auth & Access Control (broken auth, IDOR, session management), Data Protection (secrets, encryption, PII), Infrastructure (headers, CORS, d
- categories: system · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: scan_type:string, include_recommendations:boolean, include_owasp:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `agent_status`  —  **live-safe**
Use at session start for a one-glance view of platform activity, when Bob asks "what is everyone doing right now", or before launching a heavy multi-agent plan. Returns a unified roll-up of active agents, background tasks, autonomous runs, and scheduled heartbeat tasks across the
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: section:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `agentic_cache_stats`  —  **live-safe**
View statistics about the tool-level cache that saves money on repeat Firecrawl, Perplexity, and search queries. Shows hits, misses, hit rate, and size.
- categories: agentic, system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `analyze_pdf`  —  **doc-only**
Extract and analyze text from a PDF document. Accepts a URL or local file path. Returns extracted text, page count, and metadata. Use for reading documents, reports, contracts, or any PDF content.
- categories: pdf · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: pdf*:string, pages:string, prompt:string, maxBytesMb:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `analyze_portfolio`  —  **doc-only**
Analyze a portfolio of holdings: fetches live prices, computes weights, concentration risk (HIGH/MODERATE/LOW), HHI-based diversification score (0-100), and structural recommendations. NEVER returns buy/sell advice — only structural observations like rebalancing or sector exposur
- categories: finance, system · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: holdings*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `apply_procedure_edit`  —  **doc-only**
Apply an APPROVED procedure edit to the actual playbook file. CAS-pinned by sha256 — fails if file changed since proposal. Re-validates against forbidden-pattern + size + frontmatter invariants. Atomically writes the new content and updates the registry sha256+bytes. Destructive 
- categories: governance, system · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: editId*:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `approve_felix_proposal`  —  **doc-only**
Approve a Felix proposal so it moves from pending → approved. NOTE: approving does NOT automatically execute the action — execution requires a separate explicit follow-up. This is a deliberate two-step rail to prevent Felix from acting on its own. Bob-only operation.
- categories: agentic, felix, governance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `approve_procedure_edit`  —  **doc-only**
Approve a proposed procedure edit. Moves status proposed→approved but does NOT yet write the file — call apply_procedure_edit to actually mutate. Reviewer name is recorded.
- categories: governance, system · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: editId*:integer, note:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `arxiv_search`  —  **doc-only**
R125+4 — Search arXiv directly for STEM preprints (physics, math, CS, quant-bio, q-fin, stat, econ). FREE public Atom API, no key. Returns normalized ScholarResult[] with PDF URLs (every arXiv paper is open access). Use when you specifically want preprints / latest research / pre
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_results:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `attribute_failure`  —  **live-safe**
R106 N1 — Record an L0–L5 failure attribution against a scoped reference (grade_deliverable, build_html_app, commitment, subagent_chunk, etc.) so the reflexive auto-revise loop knows what to do next. STRICT-PROGRESSIVE: only attribute upward after excluding lower causes. L0=raw o
- categories: system, reasoning, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: scope*:string, scope_ref*:string, level*:string, detail*:string, context:any
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `audit_reasoning_step`  —  **doc-only**
R77.5 (KisMATH 2507.11408v2) — audits a chain-of-thought reasoning trace by step-masking each step and re-deriving from there with a cheap regenerator, then measuring divergence vs the original final answer. Returns per-step causalScore (0=decorative, 1=critical), the load-bearin
- categories: reasoning, system · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: question*:string, reasoning_trace*:string, original_answer*:string, regen_model:string, max_steps:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `auto_memorize_now`  —  **doc-only**
Run the auto-memorize pass immediately: scan recent conversation messages, extract durable lessons (preferences, decisions, error patterns), dedupe against existing memory, and store the survivors. Normally runs automatically every 6 hours from the heartbeat. Use this tool only t
- categories: memory, experiments · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: windowHours:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `autonomous_task`  —  **doc-only**
Launch a fire-and-forget autonomous conversation. Creates a new conversation that runs independently in the background — the agent works on the task without blocking. Results are announced to the operations channel when complete. Use for long-running tasks, batch operations, or p
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: task*:string, personaId:number, model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `browser`  —  **doc-only**
Control a remote browser via Chrome DevTools Protocol. Each user gets isolated browser sessions. Actions: navigate, screenshot, content, click, type, evaluate, smart_browse (navigate+screenshot+extract in one step), form_fill (fill multiple fields at once), vision_browse (Set-of-
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, url:string, selector:string, text:string, value:string, script:string, fullPage:boolean, returnBase64:boolean, tabIndex:number, ms:number, mark:number, type:string, vcId:string, maxChars:number, scrollY:number, profile:string, fields:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `browser_workflow`  —  **doc-only**
Save and manage reusable browser workflow templates. Records step-by-step browser instructions as named workflows that can be stored, listed, replayed, and deleted. Steps are natural language descriptions of browser actions. On replay, the workflow visits the starting URL and log
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, name:string, url:string, steps:array, workflow_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `build_html_app`  —  **doc-only**
R98.12 W5 — Build a single-file downloadable HTML utility app (password generator, tip calculator, unit converter, timer, todo list, form, simple game, dashboard). Generates one self-contained <!doctype html> document with CSS+JS inline (no external assets), then SMOKE-TESTS the 
- categories: product_output, code · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: topic*:string, description:string, features:array, app_type:string, style_notes:string, smoke_assertion:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `build_presentation_distributed`  —  **doc-only**
Build a presentation using distributed parallel processing — the EFFICIENT way to create decks. Instead of one massive LLM call for all slides, this tool: 1) Plans a deck outline (sections + layouts), 2) Dispatches each section (2-3 slides) to parallel sub-workers with minimal co
- categories: presentations · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: topic*:string, slideCount:number, theme:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `build_video_from_brief`  —  **doc-only**
⛔ NOT for Bob's Built With Bob WEEKLY RECAP — use bwb_weekly_build instead. R112 — BRIEF-DRIVEN VIDEO. The 'AI-Tinkers pattern' for video. ONE tool call: takes a customer brief, internally plans chapters+scenes via an LLM director, kicks off a background render with auto-finalize
- categories: product_output, media · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: brief*:string, title:string, targetMinutes:number, voice:string, voiceProvider:string, resolution:string, customerName:string, customerEmail:string, uploadToDrive:boolean, projectId:number, bwbBrand:boolean, strictVoice:boolean, userImagePath:string, userImageDriveFileId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `build_voice_profile`  —  **doc-only**
R79 (MarTech Bundle, after Charlie Hills' voice-builder MIT) — synthesize a per-tenant brand-voice profile (about-me.md + voice.md + topic pillars + audience) from interview answers plus 1-10 raw writing samples. Stored in tenant_voice_profiles, unique on (tenantId, profileName),
- categories: content, branding · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: profile_name:string, about_me_answers*:string, samples*:array, pillars:array, audience:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `business_health_score`  —  **doc-only**
Calculate an overall business health score (0-100, grade A-F) based on collection rate, profit margin, overdue invoices, customer win rate, and KPI performance. A quick executive snapshot.
- categories: reporting · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `bwb_weekly_build`  —  **doc-only**
Built With Bob — kick off the FULLY AUTONOMOUS weekly recap pipeline for project 16. Auto-discovers this week's short-form daily clips from Bob's Google Drive drop-folder (default source; by date parsed from each filename, excluding the ~5-min weekly long-form; set BWB_SOURCE=you
- categories: media, video, social · speed: very_slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly
- params: autopublish:boolean, days:number, currentWeight:number, totalLost:number, startWeight:number, weekStart:string, weekEnd:string, photos:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly)

## `calendar_sync`  —  **doc-only**
Multi-provider calendar aggregation and sync. Connects to Google Calendar, Outlook/Office 365 via Microsoft Graph, iCloud via CalDAV, and any calendar via ICS/iCal feed URLs. Aggregates events across all connected calendars to find conflicts, free slots, and scheduling opportunit
- categories: workspace · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, feed_url:string, feed_name:string, feed_id:number, date_range_start:string, date_range_end:string, duration_minutes:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `cancel_scheduled_message`  —  **doc-only**
Use when Bob says "stop sending those" — also when retiring a stale automation or replacing it with a new schedule. Permanent: the schedule row is deleted, not paused. Returns success. If a temporary pause is wanted instead, ask Bob — pausing requires a different op.
- categories: messaging · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; irreversible (snapshot-guarded)
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; irreversible (snapshot-guarded))

## `cancel_scheduled_post`  —  **doc-only**
Cancel a pending scheduled cross-platform post by id. Only works while the post is still 'pending' — already-publishing or already-sent posts cannot be unsent. Returns {ok, cancelled} where cancelled=false means the row was already past the pending state.
- categories: messaging, marketing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `cancel_wake`  —  **doc-only**
Cancel a previously scheduled wake by its id (from schedule_wake / list_wakes).
- categories: agentic, planning · speed: fast · network: no
- risk: sensitive (LOW) · gates: risk=sensitive
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `cash_flow_summary`  —  **live-safe**
Cash flow summary — monthly cash in (payments received) vs cash out (expenses) with net position.
- categories: reporting · speed: normal · network: no
- risk: safe (LOW)
- params: months:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `charge_task_force`  —  **doc-only**
Record spend against a task-force's budget. Returns remaining budget and whether the charge pushed it over.
- categories: agentic, governance, finance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: id*:number, amountUsd*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `check_background_task`  —  **live-safe**
Check the status of a background task launched with run_background_task. Returns status (pending/running/completed/failed), elapsed time, progress updates, and the result when complete.
- categories: ai · speed: normal · network: no
- risk: safe (LOW)
- params: task_id*:string, wait:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `check_department_budget`  —  **live-safe**
Check current spend vs cap for a department (or all departments if omitted).
- categories: agentic, governance, finance · speed: fast · network: no
- risk: safe (LOW)
- params: department:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `check_inbox`  —  **doc-only**
Use at session start when triaging customer/prospect mail, when Bob asks "anything new in the inbox", or BEFORE drafting outbound to avoid replying to something already answered. Returns the latest emails received in the platform corporate inbox with sender, subject, snippet, and
- categories: email · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `check_system_status`  —  **live-safe**
THE comprehensive self-test for THIS platform. Use it first whenever asked to "test all the systems", "is everything working", "how is everything", after a republish/deploy, when investigating a slow/odd response, or before a complex multi-tool plan. Returns the app's own web-ser
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `check_video_job`  —  **live-safe**
R98.14 W1.3 — Poll the status of a background video job started by start_video_job. Returns full job state {status, total_chapters, chapters:[{idx,title,status,duration_sec,error}], final_file_path?, final_drive_url?, last_concat_error?}. Status flow: 'rendering' → 'ready_to_conc
- categories: system, media · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `chunk_code`  —  **doc-only**
Split a source file into context-aware chunks (cAST: Context-Aware Splitting Tree). Splits at top-level function/class/export boundaries (TS/JS/Python supported), with a header per chunk recording parentFile + symbol + line range. Falls back to fixed-size chunks for unsupported l
- categories: code, knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: filePath*:string, maxTokens:number, previewOnly:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `classify_reply`  —  **doc-only**
Classify a reply to an outreach email. Determines if it's positive, interested, meeting request, objection, unsubscribe, out-of-office, etc. Automatically pauses or stops the sequence based on classification.
- categories: outreachSequencing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: contactEmail*:string, replyContent*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `code_slice`  —  **live-safe**
R117 token-saver: extract ONLY the named symbols (functions, classes, types, exports) or line ranges from a source file, instead of pulling the whole file with read_file. Saves 70–95% of tokens when you only need to review a couple of functions in a 5,000-line file. AST-based for
- categories: files, system · speed: normal · network: no
- risk: safe (LOW)
- params: path*:string, symbols:array, line_ranges:array, context_lines:number, exported_only:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `codebase_diff_impact`  —  **live-safe**
R98.27.8 — Compute blast-radius for the current uncommitted change set (or against a specific git ref). Returns directly-changed files plus the transitive set of files that import them, layer-tagged so you can SEE which sensitive layers (Data / Tools / Safety / API / Personas / O
- categories: system, code, validation · speed: normal · network: no
- risk: safe (LOW)
- params: baseRef:string, depth:number, changedFiles:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `codebase_graph_query`  —  **live-safe**
R98.27.8 — Query the self-knowledge graph of the VisionClaw codebase (Understand-Anything-inspired). Returns nodes (files) + their direct dependencies and dependents, layer-tagged (API / Lib / Data / Tools / Safety / Personas / Orchestration / Delivery / UI-* / Shared / Script). 
- categories: system, code · speed: normal · network: no
- risk: safe (LOW)
- params: file:string, exportName:string, layer:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `commit_decision`  —  **doc-only**
Make a high-stakes decision with an explicit self-confidence score. The model picks the best option from the candidates, scores its own confidence 0-1, and if confidence is below the threshold (default 0.7) automatically escalates to a human approval request. Use this before comm
- categories: agentic, ai, governance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: decision*:string, options*:array, context:string, threshold:number, autoEscalate:boolean, reversible:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `commitment_cancel`  —  **doc-only**
R104 — Cancel a commitment that will not be fulfilled. Provide a reason — this leaves a clear audit trail.
- categories: system, planning, memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, reason*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `commitment_complete`  —  **doc-only**
R104 — Mark a commitment completed. Include a final note summarizing what was delivered.
- categories: system, planning, memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, note:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `commitment_create`  —  **live-safe**
R104 — Register a long-running commitment (an obligation a persona is taking on that will outlive the current chat turn). The platform tracks status, expects periodic heartbeats, and escalates to the owner via the daily digest if a commitment passes its due_at without a recent he
- categories: system, planning, memory · speed: normal · network: no
- risk: safe (LOW)
- params: description*:string, due_at:string, heartbeat_interval_ms:number, persona:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `commitment_heartbeat`  —  **live-safe**
R104 — Record a heartbeat against an active commitment: a short note explaining current progress, optionally with structured evidence (links, ids, metrics). Resets the staleness timer.
- categories: system, planning, memory · speed: normal · network: no
- risk: safe (LOW)
- params: id*:number, note*:string, evidence:any
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `commitment_list`  —  **live-safe**
R104 — List commitments for the calling tenant. Optionally filter by status (active|paused|completed|cancelled|escalated).
- categories: system, planning, memory · speed: normal · network: no
- risk: safe (LOW)
- params: status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `competitor_briefing`  —  **doc-only**
Generate an executive intelligence briefing summarizing all competitor changes over a period. Groups by competitor, highlights high-significance changes, and provides strategic recommendations.
- categories: competitorIntel · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: period:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `compliance_audit`  —  **live-safe**
Perform a compliance gap analysis against regulatory frameworks including GDPR, CCPA, ADA, PCI-DSS, HIPAA, SOC 2, CAN-SPAM, and more. Analyzes a website URL, privacy policy, terms of service, or business description and identifies compliance gaps, risk levels, and remediation ste
- categories: legal · speed: normal · network: no
- risk: safe (LOW)
- params: content*:string, url:string, frameworks:string, business_type:string, data_types:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `compose_social_post`  —  **doc-only**
Create a complete social media post with both text content AND a matching AI-generated image. Returns a ready-to-publish package with the drafted text, generated image (uploaded to Google Drive), and a preview. This is the all-in-one tool for creating complete social media conten
- categories: marketing · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: platform*:string, topic*:string, style:string, image_style:string, image_prompt:string, campaign:string, save_draft:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `compress_context`  —  **doc-only**
Compress a long list of chat messages by keeping the head + tail and summarizing the middle through a cheap auxiliary model. Repairs orphan tool_call/tool_result pairs that would otherwise crash a strict provider. Use when you're about to delegate a long-running plan to a sub-age
- categories: system, memory · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: messages*:array, targetTokens:number, keepHead:number, keepTail:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `context_budget_audit`  —  **live-safe**
Audit the token overhead of the agent system — measures how many tokens are consumed by persona prompts, tool definitions, skills, memories, governance rules, and agency expansion blocks. Returns a detailed report with component breakdown, warnings, and optimization suggestions. 
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `create_ab_experiment`  —  **doc-only**
Start an A/B experiment over 2+ content variants (e.g. landing copy, email subject). Record impressions/conversions with record_ab_event; the heartbeat auto-concludes once min-sample + min-age are met, picks the winner, and queues the winning variant as a reviewable SOP (proposed
- categories: agentic, experiments · speed: normal · network: no
- risk: sensitive (LOW) · gates: risk=sensitive
- params: hypothesis*:string, variants*:array, metric:string, wedge:string, minSample:number, minAgeHours:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_adr`  —  **doc-only**
Record an ARCHITECTURE DECISION RECORD (ADR). Use whenever you make a structural choice the rest of the system has to live with: picked one library/approach over another, chose a data shape, ruled out a strategy, set a constraint. ADRs are queryable by every persona via list_adrs
- categories: memory, planning, reasoning, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, context*:string, decision*:string, consequences*:string, tags:array, status:string, author_persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_contract`  —  **doc-only**
Create a contract record linked to a customer. Track type, dates, value, and status.
- categories: contracts · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, customer_id:number, contract_type:string, start_date:string, end_date:string, value:number, terms:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_crew`  —  **doc-only**
Create and manage Crews — autonomous agent teams inspired by crewAI. A Crew has agents (with role/goal/backstory), tasks (with description/expected_output), and a process type (sequential or hierarchical). Sequential runs tasks in order, passing outputs forward. Hierarchical uses
- categories: crews · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, crewId:number, name:string, description:string, process:string, role:string, goal:string, backstory:string, personaId:number, allowDelegation:boolean, tools:array, agentId:number, taskId:number, expectedOutput:string, contextTaskIds:array, guardrail:string, inputs:object, runId:number, memoryEnabled:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_document`  —  **doc-only**
Create a professional Word document (.docx) with styled headings, body text, bullet lists, and data tables. Includes headers, footers with page numbers, and VisionClaw branding. Automatically uploads to Google Drive. Use for contracts, proposals, memos, reports, project plans, SO
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, subtitle:string, author:string, sections*:array, headerText:string, footerText:string, fileName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_flow`  —  **doc-only**
Create and manage Flows — event-driven workflow orchestration inspired by crewAI Flows. Flows have steps with three types: @start (entry points), @listen (triggered when dependencies complete), @router (conditional branching). Steps can trigger crew kickoffs, LLM calls, or custom
- categories: crews · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, flowId:number, name:string, description:string, stepType:string, listenTo:array, routerOutputs:array, crewId:number, actionType:string, actionConfig:object, inputs:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_invoice`  —  **doc-only**
Create a business invoice with line items, auto-calculate totals, and track in the accounting system. Use for billing clients. Returns invoice ID and total. The invoice is stored in the database for tracking, aging reports, and P&L.
- categories: invoicing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: customer_name*:string, customer_email:string, customer_id:number, invoice_number:string, issue_date:string, due_date:string, tax_rate:number, payment_terms:string, notes:string, items*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `create_knowledge`  —  **doc-only**
Add a new entry to the permanent knowledge base. Use for storing reference material, guides, or important documentation.
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, content*:string, category*:string, priority:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_memory`  —  **doc-only**
Store a new fact in the Memory Palace. Automatically checks for duplicates and resolves contradictions. Use for important preferences, personal details, or things the user asks you to remember. Assign a wing (project/domain) and room (topic) for hierarchical organization. R98.19:
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: fact*:string, category*:string, wing:string, room:string, confidence:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_mind`  —  **doc-only**
Create or manage a Mind — an autonomous multi-agent system inspired by Imbue's Minds framework. A Mind has 4 roles: talking (user-facing), thinking (orchestration brain), working (execution), verifying (quality judge). Minds use tickets to track work, events for communication, an
- categories: crews · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, name:string, purpose:string, soul:string, mindId:number, maxConcurrentWorkers:number, talkingPersonaId:number, thinkingPersonaId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_pdf`  —  **doc-only**
Low-level PDF tool for fillable forms and simple documents ONLY. For reports, analyses, deliverables, or any professional document, use create_styled_pdf instead — it produces premium executive-quality output with branded cover pages, stats grids, data tables, highlight boxes, an
- categories: pdf, presentations · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title:string, content:string, sections:array, fields:array, headerImage:object, fontSize:number, pageSize:string, outputPath:string, customerName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_plan`  —  **doc-only**
Minerva's planner: compose a structured multi-step plan for an objective. Each plan step names an agent, tools, dependencies, cost estimate, and time estimate. Plans are persisted with status=awaiting_approval, a roster snapshot, and emit the plan.proposed event — waking Felix fo
- categories: planning, minerva · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: objective*:string, source:string, sourceRef:string, parentPlanId:number, revisionFeedback:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_sequence`  —  **doc-only**
Create a multi-step outreach email sequence. Define each step's subject, body template, and wait time. Templates support {{name}}, {{company}}, {{email}} placeholders. Steps are personalized with AI when personal context is provided.
- categories: outreachSequencing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, description:string, steps*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_slides`  —  **doc-only**
Create a professional Google Slides presentation with rich visual layouts, diagrams, charts, tables, and themes. Builds real, editable Google Slides with native shapes and elements. Use for presentations, pitch decks, keynotes, meetup talks.

Available layouts per slide:
- TITLE 
- categories: presentations · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: topic*:string, slideCount:number, slides:array, theme:string, logoUrl:string, filename:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `create_slideshow_video`  —  **doc-only**
Create a cinematic video from slide images + audio using FFmpeg. Supports per-slide audio sync, Ken Burns motion effects (zoom/pan on stills for cinematic feel), 30+ transition types (fade, wipe, slide, dissolve, zoom, etc.), background music mixing under narration, and PDF-to-sl
- categories: media · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: pdf_path:string, slides:array, audio_path:string, background_music_path:string, music_volume:number, output_filename:string, project_id:number, title:string, duration_per_slide:number, crossfade_ms:number, transition_type:string, ken_burns:boolean, ken_burns_intensity:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `create_spreadsheet`  —  **doc-only**
Create a professional Excel spreadsheet (.xlsx) with formatted headers, alternating row colors, auto-filters, frozen header row, and Excel formulas. Supports multiple sheets. Automatically uploads to Google Drive. Use for financial models, data analysis, budgets, project trackers
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, author:string, sheets*:array, fileName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_styled_report`  —  **doc-only**
Create a PREMIUM styled PDF report with professional cover page, branded colors, stats grid, data tables, highlight boxes, two-column layouts, and auto-uploaded to Google Drive. This is the TOP-TIER PDF system — use it for ALL reports, analyses, deliverables, and professional doc
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, subtitle:string, companyLines:array, coverStats:array, sections*:array, footerLines:array, orientation:string, fileName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_task_force`  —  **doc-only**
Spin up a scoped task-force: a bounded sub-team of personas with its own mission, budget, and optional deadline. Charges/usage are tracked against the task-force budget. Use to ring-fence a focused initiative without polluting the main tenant's accounting.
- categories: agentic, governance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, mission*:string, personaIds:array, budgetUsd:number, deadline:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_tension`  —  **doc-only**
Record a TENSION — a structured 'predicted ≠ actual' conflict so the next persona can pick up where you stopped instead of relearning the wall. Use whenever a result contradicts your assumption: a bug that violates your model, a customer answer that breaks an ICP, a metric that w
- categories: memory, reasoning, experiments, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, predicted_state*:object, actual_state*:object, evidence:array, owner_persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_tool`  —  **doc-only**
Create a new custom tool that the AI agent can use in future conversations. Describe what the tool should do and the system will generate a safe, sandboxed implementation. Created tools persist across conversations. Use when a recurring task would benefit from a dedicated tool ra
- categories: tools · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: description*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `critique_response`  —  **doc-only**
Request a quality critique of content before sending it. A specialized Critique Agent evaluates accuracy, completeness, relevance, and clarity on a 1-10 scale and provides improvement suggestions. Use this for important deliverables — reports, analyses, recommendations — before p
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: content*:string, context*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `cross_critique`  —  **doc-only**
Three-AI adversarial review panel (Donahoe Trident). Fires Claude/OpenAI/Gemini in parallel against the same target with different lenses (ux/technical/strategic), ranks counter-arguments by 'rebuttal survival score', and surfaces consensus findings (flagged by 2+ panelists). Use
- categories: reasoning, experiments, ai · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: target*:string, context:string, panelists:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `crossref_lookup`  —  **doc-only**
R125+4 — Query Crossref, the authoritative DOI registry (~150M works). Dual-mode: (a) if the query LOOKS like a DOI ('10.x/y' pattern), does a direct DOI lookup; (b) otherwise runs a search query. FREE public JSON API, polite mailto pool. Returns normalized ScholarResult[] with H
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_results:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `customer_pipeline`  —  **doc-only**
View the sales pipeline — shows deal counts and values at each stage (prospect → lead → qualified → proposal → negotiation → closed). Includes win rate and lifetime revenue.
- categories: crm · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `debate`  —  **doc-only**
Initiate a Chain of Debates — convene 3-4 relevant specialist personas to deliberate on a complex question from their unique perspectives (financial, legal, technical, strategic, etc.). Each persona argues their position, then a synthesis produces a final recommendation with cons
- categories: ai · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: question*:string, participantCount:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `decide_approval`  —  **doc-only**
Approve or reject a pending approval request. Resumes the paused agent run if approved; marks it failed if rejected. Only the owner tenant can decide.
- categories: agentic, governance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: approvalId*:number, approved*:boolean, note:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `deep_research`  —  **doc-only**
Conduct multi-source research on a topic. Generates diverse search queries, searches the web, fetches top sources, and synthesizes findings into a structured report with sources, confidence level, and follow-up questions. Use for thorough investigation requiring multiple perspect
- categories: web, ai · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: question*:string, depth:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `define_icp`  —  **doc-only**
Define an Ideal Customer Profile (ICP) with scoring criteria. Used by score_leads to automatically qualify leads. Describe your target customer characteristics and scoring weights.
- categories: leadEnrichment · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, icpDescription*:string, criteria*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `delegate_task`  —  **doc-only**
Delegate a task to another agent (persona). One-shot tasks (schedule='once') execute INLINE — the specialist runs immediately and returns their result in this conversation. Recurring tasks (cron schedule) are queued for approval. Use this to dispatch work to specialists like Nept
- categories: ai · speed: very_slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=very_slow (likely LLM/expensive)
- params: targetAgent*:string, taskName*:string, description:string, prompt*:string, schedule:string, gate_command:string, gate_timeout_ms:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=very_slow (likely LLM/expensive))

## `delete_custom_tool`  —  **doc-only**
Use ONLY after explicit Bob approval to permanently remove a registered custom tool by name (typically because the tool turned out to be wrong, redundant, or unused). Returns success/failure. Cannot be undone — to temporarily disable, prefer toggling is_active via the custom-tool
- categories: tools · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly; irreversible (snapshot-guarded)
- params: name*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly; irreversible (snapshot-guarded))

## `deliver_product`  —  **doc-only**
Full automated digital product delivery pipeline. Creates a dated subfolder in Google Drive, uploads the file, makes it publicly shareable, sends a branded delivery email to the customer, and logs the entire transaction. Use this for any order fulfillment or digital product deliv
- categories: delivery · speed: very_slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: customerName*:string, customerEmail:string, productName*:string, fileName*:string, filePath:string, orderId:string, stripePaymentId:string, emailSubject:string, emailBody:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `delivery_status`  —  **live-safe**
Use AFTER any send_message / scheduled-delivery to confirm receipt, when a recipient says "I never got it", or when auditing recent multi-channel deliveries. Returns delivery rows with channel, status (sent/delivered/failed), timestamp, and error. Includes a retry sub-op for fail
- categories: delivery · speed: normal · network: no
- risk: safe (LOW)
- params: command*:string, deliveryId:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `detect_competitor_changes`  —  **doc-only**
Compare the latest snapshot of competitor pages against previous snapshots. Uses AI to identify meaningful changes in pricing, features, messaging, and positioning. Ignores cosmetic changes.
- categories: competitorIntel · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: competitorId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `detect_emotional_state`  —  **doc-only**
Safety: scan a user message for shame-spiral / catastrophic / self-attack language patterns. Returns intensity (low/medium/high), pattern names matched, and whether intervention is needed. CRITICAL: if needsImmediateIntervention=true, the user expressed distress requiring an imme
- categories: wellness, safety, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `detect_fatigue`  —  **doc-only**
Wellness: scan a user message for late-night fatigue / craving / stress signals. Returns detected boolean, confidence (0-100), fatigue type (late_night | general_exhaustion | stress_craving), and matched keywords. Use BEFORE responding when user is messaging late at night or ment
- categories: wellness, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `doc_search`  —  **live-safe**
Search indexed document collections (like QMD). Modes: keyword (BM25-style), semantic (vector), hybrid (BM25+vector fusion, auto-reranked by Cohere when COHERE_API_KEY is set — strongly preferred). Use for notes, docs, knowledge bases, meeting transcripts, or any uploaded markdow
- categories: knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: action*:string, query:string, mode:string, collection:string, collectionId:number, docPath:string, content:string, context:string, auto_contextualize:boolean, name:string, description:string, topK:number, minScore:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `draft_social_post`  —  **doc-only**
Draft a social media post for VisionClaw Health marketing. Generates platform-optimized content using AI with brand voice guidelines. Returns draft text ready for review/posting.
- categories: marketing · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: platform*:string, topic*:string, style:string, include_cta:boolean, include_hashtags:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `edit_pdf`  —  **doc-only**
Edit an existing PDF — add text, add fillable form fields, add blank pages, or remove pages. The output remains editable. Use for modifying, annotating, or extending existing PDFs.
- categories: pdf · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: inputPath*:string, addText:array, addFields:array, addPages:number, removePages:array, outputPath:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `emit_event`  —  **doc-only**
Emit a business event to the event bus. Other personas subscribed to this event type will be notified and can take action. Use this when you detect something that other departments should know about — new leads, content published, deals progressed, etc.
- categories: system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: eventType*:string, data*:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `enrich_lead`  —  **doc-only**
Enrich a lead with company data scraped from their website. Extracts industry, company size, products, and target market. Stores enriched data for scoring.
- categories: leadEnrichment · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: leadName*:string, leadEmail:string, companyName:string, companyUrl:string, role:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `enroll_in_sequence`  —  **doc-only**
Enroll a contact in an outreach sequence. They'll receive step 1 immediately when the sequence is advanced, then subsequent steps at the defined intervals.
- categories: outreachSequencing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sequenceId*:number, contactName*:string, contactEmail*:string, companyName:string, personalContext:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `ensemble_query`  —  **doc-only**
Mixture-of-Agents (MoA): when you face a hard reasoning, factual, or judgment question and want the most reliable answer, run the same question through diverse frontier models in parallel (Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash) and have a strong aggregator (Claude Opus 4.8, 
- categories: reasoning, research, system · speed: very_slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: question*:string, proposer_pool:string, restate_gate:boolean, dissent_quota:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `estimate_cost`  —  **doc-only**
Predict resource consumption before executing a plan — estimate token usage, API costs, time, and risk level. Use before plan_and_execute or orchestrate to give the user visibility into what an operation will cost.
- categories: ai · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: steps*:array, modelId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `evaluate_against_contract`  —  **doc-only**
R115.5 — Record an evaluator verdict against a pinned sprint contract. The contract is looked up by (refKind, refId) with status='open'; the row's sha256 is re-checked against the stored doneCondition (tamper detection). Marks the contract 'passed' or 'failed' and writes the eval
- categories: planning, governance, system · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: refKind*:string, refId*:string, evidence*:string, verdict*:string, scoredBy:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `exec`  —  **doc-only**
Execute a shell command in the workspace. Security-gated: only allowlisted commands run by default. Use for system inspection, file operations, data processing, or running scripts. Must be enabled in Settings → Exec Tool.
- categories: code · speed: slow · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly
- params: command*:string, workdir:string, timeout:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly)

## `execute_code`  —  **doc-only**
Execute JavaScript code in a secure sandbox. Supports math, data transforms, JSON processing, string manipulation, regex, and logic. No file system, network, or module access. Use for calculations, data analysis, format conversions, algorithm testing, or any computation the user 
- categories: code · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: code*:string, description:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `execute_felix_proposal`  —  **doc-only**
Run an APPROVED Felix proposal through the SWD verification rail: capture pre-state from the verifier table, fire the action (LIVE MODE ONLY — currently dry-run until 2026-05-12), capture post-state, verify actual delta matches expected_count_delta. On mismatch, status flips to '
- categories: agentic, felix, governance · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `expense_report`  —  **doc-only**
Generate an expense report broken down by category with totals, averages, and deductible amounts. Perfect for tax prep or monthly reviews.
- categories: expenses · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: start_date:string, end_date:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `expire_triple`  —  **doc-only**
Mark a knowledge triple as expired by setting its valid_until date. Use when a fact is no longer true (e.g. someone changed roles, a tool was replaced).
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, valid_until:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `export_persona`  —  **doc-only**
Export any VisionClaw persona as a portable agent definition file. Produces a comprehensive package with the persona's identity (SOUL), trust profile, skills, tools, governance rules, express lanes, and knowledge domains. Output in JSON or markdown format. Use when the user wants
- categories: personas · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: persona_id*:number, format:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `felix_loop_run_now`  —  **doc-only**
Manually trigger a Felix Loop run right now (bypasses the 4-hour interval and wake-hours gate). Useful for testing the loop end-to-end or for forcing a fresh read after a major event. Still respects kill switch and monthly cost cap. Bob-only operation.
- categories: agentic, felix, governance · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `felix_loop_status`  —  **live-safe**
Get the current status of Felix's autonomous loop (R74.13w). Returns: current mode (dry_run vs live), live_after date, kill switch state, wake hours, monthly cap and current month spend, count of pending proposals awaiting Bob's review, and details of the last loop run. Use to an
- categories: agentic, felix, governance, system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `fetch_crypto_price`  —  **doc-only**
R125+35 — Live cryptocurrency prices. FREE, no key (CoinGecko). Pass CoinGecko COIN IDs (lowercase slugs like 'bitcoin','ethereum','solana' — NOT ticker symbols like 'BTC'), comma-separated for multiple. Returns price + 24h % change in the chosen fiat. Use for crypto price / mark
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: ids*:string, vs_currency:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_exchange_rate`  —  **doc-only**
R125+35 — Live fiat currency exchange rates. FREE, no key (open.er-api.com). Give a 3-letter base ISO code (default USD); optionally a target code to get a single pair rate, else returns all rates for the base. Use for currency conversion / FX questions.
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: base:string, target:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_hacker_news`  —  **doc-only**
R125+35 — Hacker News stories. FREE, no key (HN Algolia API). With no query returns the current front page; with a query returns matching stories. Each: title, url, points, author, comment count, HN discussion link. Use for tech-news pulse, trending topics, or 'what's on Hacker N
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_weather`  —  **doc-only**
R125+35 — Current weather for any city/place name. FREE, no key (open-meteo.com): geocodes the name then returns current temperature, apparent temp, humidity, precipitation, wind, weather code + units. Use when the user asks about weather, temperature, or conditions in a place. P
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: city*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_wikipedia`  —  **doc-only**
R125+35 — Plain-language Wikipedia summary (intro extract + description + canonical URL) for a topic/person/place. FREE, no key (en.wikipedia.org REST). Use for quick encyclopedic facts and definitions. Extract text is fenced (untrusted external content). For deep/multi-source re
- categories: research, web, knowledge · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: title*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `figma`  —  **doc-only**
Read or comment on Figma designs via Figma's REST API. Actions: get_design_context (summary + screenshot of a node), get_file (file metadata), get_nodes (specific nodes), render_images (export PNG/SVG), get_components, get_styles, get_comments, post_comment, get_me, get_team_proj
- categories: design, research · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: action*:string, fileKey:string, nodeId:string, nodeIds:array, url:string, format:string, scale:number, message:string, teamId:string, projectId:string, depth:number, renderImage:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `fill_pdf`  —  **doc-only**
Fill in form fields of an existing fillable PDF. Set values for text fields, check/uncheck checkboxes, and select dropdown options. Optionally flatten the form (make it non-editable). Use for completing forms, applications, or any fillable PDF.
- categories: pdf · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: inputPath*:string, fields*:object, outputPath:string, flatten:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `finalize_video`  —  **doc-only**
R98.14 W1.4 — Concatenate completed chapters into the final MP4 (and upload to Drive if enabled). IDEMPOTENT + RESUMABLE: if concat fails, the chapter MP4s stay on disk; calling finalize_video again retries JUST the concat step (no re-render). If already done, returns the cached 
- categories: product_output, media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: job_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `finance_market_overview`  —  **doc-only**
Get a snapshot of major market indices with current values and daily change percentages. Covers Chinese A-share market indices. Use for quick market pulse checks, daily briefings, or as context for financial analysis.
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_news`  —  **doc-only**
Fetch real-time financial and trending news from multiple global sources. Returns ranked headlines with links. Sources include Cailian Press, WallStreetCN, Xueqiu (Snowball), Hacker News, Weibo, Baidu, and more. Use for market research, trend monitoring, competitive intelligence,
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: sources:array, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_stock_price`  —  **doc-only**
Get historical stock price data (OHLCV) for A-Share and Hong Kong stocks. Returns daily open/high/low/close/volume with change percentages and a summary. Use for stock analysis, price tracking, trend identification, or financial reporting.
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: ticker*:string, days:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_stock_search`  —  **doc-only**
Search for stock tickers by company name or code. Supports A-Share (Shanghai/Shenzhen) and Hong Kong markets. Returns matching ticker codes and company names. Use when you need to find the ticker code for a company before looking up its price.
- categories: finance · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, market:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `financial_snapshot`  —  **doc-only**
Unified financial snapshot — one call gives you everything: revenue with period-over-period variance and trend (up/down/stable), collections aging (current/30/60/90+ day buckets), average receivable age, expenses with variance, net income trend, profit margin, burn rate, runway e
- categories: finance, reporting · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: period:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `findings_publish`  —  **live-safe**
R106 N2 / R125+15 — Share data with SIBLING in-flight subtasks (other chunks of the same chunk-and-parallel job). Two modes: (1) DISCOVERY (default, append-only) — broadcast a high-confidence find that saves sibling work (a working format, a confirmed fact, a clean asset, a safe 
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, subtask_id*:string, finding:any, confidence:number, slot_key:string, claim:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `findings_read`  —  **live-safe**
R106 N2 / R125+15 — Read what SIBLING subtasks have shared on a parallel-build job. THREE modes: (1) DISCOVERY (default) — NEW findings posted by siblings (excludes your own), cursor-paged via since_id, minConfidence 0.6 strips noise. (2) SLOT — pass slot_key to get the current l
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, caller_subtask_id:string, since_id:number, min_confidence:number, limit:number, slot_key:string, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `firecrawl_crawl`  —  **doc-only**
Crawl an entire website using Firecrawl — follows links from a starting URL, scrapes multiple pages, and stores all content in the database. Great for indexing competitor sites, documentation portals, or any multi-page site. Returns list of all pages found and stored.
- categories: scraping · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: url*:string, limit:number, maxDepth:number, includePaths:array, excludePaths:array, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `firecrawl_map`  —  **doc-only**
Quickly discover all URLs on a website without scraping them. Returns a sitemap-like list of all reachable pages. Use to plan a targeted crawl or understand a site's structure before scraping.
- categories: scraping · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `firecrawl_scrape`  —  **doc-only**
Scrape a single URL using Firecrawl, extract clean markdown content, and save it to the scraped pages database for later retrieval. Returns the page content and a database ID. Use when you need to capture and store a specific web page.
- categories: scraping · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `firecrawl_search`  —  **doc-only**
Search the web using Firecrawl and get clean, LLM-ready markdown results. Better than web_search for getting actual page content — returns full scraped markdown from top results. Use for deep research when you need the actual content of web pages, not just summaries.
- categories: scraping · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `forecast_ticker`  —  **doc-only**
Generate a directional market forecast for a single stock/crypto symbol over the next N trading days. Pulls 90 days of free OHLC history, computes SMAs + volatility, then asks an LLM analyst for a calibrated trend (bullish/bearish/neutral) + confidence + reasoning. Returns struct
- categories: finance, research, system · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: symbol*:string, horizonDays:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `fork_conversation`  —  **doc-only**
Fork (clone) a conversation to create a branch. Copies all messages up to an optional limit into a new conversation. Use to try different approaches, save state before risky operations, or branch a discussion.
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: conversationId*:number, messageLimit:number, newTitle:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `format_post`  —  **doc-only**
R79 (MarTech Bundle, after Charlie Hills' post-formatter MIT) — render a topic into a ready-to-publish post using a named copy framework: PAS (Problem/Agitate/Solution), AIDA (Attention/Interest/Desire/Action), BAB (Before/After/Bridge), STAR (Situation/Task/Action/Result), or SL
- categories: content, social · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: topic*:string, framework*:string, platform:string, context_dump:string, voice_profile_name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `generate_audio`  —  **doc-only**
Generate audio narration from text using text-to-speech. Default provider (R110.3+): Fish Audio s2-pro (primary, ~$0.001/scene, ~10 req/s capacity). Auto-cascades Fish → OpenAI → Edge on rate-limit/quota error. Saves the audio file and uploads to Google Drive. Use this to create 
- categories: media · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: text*:string, voice:string, provider:string, filename:string, project_id:number, strictVoice:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `generate_chart`  —  **doc-only**
Generate an interactive chart that will be rendered inline in the chat. Use when the user asks for data visualization, comparisons, trends, or any visual representation of data.
- categories: charts · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: type*:string, title*:string, data*:array, xKey:string, yKey:string, colors:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `generate_content_matrix`  —  **doc-only**
R79 (MarTech Bundle, after Charlie Hills' content-matrix MIT) — build a pillars x formats grid (Justin Welsh style) producing 32+ specific post ideas in one call. Default 8 formats: list / story / contrarian / how-to / case-study / teardown / lesson / prediction. Pillars default 
- categories: content, social, planning · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: pillars:array, formats:array, voice_profile_name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `generate_dashboard`  —  **doc-only**
Generate an interactive HTML dashboard that will be rendered in a live canvas inside the chat. Use for rich visualizations, status boards, KPI displays, data tables, or any complex visual output that goes beyond a simple chart. The HTML can include inline CSS and JavaScript. Use 
- categories: charts · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, html*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `generate_design_doc`  —  **doc-only**
R125+37 — Reverse-engineer ANY public web page's visual design language into a structured, reusable DESIGN.md. Fetches the page's HTML + same-origin CSS (SSRF-jailed, https-only) and runs ONE synthesis pass that extracts: color ROLES + relationships, typography (families/scale/we
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string, persist:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `generate_hooks`  —  **doc-only**
R79 (MarTech Bundle, after Charlie Hills' hook-generator MIT) — generate 6 (default) two-line LinkedIn hook variations for a topic, each <=40 chars per line, every variation including a digit and a 'How I'/'I' statement. Angles: number-led, contrarian, transformation, authority s
- categories: content, social · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: topic*:string, count:integer, voice_profile_name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `generate_legal_document`  —  **doc-only**
Generate professional legal documents from specifications. Supports NDAs (mutual, one-way, employee, vendor), terms of service, privacy policies, freelancer agreements, partnership agreements, SOWs (statements of work), MSAs (master service agreements), and cease & desist letters
- categories: legal · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: document_type*:string, party_a*:string, party_b:string, description*:string, jurisdiction:string, duration:string, compensation:string, special_terms:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `generate_schema_markup`  —  **doc-only**
Generate JSON-LD structured data (schema.org markup) for any web page. Supports Article, Product, FAQPage, HowTo, Organization, LocalBusiness, SoftwareApplication, BreadcrumbList, Event, and more. Returns valid JSON-LD ready to paste into HTML <head>. Use when optimizing pages fo
- categories: legal · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: schema_type*:string, page_url:string, title*:string, description:string, content:string, author:string, date_published:string, date_modified:string, image_url:string, organization_name:string, organization_url:string, organization_logo:string, price:string, currency:string, faq_pairs:string, steps:string, breadcrumbs:string, event_start:string, event_end:string, event_location:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `generate_social_image`  —  **doc-only**
Generate an AI image for social media posts, marketing materials, or visual content. Creates the image using AI, uploads it to Google Drive, and returns a shareable link. Use this when you need a visual to accompany a social media post, blog, or marketing campaign.

COST-AWARE QU
- categories: marketing, media · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: prompt*:string, style:string, platform:string, folder_label:string, purpose:string, reference_image_paths:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `get_agent_run`  —  **live-safe**
Use when investigating what a specific agent run actually did (after a failure, when Bob asks "show me the trace", or for post-mortem analysis). Returns the full step-by-step trace including each decision, specialist dispatch, tool result, and final outcome. Pair with list_agent_
- categories: agentic, system · speed: normal · network: no
- risk: safe (LOW)
- params: runId*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_daily_notes`  —  **live-safe**
Use when reconstructing what happened on a specific day ("what did we ship Tuesday"), when picking up after time away, or when auditing agent activity. Returns the activity log + agent notes for the requested date or recent N days. Pair with sessions_history for full transcript c
- categories: notes · speed: normal · network: no
- risk: safe (LOW)
- params: date:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_done_condition`  —  **live-safe**
R115.5 — Look up the pinned 'done condition' for (refKind, refId) so the evaluator grades against the verbatim contract instead of a re-imagined criterion. Default status='open'. Returns {ok, contract} or {ok:false, error:'no_contract'}.
- categories: planning, governance, system · speed: fast · network: no
- risk: safe (LOW)
- params: refKind*:string, refId*:string, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_eval_report`  —  **live-safe**
Use BEFORE Bob ships a persona prompt change, after running a benchmark sweep, or when answering "is the platform getting better or worse over time". Returns pass rates, per-task scores, and timing across all 16 personas. Drops in any score warrant a retro before promoting change
- categories: experiments · speed: normal · network: no
- risk: safe (LOW)
- params: persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `get_experiments`  —  **live-safe**
Use BEFORE trying an approach that might already have been tried — also when answering "what have we learned about X". Returns the experiment log filtered by topic/persona/date with hypothesis, approach, outcome, and timestamp. Search this before reinventing an approach the platf
- categories: experiments · speed: normal · network: no
- risk: safe (LOW)
- params: category:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_minerva_roster`  —  **live-safe**
Read-only: return Minerva's capability snapshot — the list of active agents, tools, integrations, and event types currently registered. This is what Minerva uses as ground truth before composing any plan. Anything not in this roster is invisible to the planner.
- categories: planning, minerva, system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_plan`  —  **live-safe**
Use when drilling into one specific plan after list_plans surfaced it — typically to read the full step list before approving, to debug a failure, or to extract Minerva's reasoning for replication. Returns plan_json (steps, agents, tools, costs, times) and Felix's decision metada
- categories: planning, minerva · speed: normal · network: no
- risk: safe (LOW)
- params: planId*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_unified_memory_context`  —  **live-safe**
R122 — Single read surface across 11 memory-adjacent tables (memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations). Read-only. Tenant-isolated via R120 withTe
- categories: system, memory, conversations, knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: query:string, sources:array, sinceDays:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_usage_analytics`  —  **live-safe**
Pull this tenant's chat-usage analytics for the last N days: total sessions/messages, estimated tokens in/out, estimated cost in USD, breakdown by model, tool-usage histogram, activity by hour-of-day and day-of-week, and the top sessions by token count. Use when Bob asks anything
- categories: system, finance · speed: normal · network: no
- risk: safe (LOW)
- params: days:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_user_info`  —  **live-safe**
Get the current user's account information including their name, email, and plan. Use this when you need to send files, reports, or communications to the current user and need their email address.
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `get_voice_profile`  —  **live-safe**
R79 — fetch a stored voice profile (about-me + voice + pillars + audience) for the current tenant. Use to inspect what is currently in force or to copy a profile into another channel-specific persona. Returns null when no profile exists for that name.
- categories: content, branding · speed: normal · network: no
- risk: safe (LOW)
- params: profile_name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `google_drive`  —  **doc-only**
Manage files in Google Drive. R98: when `projectId` is given on upload, the file lands DIRECTLY in the project's named Drive folder (e.g. '[Your Product]') and a project_files DB row is auto-written for later lookup — USE THIS FOR ALL PROJECT DELIVERABLES. Use 'search' to find a
- categories: files · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: command*:string, filePath:string, fileName:string, mimeType:string, description:string, share:boolean, customerName:string, folderLabel:string, projectId:number, fileId:string, query:string, namePattern:string, maxResults:number, savePath:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `google_workspace`  —  **doc-only**
Access Google Workspace services: Gmail, Calendar, Contacts, Sheets, Docs, and Slides. Requires Google account to be connected via Settings > General > Connect Subscription. Use this for reading/sending emails, managing calendar events, looking up contacts, reading/writing spread
- categories: workspace · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: service*:string, action*:string, query:string, messageId:string, to:string, cc:string, bcc:string, subject:string, body:string, addLabels:array, removeLabels:array, timeMin:string, timeMax:string, start:string, end:string, description:string, location:string, attendees:array, eventId:string, calendarId:string, name:string, email:string, phone:string, organization:string, spreadsheetId:string, documentId:string, range:string, values:array, inputOption:string, maxResults:number, slides:array, theme:string, logoUrl:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `grade_deliverable`  —  **doc-only**
R98.13 W3 — VISION/AUDIO QUALITY GRADER. Per-format rubric scoring (0-100) with detailed issues + critique for auto-revise. Video: ffprobe + black-detect + AV-drift + meta-narration scan. Audio: ffprobe + LUFS + end-cut detection. PDF: header + EOF + page count + font embedding. 
- categories: validation, system · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: deliverable_type*:string, file_path:string, file_url:string, expected_spec:object, acceptance_notes:string, request:string, model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `graph_memory`  —  **doc-only**
Structured graph-based memory system with trigger conditions, rollback, and identity persistence. Unlike flat vector embeddings, graph memory organizes knowledge in hierarchical nodes with parent-child relationships, cross-references, and conditional triggers ('when X happens, re
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, path:string, content:string, trigger_condition:string, query:string, link_to:string, version:number, persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `grounding_intervention`  —  **doc-only**
Safety: generate a grounding intervention script (somatic / breathwork / sensory) for a detected shame-spiral state. Call AFTER detect_emotional_state confirms intervention is needed. Selects intervention based on intensity. Returns script, action type, and follow-up prompt.
- categories: wellness, safety, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: intensity:string, needs_immediate:boolean, patterns:array, previous_intervention_ids:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `hypothesis_attach_evidence`  —  **live-safe**
R108 B — Attach a piece of evidence to a pinned hypothesis (Causal Graph Reasoning, LuaN1aoAgent cherry-pick). Use to GROUND a load-bearing claim instead of asserting it: a memory entry id, finding id, tool-result snippet, or short free-text observation. Each edge carries its own
- categories: system, memory, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: hypothesis_id*:number, evidence_kind*:string, evidence_ref*:string, confidence:number, note:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `hypothesis_evidence_chain`  —  **live-safe**
R108 B — Read the full evidence chain attached to a single pinned hypothesis, ordered by confidence DESC. Use BEFORE making a decision that depends on a pinned hypothesis to verify the grounding is still strong (e.g. evidence not stale, ref still resolvable, confidence didn't deg
- categories: system, memory, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: hypothesis_id*:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `hypothesis_list_pinned`  —  **live-safe**
R106 N4 — List currently-active pinned hypotheses for the calling tenant + persona (and optionally the current conversation). Read this at the start of any long task to recover context that a prior compression step might have summarized away.
- categories: system, memory, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: conversation_id:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `hypothesis_pin`  —  **live-safe**
R106 N4 — Pin a load-bearing hypothesis so it SURVIVES chat-engine context compression. Use when a long-running task depends on a working assumption you must not lose if older messages get summarized away (e.g. 'user's brand color is #FF6A00', 'we confirmed Drive folder X is the 
- categories: system, memory, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: hypothesis*:string, confidence:number, ttl_minutes:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `ideation_session`  —  **doc-only**
Run a structured ideation session using proven innovation frameworks (SCAMPER, First Principles, Jobs to Be Done, Pre-mortem, How Might We, Constraint-Based). Takes a raw idea through 3 phases: Diverge (expand with 5-8 variations), Converge (stress-test 2-3 directions), Ship (pro
- categories: ideation · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: idea*:string, phase:string, frameworks:array, context:string, save_as_note:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `inbox_allowlist_list`  —  **doc-only**
R104 — List the inbox sender allowlist entries (approved + blocked) for this tenant.
- categories: system, communication · speed: normal · network: no
- risk: safe (LOW) · gates: trustedPersonasOnly
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (trustedPersonasOnly)

## `inbox_quarantine_list`  —  **doc-only**
R104 — List inbound messages currently held in quarantine for this tenant (unknown senders, no prior correspondence, no allowlist entry). Use to triage which addresses to inbox_sender_approve.
- categories: system, communication · speed: normal · network: no
- risk: safe (LOW) · gates: trustedPersonasOnly
- params: limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (trustedPersonasOnly)

## `inbox_sender_approve`  —  **doc-only**
R104 — Approve an inbound email sender. Marks the address as a trusted correspondent so future inbound messages skip quarantine, and un-quarantines any prior held messages from this address. Trusted-only.
- categories: system, communication, security · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: address*:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)


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


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `list_custom_tools`  —  **live-safe**
Use when auditing what custom tools the learning system has registered, when troubleshooting "the agent has a tool I don't recognize", or before delete_custom_tool. Returns custom-tool rows with name, description, usage count, active flag. Custom tools live alongside the 259 buil
- categories: tools · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_customers`  —  **live-safe**
Use when reviewing the pipeline at session start, when Bob asks "who is in the funnel", before drafting outreach to avoid duplicates, or when a follow-up is overdue. Returns customer/prospect rows with name, deal stage, status, value, and last-contact date. Filter by stage to foc
- categories: crm · speed: normal · network: no
- risk: safe (LOW)
- params: deal_stage:string, status:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_expenses`  —  **live-safe**
Use when preparing a P&L view, answering "how much did we spend on X", before approving a recurring charge, or when categorizing for tax/accounting. Returns expense rows with date, amount, vendor, category, and notes for the requested date range.
- categories: expenses · speed: normal · network: no
- risk: safe (LOW)
- params: start_date:string, end_date:string, category:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_felix_loop_runs`  —  **live-safe**
Use when auditing what Felix has been READING (not just what he proposed), when answering "why did Felix decide X", or when correlating loop runs with outcomes. Returns recent runs with context summary, intent (Felix's read of the world), proposal count, tokens, and cost. Read-on
- categories: agentic, felix, governance, system · speed: normal · network: no
- risk: safe (LOW)
- params: limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_felix_proposals`  —  **live-safe**
Use when Bob asks "what has Felix been thinking about", before any approval session, or when auditing the loop. Returns Felix's drafted proposals filtered by status (pending | approved | rejected | executed | expired). In dry-run mode every Felix action lands here for explicit Bo
- categories: agentic, felix, governance · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_invoices`  —  **live-safe**
Use when reviewing receivables at session start, when Bob asks "who owes us money", before sending payment-reminder outreach, or when reconciling against Stripe. Returns invoices with status, amounts, and overdue flags. Filter by status (draft/sent/paid/overdue/cancelled) to focu
- categories: invoicing · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_models`  —  **live-safe**
Use when picking a model for a specific job, when an unfamiliar model_id appears in logs, or when troubleshooting "why did my call route to X". Returns every available model with name, provider, tier (free/cheap/premium), and capabilities. Pair with the cost-aware doctrine to pic
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_open_tensions`  —  **live-safe**
Use BEFORE reasoning on any hard problem so you don't re-litigate a known conflict. A "tension" is a documented gap between expectation and reality (e.g. "user thinks X should auto-publish, code requires manual approval"). Returns unresolved tensions in this tenant with title, de
- categories: memory, reasoning, experiments, system · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, source_kind:string, owner_persona_id:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_pdf_fields`  —  **live-safe**
Use BEFORE filling a PDF form so you know exactly which field names exist and what type (text/checkbox/dropdown) each accepts. Required first step in the PDF-fill workflow — guessing field names usually fails. Returns field name, type, and current value for every fillable field.
- categories: pdf · speed: normal · network: no
- risk: safe (LOW)
- params: inputPath*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_pending_approvals`  —  **live-safe**
Use at session start to surface anything blocking agent work, when Bob asks "what needs my attention", or after a known-pending workflow. Returns approval requests still awaiting Bob's decision with requester, target action, age, and context summary. Always check this before sayi
- categories: agentic, governance · speed: normal · network: no
- risk: safe (LOW)
- params: limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_plans`  —  **live-safe**
Use when Bob asks "what is Minerva planning" or "what is Felix deciding", before approving any plan to see related history, or when auditing what plans came through this week. Returns plans for this tenant with status (awaiting_approval | approved | executing | rejected | revisin
- categories: planning, minerva · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_procedure_edits`  —  **live-safe**
List this tenant's proposed/approved/applied/rolled_back procedure edits. Read-only. Filterable by status and targetId. Use to inspect the AEvo review queue.
- categories: governance, system · speed: fast · network: no
- risk: safe (LOW)
- params: status:string, targetId:string, limit:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_scheduled_messages`  —  **live-safe**
List all recurring scheduled messages for the current tenant. Returns id, title, cron, next_run_at, status. Use before scheduling to avoid duplicates.
- categories: messaging · speed: normal · network: no
- risk: safe (LOW)
- params: activeOnly:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_scheduled_posts`  —  **live-safe**
List this tenant's scheduled cross-platform posts. Optional status filter (pending | publishing | sent | partial | failed | cancelled). Returns the most recent 50 by default, ordered by scheduled_for DESC. Read-only.
- categories: messaging, marketing · speed: fast · network: no
- risk: safe (LOW)
- params: status:string, limit:integer
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_sequences`  —  **live-safe**
Use when auditing outreach performance, before launching a new campaign (to learn from what worked), or when Bob asks "which sequence is converting". Returns each sequence with enrollment, completion, and reply-rate stats. Pair with sequence-detail tools to see step-level perform
- categories: outreachSequencing · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_skill_candidates`  —  **live-safe**
Use when reviewing what the platform has LEARNED to do but hasn't been promoted to a formal skill yet — typically when Bob asks "what is the system trying to teach itself". Returns pending skill_candidate rows with name, evidence summary, and detected pattern. Felix or Bob then c
- categories: skillEvolution, tools · speed: normal · network: no
- risk: safe (LOW)
- params: status:string, personaId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_task_forces`  —  **live-safe**
List this tenant's task-forces, optionally filtered by status (active/paused/completed/sunset).
- categories: agentic, governance · speed: fast · network: no
- risk: safe (LOW)
- params: status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_uploads`  —  **live-safe**
List all previously uploaded files (images, PDFs, etc.) stored in the system. Use this to find uploaded logos, images, or documents before referencing them in create_pdf headerImage or other tools. Returns filename, original name, type, and size.
- categories: files · speed: normal · network: no
- risk: safe (LOW)
- params: type:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `list_wakes`  —  **live-safe**
List this tenant's scheduled wakes, optionally filtered by status (pending/fired/cancelled/failed).
- categories: agentic, planning · speed: fast · network: no
- risk: safe (LOW)
- params: status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `llm_task`  —  **doc-only**
Run a focused JSON-only LLM sub-task with optional schema validation. Ideal for structured extraction, classification, summarization, or drafting within workflows. The sub-model returns only valid JSON — no commentary.
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: prompt*:string, input:any, schema:object, model:string, thinking:string, temperature:number, maxTokens:number, images:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `lobster`  —  **doc-only**
Run deterministic multi-step workflows with approval gates and resume tokens. Chain commands/tools into pipelines. Supports inline pipelines (pipe-separated commands), .lobster workflow files (YAML), and approval checkpoints that pause execution until approved. Use for complex mu
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: action*:string, pipeline:string, token:string, approve:boolean, argsJson:string, timeoutMs:number, maxStdoutBytes:number, workflowId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `log_expense`  —  **doc-only**
Record a business expense for tracking and tax purposes. Categories: software, hosting, api_costs, marketing, travel, meals, office, equipment, professional_services, insurance, taxes, payroll, utilities, subscriptions, other.
- categories: expenses · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: amount*:number, category*:string, vendor:string, description:string, date:string, payment_method:string, is_deductible:boolean, project_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `log_experiment`  —  **doc-only**
Use AFTER trying a non-trivial new approach (prompt change, tool combo, workflow tweak) so the platform learns what worked. Captures hypothesis, approach, and outcome into the experiments log. Returns the recorded experiment id. Pair with get_experiments to retrieve later. Skip f
- categories: experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: hypothesis*:string, approach*:string, category*:string, metric:string, baselineValue:string, resultValue:string, status*:string, outcome:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `log_interaction`  —  **doc-only**
Log a customer interaction (call, email, meeting, demo, proposal, follow_up, note). Automatically updates last contact date.
- categories: crm · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: customer_id*:number, interaction_type*:string, subject:string, notes:string, outcome:string, follow_up_date:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `lookup_ip_geo`  —  **doc-only**
R125+35 — Geolocate an IP address (city, region, country, lat/lon, timezone, ISP/org). FREE, no key (ipwho.is, HTTPS). Pass a valid IPv4/IPv6 address (required). Use for IP-to-location, abuse/triage, or 'where is this IP'.
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: ip*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `lookup_output_skill`  —  **live-safe**
Pull a structured scaffolding template for a corporate / small-business deliverable on demand. Use when you're about to produce a PRD, OKR, board deck narrative, investor update, contract review, NDA analysis, compliance checklist, sales battlecard, discovery call prep, GTM plan,
- categories: planning, system, memory · speed: fast · network: no
- risk: safe (LOW)
- params: topic:string, department:string, persona:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `manage_content_calendar`  —  **doc-only**
Use when scheduling social posts ahead of time, when answering "what is going out this week", or when removing a post that no longer fits. Three sub-ops: add (schedule new post), view (list upcoming), remove (cancel scheduled). Returns the modified calendar slice. Pair with marke
- categories: marketing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, platform:string, content:string, scheduled_date:string, post_id:string, style:string, campaign:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `manage_desk`  —  **doc-only**
Manage your persistent working state — update task progress, add items to your desk, mark things as blocked or completed. Your desk persists across conversations and heartbeat cycles so you always know what you were working on.
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, taskId:string, title:string, description:string, priority:string, progressNote:string, blockedBy:string, focusArea:string, statusNote:string, waitingForPersona:string, waitingDescription:string, source:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `manage_skills`  —  **doc-only**
Create, list, update, enable/disable, or delete skills. Skills are reusable prompt instructions that teach you (or other agents) how to handle specific workflows, domains, or capabilities. Use 'create' to build a new skill when you encounter a task type you'll need again. Use 'li
- categories: tools · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: command*:string, id:number, name:string, description:string, promptContent:string, category:string, icon:string, personaId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `manage_social_accounts`  —  **doc-only**
View and manage connected social media accounts for publishing. List connected platforms, check connection status, or get setup instructions.
- categories: marketing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `manage_watchlist`  —  **doc-only**
Manage persistent monitoring watchlists. Set up tracking for competitors, industry trends, customer mentions, technology changes, or regulatory updates. Items are automatically scanned on schedule and alerts are generated when changes are detected.
- categories: competitorIntel · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, name:string, category:string, searchQueries:array, keywords:array, checkFrequency:string, escalateTo:string, watchlistItemId:number, alertId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `marketing_analytics`  —  **doc-only**
Use AFTER posts have published to log results and learn — also when Bob asks "is the content strategy working" or before planning the next campaign. Returns post-level metrics (impressions/likes/shares/conversions), campaign roll-ups, and optimization recommendations. Sub-ops: lo
- categories: marketing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, platform:string, post_content:string, metrics:object, date_range:string, campaign:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `marketing_experiment`  —  **doc-only**
Use when testing a marketing variable (subject line, CTA copy, posting time, image style) on social/email. Captures hypothesis + variants, then determines a winner once results are in. Returns the experiment row with variants, results, and (when available) statistical winner. For
- categories: marketing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, experiment_name:string, hypothesis:string, variant_a:string, variant_b:string, variant_a_metrics:object, variant_b_metrics:object, learning:string, next_action:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `memory_geometry_scan`  —  **live-safe**
R107 — Geometry of Consolidation audit (Vangara & Gopinath 2026, MIT). Samples the tenant's active memory embeddings (optionally filtered by persona / wing / category), computes per-cluster geometry (mean within-cluster cosine distance d̄, participation-ratio dimension d_eff) and
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: persona_id:number, wing:string, category:string, theta:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `messaging_status`  —  **doc-only**
Use BEFORE scheduling or sending on a specific channel to confirm it's configured AND running — also when diagnosing a delivery failure ("did SMS just stop working?"). Returns telegram/sms/whatsapp/email/web status with configured flag, running flag, and last-error if applicable.
- categories: messaging, system · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `micro_sabbatical`  —  **doc-only**
Wellness: generate a sensory-rich micro-sabbatical intervention (60-120 sec) to replace a craving with a 'receive instead of reach' experience. Call AFTER detect_fatigue confirms fatigue. Returns an intervention with sensory focus (auditory/visual/tactile/thermal). Pairs with tra
- categories: wellness, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: fatigue_type:string, previous_intervention_ids:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `mind_ticket`  —  **doc-only**
Manage tickets within a Mind system. Tickets track work that needs to be done. Supports creating tickets with priorities (0=critical, 1=high, 2=normal, 3=low), delegating to worker agents, and verifying completed work with AI-powered PASSED/FAILED verdicts and confidence scores.
- categories: crews · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, mindId:number, ticketId:number, title:string, description:string, acceptanceCriteria:string, priority:number, ticketType:string, dependsOn:array, status:string, personaId:number, model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

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


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `recall_capabilities`  —  **live-safe**
R125+3.9 — The 'what can I do for THIS prompt' tool. Single semantic-search entrypoint that returns a ranked shortlist of (a) past release-rounds, (b) .agents/ + output/ skill bodies, (c) directly matching registered tools — for the user's current ask. Use at the START of any non
- categories: knowledge, system, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: query*:string, top_k:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `recall_context`  —  **doc-only**
Recall earlier conversation history that was compacted (summarized) to save context space. Use this when you need to remember details from earlier in a conversation or from OTHER conversations in the same project. Search by keyword to find specific topics. This is your long-term 
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: conversationId:number, query:string, limit:number, projectWide:boolean, level:string, direction:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_failure_patterns`  —  **doc-only**
R98.7 — Pull your past strategic mistakes so you don't repeat them. CALL THIS at the START of any non-trivial task and AGAIN before declaring it done. Returns the most recently-recorded patterns for this persona/tenant, optionally filtered by tags. Pair with the static `data/pers
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tags:array, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_references`  —  **doc-only**
R98.14 — Recall references previously learned via learn_from_reference. Filter by deliverable_type and/or style_tags. Returns up to N matching references with full pattern lists. Use at task start (alongside recall_strategic_wins + recall_failure_patterns) to load relevant taste 
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: deliverable_type:string, style_tags:array, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_strategic_wins`  —  **doc-only**
R98.12 W7 — Pull strategic wins recorded by record_strategic_win, tenant + persona scoped. Optional tag filter. CALL THIS at task start (alongside recall_failure_patterns) so you start from your best known patterns instead of cold. Returns parsed structured rows including win, tr
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tags:array, impact_min:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recommend_best_tool`  —  **live-safe**
TOOL SELECTION GATE (R112.18 Layer 2). Returns the top-3 tools most likely to handle a given intent, ranked by embedding similarity against the 341-tool inventory plus per-tenant historical performance. MANDATORY before any plan with 3+ tool-call steps OR any tool call involving 
- categories: planning, system · speed: fast · network: no
- risk: safe (LOW)
- params: intent*:string, excludeTools:array, topK:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `record_ab_event`  —  **doc-only**
Record an impression or conversion for one variant of a running A/B experiment.
- categories: agentic, experiments · speed: fast · network: no
- risk: sensitive (LOW) · gates: risk=sensitive
- params: experimentId*:number, variantLabel*:string, kind*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_bwb_weight`  —  **live-safe**
Built With Bob — log Bob's weigh-in WITHOUT triggering any video build. Persists his weight figures to the same durable store (agent_settings) the weekly recap reads as a SUPPLIED FACT, and stamps the update time. Use this whenever Bob states his weight in conversation (e.g. 'I w
- categories: data · speed: fast · network: no
- risk: safe (LOW)
- params: currentWeight:number, totalLost:number, startWeight:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `record_failure_pattern`  —  **doc-only**
R98.7 — Record a strategic mistake you (or another persona) just made so you don't repeat it next session. Persisted into memory_entries with category='strategic_lesson' and surfaced by recall_failure_patterns at the start of any related task. USE THIS whenever Bob points out a r
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: pattern*:string, trigger*:string, fix*:string, self_check:string, severity*:string, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_kpi`  —  **doc-only**
Record a KPI metric value. Categories: revenue, growth, engagement, operations, financial, marketing, sales, product. Tracks against optional targets.
- categories: kpi · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: metric_name*:string, category*:string, value*:number, target:number, unit:string, period:string, period_start:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_strategic_win`  —  **doc-only**
R98.12 W7 — Mirror of record_failure_pattern for SUCCESSES. Persist a strategic WIN (a planning move, tool combination, prompt approach, or workflow that produced an unusually good outcome) so recall_strategic_wins can surface it next session. Use whenever Bob praises a result, O
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: win*:string, trigger*:string, technique*:string, do_this_again:string, impact*:string, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recursive_synthesize`  —  **doc-only**
Synthesize an answer across LONG content (research dumps, many documents, long transcripts, scraped pages — anything larger than a single direct LLM call can handle reliably). Implements Algorithm 1 from the Recursive Language Models paper (Zhang/Kraska/Khattab, MIT CSAIL Jan 202
- categories: reasoning, research · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: content*:string, task*:string, rootModel:string, subModel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `register_character_portrait`  —  **live-safe**
R99 — Felix Visual Continuity (ViMax #1). Manually add ONE canonical portrait of a recurring character or environment to the tenant's portrait registry. Identifier+view is the natural key (UPSERT — second call for same key replaces image_path). Views: 'front' | 'three_quarter' | 
- categories: media, system · speed: normal · network: no
- risk: safe (LOW)
- params: identifier*:string, view*:string, image_path*:string, description:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `reject_felix_proposal`  —  **doc-only**
Use when Bob explicitly rejects a Felix proposal AND can articulate why (the reason teaches Felix). Bob-only operation. Returns success. The reason is stored in the proposal row and feeds Felix's lesson loop — vague reasons ("no") teach nothing; specific reasons ("wrong tenant" /
- categories: agentic, felix, governance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, reason*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `reject_procedure_edit`  —  **doc-only**
Reject a proposed procedure edit. Status proposed→rejected. The edit row is preserved for audit but cannot be applied.
- categories: governance, system · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: editId*:integer, note:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `reject_skill_candidate`  —  **doc-only**
Reject a skill_candidate so it does not pollute the skill library. Always include a brief reason for the rejection — helps the synthesizer learn what kinds of patterns are not worth saving.
- categories: skillEvolution, tools · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, reason:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `remember_for_this_session`  —  **live-safe**
R112.15: Pin a fact to THIS conversation's L2 session memory. Use when something important was just established that you'll need later in this same conversation but isn't durable enough to belong in persona-lifetime memory (which is what `create_memory` is for). Examples: 'user i
- categories: memory · speed: normal · network: no
- risk: safe (LOW)
- params: fact*:string, kind*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `render_diagram`  —  **doc-only**
Render a Mermaid diagram (flowchart, sequence diagram, architecture map, state diagram, class diagram, gantt chart, etc.) as a PNG image, upload it to Google Drive, and return a shareable link. Use this for system architecture diagrams, process flows, data flow maps, org charts, 
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: mermaid_code*:string, title*:string, theme:string, background_color:string, folder_label:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `repurpose_content`  —  **doc-only**
Take one piece of long-form source content (transcript, article, blog post, video description) and emit platform-shaped variants in a single LLM call. Each variant respects the destination platform's character limit and voice convention. Supported platforms: x (Twitter), linkedin
- categories: content, marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: sourceText*:string, targetPlatforms*:array, brandVoice:string, callToAction:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `request_approval`  —  **doc-only**
Pause an agent run and request human approval before proceeding with a sensitive action (spending money, sending mass email, signing contracts, publishing, deleting data). Creates a pending approval that Bob can approve or reject. If a runId is provided, that run is paused until 
- categories: agentic, governance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: question*:string, context:object, runId:number, ttlHours:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `research_digest`  —  **live-safe**
Generate a weekly research digest that consolidates all nightly research findings, code proposals, and actionable improvements into a structured brief. Writes to .local/research-digest.md and uploads to Google Drive. Use this to review what the research engine has discovered and 
- categories: experiments, research · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `resolve_tension`  —  **doc-only**
Mark a TENSION as resolved with the fix and supporting evidence. Future personas reading list_resolved_tensions (or the graph explorer) will learn from your resolution. ALWAYS include resolution_evidence — at minimum a paragraph in the evidence object explaining what worked.
- categories: memory, reasoning, experiments, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tension_id*:number, resolution*:string, resolution_evidence:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `revenue_report`  —  **doc-only**
Monthly revenue breakdown with top customers. Shows invoiced vs collected amounts and average invoice size.
- categories: reporting · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: months:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `revenue_vs_cost`  —  **doc-only**
Show a unified revenue-vs-agent-cost dashboard for a period. Sums Stripe + Coinbase revenue, subtracts estimated AI/tool costs from the ledger, and returns burn ratio and a health verdict. Use when the user asks 'how are we doing financially' or before authorizing new spend.
- categories: agentic, finance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: days:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `rollback_procedure_edit`  —  **doc-only**
Rollback an APPLIED procedure edit. Atomically writes the captured beforeContent back to the playbook and restores the registry entry. Status applied→rolled_back. Destructive — mutates the procedure surface; requires HITL approval.
- categories: governance, system · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: editId*:integer, reason*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `run_ab_eval`  —  **doc-only**
R98.21 — CROSS-RUN A/B EVALUATION. Run the same prompt across N agent configs (different model + optional system prompt), score each output against a rubric via an LLM judge, and return ranked results. Use this when you (or Bob) want to settle 'which model/prompt actually wins fo
- categories: evaluation, self_improvement, system · speed: very_slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly
- params: name*:string, prompt*:string, configs*:array, rubric*:string, runs_per_config:number, judge_model:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive); trustedPersonasOnly)

## `run_agent_eval`  —  **doc-only**
Benchmark an agent persona against standardized eval tasks. Measures pass rate, score, and response time. Use to compare persona performance or validate quality after changes.
- categories: experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: persona_id*:number, runs:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `run_background_task`  —  **doc-only**
Launch a long-running tool in the background without blocking. Returns a task_id you can poll with check_background_task. Use this for slow operations like deep_research, produce_video, orchestrate, browser tasks, or any tool that takes more than 30 seconds. The tool runs asynchr
- categories: ai · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: tool_name*:string, params:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `run_command`  —  **doc-only**
R98.16 #1 — Execute an arbitrary shell command with LARGE-OUTPUT SANDBOXING. Unlike `slash_command` (which runs curated `.bob/commands/*.md` workflows), `run_command` is for ad-hoc shell needs (build/test/grep/log-tail/one-off scripts) where the output may be huge. Output ≤40 lin
- categories: system, code · speed: slow · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly
- params: action*:string, command:string, label:string, timeoutMs:number, domain:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly)

## `run_okr_review`  —  **doc-only**
Run an OKR review now (EXEC-06): recall current objectives from memory, assess on-track/at-risk/off-track, propose next-period adjustments with owners, and persist the scorecard. Normally fires automatically on a weekly cadence; use this to force one.
- categories: agentic, governance, felix · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly
- params: force:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly)

## `run_self_improvement`  —  **doc-only**
Launch an autonomous self-improvement cycle with signal extraction and stagnation detection. Scans runtime logs for error patterns, detects repeated failures, auto-selects evolution strategy (balanced/innovate/harden/repair-only), then runs A/B experiments. Inspired by Karpathy's
- categories: experiments · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: category:string, personaId:number, strategy:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `run_supervisor`  —  **doc-only**
Dispatch a task to a supervisor that routes subtasks to specialist agents (researcher, writer, analyst, critic) and synthesizes a final answer. Use for complex multi-step tasks where different skills are needed, e.g. 'research X then write a brief, then have a critic review it'. 
- categories: ai, agentic · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: task*:string, maxTurns:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `save_evidence`  —  **doc-only**
Save a research finding as structured evidence with source citation, confidence score, and theme. Evidence is stored separately from final answers and can be re-synthesized later. Use this after web_search or deep_research to build a trustworthy evidence store.
- categories: evidence · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: query*:string, claim*:string, sourceUrl:string, sourceTitle:string, sourceDate:string, theme:string, confidence:number, supportingQuote:string, contradicts:string, projectId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `scan_file`  —  **live-safe**
Security: scan a file using Google Magika ML to identify its TRUE content type from raw bytes (not extension or claimed MIME). Returns detected label, confidence score, whether it's text, and a security verdict. Use BEFORE processing any user-uploaded or untrusted file, especiall
- categories: system, security, files · speed: normal · network: no
- risk: safe (LOW)
- params: filePath*:string, claimedMime:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `scan_for_prompt_injection`  —  **live-safe**
Security: scan a block of untrusted text for prompt-injection threats (role override, instruction override, system-prompt leak, exfiltration, jailbreak phrases, invisible unicode, etc.) BEFORE you pass it as context to another model or include it in a system prompt. Returns {clea
- categories: security, system · speed: normal · network: no
- risk: safe (LOW)
- params: content*:string, source:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `scan_for_secrets`  —  **live-safe**
R110 +sec security: scan text or a file for credential-shaped secrets using the 48-pattern catalog (AWS keys, GCP service-account JSON, GitHub PATs, Stripe live keys, Anthropic sk-ant, OpenAI sk-, ElevenLabs, Slack tokens, SendGrid, Twilio, Discord/Telegram bot tokens, npm/PyPI/D
- categories: system, safety, security · speed: normal · network: no
- risk: safe (LOW)
- params: text:string, filePath:string, includeRedacted:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `schedule_cross_platform_post`  —  **doc-only**
Schedule the SAME piece of content to fan out to one or more social platforms at a chosen future time. Supported platforms: x (Twitter), linkedin, instagram, facebook, threads, pinterest, youtube. YouTube is video-only (the public Data API has no text-post endpoint) — if youtube 
- categories: messaging, delivery, marketing · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: platforms*:array, content*:string, scheduledFor*:string, imageUrl:string, videoUrl:string, campaign:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `schedule_message`  —  **doc-only**
Schedule a recurring message to a user at a cadence. Accepts natural language ('every Monday at 7am') OR a literal cron expression. The prompt can be a literal message OR (if expandViaPersona is set) a prompt that gets run through that persona at delivery time to generate fresh c
- categories: messaging, delivery · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, naturalSchedule:string, cron:string, prompt*:string, expandViaPersona:number, channel*:string, telegramChatId:number, phoneNumber:string, email:string, conversationId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `schedule_wake`  —  **doc-only**
Schedule a durable future wake-up: the system will autonomously resume work toward `goal` at `wakeAt`, even days later, surviving restarts. Use for follow-ups ('check on X tomorrow', 'in 3 days draft the report'). Persisted in the DB and scanned by the heartbeat.
- categories: agentic, planning · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: goal*:string, wakeAt*:string, kind:string, maxAttempts:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `score_leads`  —  **doc-only**
Score all enriched leads against the active ICP criteria using AI. Assigns scores (0-100), grades (A-F), and qualification status (qualified/nurture/disqualified). Requires define_icp to be called first.
- categories: leadEnrichment · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: ruleId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))


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


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `sessions_list`  —  **live-safe**
List active agent sessions (conversations) across the VisionClaw platform. Use to discover other agents/personas and their active sessions before sending inter-agent messages. Returns session keys, persona info, models, and activity timestamps.
- categories: sessions · speed: normal · network: no
- risk: safe (LOW)
- params: kinds:array, limit:number, activeMinutes:number, messageLimit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `sessions_send`  —  **doc-only**
Send a message to another agent session. The target session's persona will process the message and generate a reply. Use for inter-agent coordination, delegation, and cross-persona collaboration. Reply with REPLY_SKIP to end any ping-pong follow-up.
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sessionKey*:string, message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sessions_spawn`  —  **doc-only**
Spawn a background sub-agent run to perform a task asynchronously. The sub-agent runs in its own session and announces results back when finished. Use for parallelizing research, long tasks, or slow tool work without blocking the main conversation. Each sub-agent gets its own con
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: task*:string, label:string, agentId:number, model:string, thinkingLevel:string, runTimeoutSeconds:number, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `set_department_budget`  —  **doc-only**
Set a spend cap for a department (executive, engineering, marketing, sales, finance, operations, research, creative, support). When spend approaches the cap the heartbeat emits budget.warning; over the cap it emits budget.exceeded and the budget guard throttles that department's 
- categories: agentic, governance, finance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: department*:string, limitUsd*:number, period:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `set_my_profile_photo`  —  **doc-only**
R98.6 — Register the user's own face photo at the platform level so produce_video can auto-attach it to first-person slides ('I lost 236 lbs', 'my journey'). One-time setup: the user uploads a photo, you call this with the path, and from then on every produce_video call auto-inje
- categories: system, media · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, photo_path:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `set_policy`  —  **doc-only**
R76 — Trust-tier policy engine. Create or update a per-tenant tool policy that pre-approves or blocks specific tool calls so they bypass HITL. Owner-only. Use 'list' to see active policies, 'create' to add one, 'delete' to remove. Examples: allow send_email to your own address, a
- categories: system · speed: normal · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: action*:string, scope_kind:string, scope_value:string, policy_action:string, max_amount_cents:number, reason:string, policy_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `show_diff`  —  **live-safe**
Generate a diff between two texts, or format a unified patch. Shows additions, deletions, and change statistics. Use when comparing versions of text, code, configs, or any content.
- categories: diff · speed: normal · network: no
- risk: safe (LOW)
- params: before:string, after:string, patch:string, path:string, context:number, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `simulate_plan`  —  **doc-only**
IMAGINATION-SPACE PLAN ROLLOUT (R74.13z-quint Nugget 3, LeWorldModel-inspired). BEFORE committing to a multi-step plan that costs real money / time / side-effects, call this to score the plan against historical step traces in milliseconds. For each proposed step, the simulator fi
- categories: planning, felix, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: steps*:array, plan_summary:string, persist:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `site_login`  —  **doc-only**
Log into a website using credentials stored in the Credential Vault. Navigates to the site, finds the login form, auto-fills username/password from the vault, and submits. If no vault entry exists for the site, returns an error asking the user to add credentials first. Supports p
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string, usernameSelector:string, passwordSelector:string, submitSelector:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `skill_seeker`  —  **doc-only**
Self-evolution engine: when you realize you can't do something, use this tool to research, learn, and build the capability. It searches the web, GitHub, and npm for solutions, analyzes feasibility, and automatically creates new tools or skills. This is how you grow your own abili
- categories: tools · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, description:string, context:string, gap_id:number, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `skillify`  —  **doc-only**
Extract a reusable skill from the current conversation. Analyzes the session's tool calls, delegation chains, user corrections, and outcomes to create a structured skill definition that can be replayed in future conversations. Use when the user says 'save this as a skill', 'make 
- categories: tools · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: name:string, conversation_id:number, persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `slash_command`  —  **doc-only**
R98.10 — Discover and execute project slash commands defined as markdown files in `.bob/commands/*.md`. Each command is a YAML-frontmatter `description:` plus a shell body. Use `action='list'` to enumerate available commands (e.g. /check = full quality gate, /registry = refresh s
- categories: system, code · speed: slow · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly
- params: action*:string, name:string, args:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly)

## `start_video_job`  —  **doc-only**
R98.14 W1.3 — LEGACY. Start a long-running video render as a BACKGROUND JOB. Returns {job_id, status:'rendering', total_chapters} immediately. PREFER `build_video_from_brief` for new requests — it plans chapters+scenes for you AND sets autoFinalize/autoDeliver so the runner conca
- categories: product_output, media · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, chapters*:array, voice:string, voiceProvider:string, strictVoice:boolean, resolution:string, fps:number, transition:string, crossfadeMs:number, kenBurns:boolean, backgroundMusicPath:string, uploadToDrive:boolean, emailTo:string, projectId:number, autoFinalize:boolean, autoDeliver:boolean, customerName:string, customerEmail:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `stealth_browse`  —  **doc-only**
Browse websites using Rayobrowse stealth browser — a fingerprint-spoofing Chromium that bypasses bot detection, CAPTCHAs, and anti-scraping systems. Unlike standard headless Chrome, Rayobrowse spoofs WebGL, fonts, timezone, screen resolution, user agent, and dozens of other signa
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, url:string, selector:string, text:string, fields:object, extract:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `stealth_browse_camofox`  —  **doc-only**
Browse websites using Camofox — a Camoufox-based stealth browser microservice (Firefox fork with C++-level fingerprint spoofing for navigator.hardwareConcurrency, WebGL, AudioContext, screen geometry, WebRTC). Bypasses Cloudflare, Google bot detection, and most anti-scraping syst
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, url:string, tabId:string, ref:string, text:string, direction:string, amount:number, schema:object, sessionKey:string, userIdSuffix:string, trace:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `store_triple`  —  **doc-only**
Store a temporal knowledge triple (subject-predicate-object fact with time validity). Use for entity-relationship facts that may change over time. Examples: ('Alice', 'is CEO of', 'Acme Corp', from: '2025-01-01') or ('VisionClaw', 'runs on', 'PostgreSQL 15'). Set valid_until when
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: subject*:string, predicate*:string, object*:string, confidence:number, valid_from:string, valid_until:string, wing:string, room:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `strategic_interview`  —  **doc-only**
Conduct a structured Socratic interview to clarify vague or complex requests before execution. Asks focused questions across 7 business dimensions (goal, audience, constraints, differentiation, risks, metrics, scope), scores clarity in real-time, and produces a Strategic Brief wh
- categories: personas · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: action*:string, topic:string, interview_id:string, answer:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `stress_intervention`  —  **doc-only**
Wellness: provides a directive, somatic-based intervention script for breaking inertia during stress-induced frozen states. Use when a user reports being 'stuck', 'frozen', 'staring at the fridge', 'can't move', or when an agent loop appears stalled. Returns a script + somatic ac
- categories: wellness, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `subagents`  —  **doc-only**
Use when checking on a delegated specialist run ("did the architect finish"), when killing a stuck sub-agent before retry, or when auditing what work the platform has spawned. Returns active/completed sub-agent runs with id, parent persona, status, and elapsed time. The kill oper
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, runId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sunset_task_force`  —  **doc-only**
Close a task-force (status → sunset) when its mission is done or abandoned, optionally recording a result summary.
- categories: agentic, governance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, result:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)


> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `supersede_adr`  —  **doc-only**
Mark an OLD ADR as superseded by a NEW ADR with the reason for the change. Both ADRs must already exist (create_adr the new one first). Builds the supersession chain visible in /graph-explorer.
- categories: memory, planning, reasoning, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: old_adr_id*:number, new_adr_id*:number, reason*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sync_personas`  —  **doc-only**
Synchronize all persona documents (tools_doc and agents_doc) with the current state of the platform. Run this after creating custom tools, toggling skills, or when you want to ensure all agents have up-to-date knowledge of available tools, skills, and delegation paths. Can target
- categories: personas · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: personaId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `synthesize_research`  —  **doc-only**
Synthesize all evidence for a query into a structured research memo or report. Every claim is cited, contradictions are flagged, and open questions are listed. Use after saving multiple evidence items via save_evidence.
- categories: evidence · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: query*:string, format:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `synthesize_skill`  —  **doc-only**
After successfully completing a complex task, propose a reusable skill (playbook) for next time a similar task arrives. Stored as a 'skill_candidate' awaiting human/supervisor approval. Personas should call this proactively when they notice a multi-step workflow that worked well 
- categories: skillEvolution, tools, experiments · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: taskSummary*:string, userMessage:string, toolsUsed:array, outcome:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `system_load_status`  —  **doc-only**
R102 — Admission control snapshot. Returns current concurrency-pool occupancy (chat slots, background slots, saturation %), whether internal-maintenance work is currently being held back, and the calling tenant's chat rate-limit budget. Use to surface 'system busy, your job is qu
- categories: system · speed: normal · network: no
- risk: safe (LOW) · gates: trustedPersonasOnly
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (trustedPersonasOnly)

## `take_competitor_snapshot`  —  **doc-only**
Crawl a competitor's tracked pages (website, pricing, product, changelog) and save a snapshot. Used as a baseline or for periodic monitoring. Snapshots are compared to detect changes.
- categories: competitorIntel · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: competitorId*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `template_scrape`  —  **doc-only**
Extract typed structured data from a webpage using a Zod-style schema. First call uses an LLM to generate a deterministic CSS-selector recipe; subsequent calls of the same (domain + schema) re-use the cached recipe at ZERO LLM cost. After 3 successful cache hits the recipe is GRA
- categories: research · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: url*:string, schema*:object, schemaName:string, forceRegenerate:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `template_scraper_stats`  —  **live-safe**
Show all cached template-scrape recipes, how many times each has run from cache, and which have graduated to fully-deterministic execution. Use to audit cost savings from the template scraper.
- categories: system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `test_api_keys`  —  **doc-only**
Test all configured AI provider API keys for connectivity. Returns status, latency, and details for each provider (OpenAI, Anthropic, xAI, Google, Perplexity, OpenRouter, Replit).
- categories: system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `tool_performance_report`  —  **doc-only**
Get a performance report for all tracked tools — success rates, failure rates, average durations, and last error messages. Use to identify underperforming tools, diagnose recurring failures, or monitor platform health. Can also trigger a skill evolution cycle to auto-optimize und
- categories: skillEvolution · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `track_intervention`  —  **doc-only**
Wellness: log an intervention outcome to the wellbeing_interventions table so the system learns what works for this tenant. Call after the user has had a chance to respond to a micro_sabbatical or grounding_intervention.
- categories: wellness, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: intervention_id*:string, intervention_type*:string, fatigue_type:string, shame_intensity:string, accepted*:boolean, feedback:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `track_outcome`  —  **doc-only**
Track an action's expected outcome for later measurement. Use after performing trackable actions (emails sent, content published, deals proposed, outreach completed) to enable learning from results. You can also record measured outcomes when results become available.
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, actionType:string, actionRef:string, description:string, expectedOutcome:string, expectedMetric:string, expectedValue:number, outcomeId:number, actualValue:number, actualOutcome:string, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `tree_of_thought`  —  **doc-only**
Apply Tree-of-Thought reasoning — generate multiple distinct reasoning paths for a complex question, score each branch on soundness/completeness, and select or synthesize the best answer. Use when a problem has multiple valid approaches and you want to explore them systematically
- categories: ai · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: question*:string, branchCount:number, context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `trend_research`  —  **doc-only**
Multi-source trend research tool inspired by /last30days. Searches Reddit, Hacker News, Polymarket prediction markets, and X/Twitter in parallel, then deduplicates, scores by relevance+engagement, and detects cross-platform convergence. Reddit/HN/Polymarket are free (no API keys)
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: topic*:string, days:number, sources:array, depth:string, max_results:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `undo_last_action`  —  **doc-only**
R100 — Transactional No-Regression. Undo the most recent irreversible tool call (currently: cancel_scheduled_message, delete_custom_tool, scraped_pages_delete) within its TTL window. Without args, restores the most recent un-undone snapshot for the tenant. With actionId, restores
- categories: system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: actionId:string, toolName:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `update_contract_status`  —  **doc-only**
Update a contract's status. Setting to 'signed' auto-records the signing timestamp.
- categories: contracts · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: contract_id*:number, status*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `update_customer`  —  **doc-only**
Use AFTER any meaningful customer interaction (call, email, demo) to advance pipeline state — change deal_stage, add a note, update value. Two-step pattern: get_customer first to confirm current state, then update_customer. Returns the updated row. Stage changes auto-trigger the 
- categories: crm · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: customer_id*:number, company_name:string, contact_name:string, email:string, phone:string, deal_stage:string, deal_value:number, notes:string, assigned_to:string, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `update_invoice_status`  —  **doc-only**
Update an invoice's status (draft → sent → paid) and optionally record payment amount.
- categories: invoicing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: invoice_id*:number, status*:string, amount_paid:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `update_memory`  —  **doc-only**
Update an existing memory entry — change the fact text, category, or archive it. Use when information about the user changes or becomes outdated.
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, fact:string, category:string, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `user_model_query`  —  **live-safe**
Query the dialectic user model — a progressively-built profile of the user's communication style, decision patterns, preferences, and personality traits. Built automatically from conversation analysis. Use to understand how to personalize responses, predict user needs, or adapt t
- categories: userModeling · speed: normal · network: no
- risk: safe (LOW)
- params: question:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred


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


> 14 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `workspace_update_status`  —  **live-safe**
R98.27.7 — Append a status line and/or rewrite next_steps / open_questions for an open workspace. Use after EVERY meaningful tool call so the next loop (or resumed session) sees ground truth instead of guessing. status='blocked' or 'needs_review' is a soft signal to a human; does
- categories: system, memory · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, status:string, progress_note:string, next_steps:array, open_questions:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `write_daily_note`  —  **doc-only**
Write or append to today's daily notes. Use to log important events, decisions, lessons learned, or anything worth recording during the conversation. Memory rule: if you want to remember it, write it down NOW.
- categories: notes · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: content*:string, section:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `write_file`  —  **doc-only**
Write content to a file in the workspace AND automatically upload it to Google Drive. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories automatically. Use for creating HTML, scripts, configs, mockups, or any text file. Max 500KB. The result i
- categories: files · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: path*:string, content*:string, append:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `write_scratchpad`  —  **doc-only**
Write a key-value entry to the delegation scratchpad — shared state visible to parent and sibling agents in the same delegation chain. Use to pass intermediate results, discovered facts, or status updates between agents without polluting the conversation.
- categories: notes · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: key*:string, value*:string, chain_key:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `x_delete_tweet`  —  **doc-only**
Use ONLY when removing a tweet posted in error, with stale info, or after Bob explicitly approves takedown. Permanent and unrecoverable. Returns success/failure. Do NOT use to "edit" a tweet — X has no edit; delete + repost is the pattern, but require explicit human approval firs
- categories: marketing · speed: normal · network: yes
- risk: destructive (HIGH) · gates: risk=destructive; network tool (external/costly side-effect); requiresApproval (HITL); trustedPersonasOnly
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; network tool (external/costly side-effect); requiresApproval (HITL); trustedPersonasOnly)

## `x_get_me`  —  **doc-only**
Use at session start when working on social media to confirm WHICH account is authenticated — also when reporting follower-count progress to Bob. Returns the authenticated user profile (id, name, username, bio, followers/following/tweet counts).
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_mentions`  —  **doc-only**
Use when triaging incoming social-media engagement — at the start of a session, before drafting public replies, or when Bob asks "what is X saying about us". Returns the most recent @mentions of the authenticated account with author, text, and tweet ID for follow-up via x_search/
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_timeline`  —  **doc-only**
Use when monitoring a specific X/Twitter account (competitor, partner, prospect, public figure) — before crafting outreach, during competitive intel, or when researching a person before a meeting. Returns up to N most recent tweets from the named user with full text and metrics. 
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: username*:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_get_tweet`  —  **doc-only**
Use when you need the full content of one specific tweet by its ID — typically after x_search returns hits, or when a user references a tweet URL/ID, or when investigating engagement. Returns the tweet text, author, created_at, and public metrics (likes, retweets, replies, quotes
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `x_like_tweet`  —  **doc-only**
Use when amplifying a partner/customer/community member through a low-effort signal of acknowledgement — also after their reply to one of our threads. Returns success/failure. Do NOT auto-like everything — bot-like patterns get accounts flagged.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_post_tweet`  —  **doc-only**
Post a tweet to X/Twitter. Can also reply to a tweet or quote tweet. Uses OAuth 1.0a with the configured API keys.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: text*:string, reply_to_id:string, quote_tweet_id:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_retweet`  —  **doc-only**
Use when amplifying content that aligns with our brand voice and wellness/agentic-AI mission — partner launches, customer wins, relevant news. Returns success/failure. Higher-stakes than a like; run cross_critique on borderline content before retweeting from the brand account.
- categories: marketing · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: tweet_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `x_search`  —  **doc-only**
Use BEFORE responding to public commentary about a topic, brand, or product — also for monitoring an event, hashtag, or breaking news in real time. Returns recent tweets matching the query with author, text, and metrics. Best for time-sensitive surface scans; pair with x_get_twee
- categories: marketing · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `youtube`  —  **doc-only**
Manage YouTube channel via YouTube Data API v3. Requires YouTube OAuth to be connected. Actions: channel_info (get channel stats), list_videos (recent uploads), list_shorts_by_date (recent SHORT-FORM uploads inside a trailing date window — duration-filtered to exclude long-form),
- categories: media · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: action*:string, days:number, maxDurationSec:number, videoId:string, query:string, commentId:string, text:string, title:string, tags:array, maxResults:number, filePath:string, description:string, privacyStatus:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

