# Tool Smoke-Test — Stage 11 of 20

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 11`
