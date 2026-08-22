# Tool Smoke-Test — Stage 8 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 8`
