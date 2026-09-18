# Tool Smoke-Test — Stage 15 of 21

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

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

## `revenue_mission_create`  —  **doc-only**
Create a Verified Revenue Mission — a durable 30+ day business experiment (hypothesis → evidence → offer → capped outreach sample → replies → payment) measured ONLY by external evidence (real replies, Stripe payments), never LLM forecasts. Owner-only. Starts at stage 'hypothesis'
- categories: business, planning · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, hypothesis*:string, idealCustomer*:string, offer*:string, priceUsd:number, painStatement:string, successCriteria:string, killCriteria:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `revenue_mission_draft_experiment`  —  **doc-only**
Draft a capped outreach sample for a Revenue Mission: harvests candidate prospects from the owner's own Gmail graph (READ-only), ICP-filters them against the mission, drafts 2 message variants, and persists the packet as status 'awaiting_approval'. SENDS NOTHING — the owner must 
- categories: business, planning · speed: slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly
- params: missionId*:number, name:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive); trustedPersonasOnly)

## `revenue_mission_list`  —  **live-safe**
List all Verified Revenue Missions with stage, evidence counters (contacted / positive replies / payments), revenue vs refunds, and spend vs cap. Owner-only, read-only. Use to review the mission portfolio or before creating a new mission (max discipline: few active unproven missi
- categories: business · speed: fast · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `revenue_mission_status`  —  **live-safe**
Full status of one Revenue Mission: mission record, business-event done checks computed from EVIDENCE rows (validation_complete: ≥10 contacted + ≥3 positive replies; first_dollar_complete: net Stripe revenue > direct cost), recent evidence, and its experiments with approval state
- categories: business · speed: fast · network: no
- risk: safe (LOW)
- params: missionId*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 15`
