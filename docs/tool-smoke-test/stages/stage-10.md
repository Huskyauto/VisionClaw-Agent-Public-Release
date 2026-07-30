# Tool Smoke-Test — Stage 10 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 10`
