# Tool Smoke-Test — Stage 2 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 2`
