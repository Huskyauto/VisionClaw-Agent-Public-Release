# Tool Smoke-Test — Stage 1 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 1`
