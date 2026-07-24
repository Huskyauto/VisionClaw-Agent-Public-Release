# Tool Smoke-Test — Stage 18 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 18`
