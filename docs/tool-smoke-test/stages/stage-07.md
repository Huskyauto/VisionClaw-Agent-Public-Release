# Tool Smoke-Test — Stage 7 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `findings_read`  —  **live-safe**
R106 N2 / R125+15 — Read what SIBLING subtasks have shared on a parallel-build job. THREE modes: (1) DISCOVERY (default) — NEW findings posted by siblings (excludes your own), cursor-paged via since_id, minConfidence 0.6 strips noise. (2) SLOT — pass slot_key to get the current l
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, caller_subtask_id:string, since_id:number, min_confidence:number, limit:number, slot_key:string, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

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

## `generate_evidence_docket`  —  **doc-only**
Produce a portable, reviewer-facing Evidence Docket for a piece of work: one inspectable HTML + JSON artifact bundling the goal contract(s), completion-verification verdicts, jury concordance (κ), the security audit trail (intent-gate checks + tool-policy blocks), the delivery re
- categories: delivery, validation · speed: very_slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: conversationId:number, orderId:string, runId:string, productName:string, sendEmail:boolean, emailTo:string, includeCustomerPii:boolean, proofLevel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 7`
