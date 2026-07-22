# Tool Smoke-Test — Stage 15 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 15`
