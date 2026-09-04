# Tool Smoke-Test — Stage 3 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 3`
