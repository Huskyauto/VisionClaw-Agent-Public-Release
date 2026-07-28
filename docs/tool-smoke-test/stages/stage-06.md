# Tool Smoke-Test — Stage 6 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `expense_report`  —  **doc-only**
Generate an expense report broken down by category with totals, averages, and deductible amounts. Perfect for tax prep or monthly reviews.
- categories: expenses · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: start_date:string, end_date:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `expire_triple`  —  **doc-only**
Mark a knowledge triple as expired by setting its valid_until date. Use when a fact is no longer true (e.g. someone changed roles, a tool was replaced).
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, valid_until:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `export_persona`  —  **doc-only**
Export any VisionClaw persona as a portable agent definition file. Produces a comprehensive package with the persona's identity (SOUL), trust profile, skills, tools, governance rules, express lanes, and knowledge domains. Output in JSON or markdown format. Use when the user wants
- categories: personas · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: persona_id*:number, format:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `felix_loop_run_now`  —  **doc-only**
Manually trigger a Felix Loop run right now (bypasses the 4-hour interval and wake-hours gate). Useful for testing the loop end-to-end or for forcing a fresh read after a major event. Still respects kill switch and monthly cost cap. Bob-only operation.
- categories: agentic, felix, governance · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `felix_loop_status`  —  **live-safe**
Get the current status of Felix's autonomous loop (R74.13w). Returns: current mode (dry_run vs live), live_after date, kill switch state, wake hours, monthly cap and current month spend, count of pending proposals awaiting Bob's review, and details of the last loop run. Use to an
- categories: agentic, felix, governance, system · speed: normal · network: no
- risk: safe (LOW)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `fetch_crypto_price`  —  **doc-only**
R125+35 — Live cryptocurrency prices. FREE, no key (CoinGecko). Pass CoinGecko COIN IDs (lowercase slugs like 'bitcoin','ethereum','solana' — NOT ticker symbols like 'BTC'), comma-separated for multiple. Returns price + 24h % change in the chosen fiat. Use for crypto price / mark
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: ids*:string, vs_currency:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_exchange_rate`  —  **doc-only**
R125+35 — Live fiat currency exchange rates. FREE, no key (open.er-api.com). Give a 3-letter base ISO code (default USD); optionally a target code to get a single pair rate, else returns all rates for the base. Use for currency conversion / FX questions.
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: base:string, target:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_hacker_news`  —  **doc-only**
R125+35 — Hacker News stories. FREE, no key (HN Algolia API). With no query returns the current front page; with a query returns matching stories. Each: title, url, points, author, comment count, HN discussion link. Use for tech-news pulse, trending topics, or 'what's on Hacker N
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query:string, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_weather`  —  **doc-only**
R125+35 — Current weather for any city/place name. FREE, no key (open-meteo.com): geocodes the name then returns current temperature, apparent temp, humidity, precipitation, wind, weather code + units. Use when the user asks about weather, temperature, or conditions in a place. P
- categories: research, web · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: city*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `fetch_wikipedia`  —  **doc-only**
R125+35 — Plain-language Wikipedia summary (intro extract + description + canonical URL) for a topic/person/place. FREE, no key (en.wikipedia.org REST). Use for quick encyclopedic facts and definitions. Extract text is fenced (untrusted external content). For deep/multi-source re
- categories: research, web, knowledge · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: title*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `figma`  —  **doc-only**
Read or comment on Figma designs via Figma's REST API. Actions: get_design_context (summary + screenshot of a node), get_file (file metadata), get_nodes (specific nodes), render_images (export PNG/SVG), get_components, get_styles, get_comments, post_comment, get_me, get_team_proj
- categories: design, research · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: action*:string, fileKey:string, nodeId:string, nodeIds:array, url:string, format:string, scale:number, message:string, teamId:string, projectId:string, depth:number, renderImage:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `fill_pdf`  —  **doc-only**
Fill in form fields of an existing fillable PDF. Set values for text fields, check/uncheck checkboxes, and select dropdown options. Optionally flatten the form (make it non-editable). Use for completing forms, applications, or any fillable PDF.
- categories: pdf · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: inputPath*:string, fields*:object, outputPath:string, flatten:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `finalize_video`  —  **doc-only**
R98.14 W1.4 — Concatenate completed chapters into the final MP4 (and upload to Drive if enabled). IDEMPOTENT + RESUMABLE: if concat fails, the chapter MP4s stay on disk; calling finalize_video again retries JUST the concat step (no re-render). If already done, returns the cached 
- categories: product_output, media · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: job_id*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `finance_market_overview`  —  **doc-only**
Get a snapshot of major market indices with current values and daily change percentages. Covers Chinese A-share market indices. Use for quick market pulse checks, daily briefings, or as context for financial analysis.
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_news`  —  **doc-only**
Fetch real-time financial and trending news from multiple global sources. Returns ranked headlines with links. Sources include Cailian Press, WallStreetCN, Xueqiu (Snowball), Hacker News, Weibo, Baidu, and more. Use for market research, trend monitoring, competitive intelligence,
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: sources:array, count:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_stock_price`  —  **doc-only**
Get historical stock price data (OHLCV) for A-Share and Hong Kong stocks. Returns daily open/high/low/close/volume with change percentages and a summary. Use for stock analysis, price tracking, trend identification, or financial reporting.
- categories: finance · speed: normal · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect)
- params: ticker*:string, days:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect))

## `finance_stock_search`  —  **doc-only**
Search for stock tickers by company name or code. Supports A-Share (Shanghai/Shenzhen) and Hong Kong markets. Returns matching ticker codes and company names. Use when you need to find the ticker code for a company before looking up its price.
- categories: finance · speed: normal · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect)
- params: query*:string, market:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect))

## `financial_snapshot`  —  **doc-only**
Unified financial snapshot — one call gives you everything: revenue with period-over-period variance and trend (up/down/stable), collections aging (current/30/60/90+ day buckets), average receivable age, expenses with variance, net income trend, profit margin, burn rate, runway e
- categories: finance, reporting · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: period:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `findings_publish`  —  **live-safe**
R106 N2 / R125+15 — Share data with SIBLING in-flight subtasks (other chunks of the same chunk-and-parallel job). Two modes: (1) DISCOVERY (default, append-only) — broadcast a high-confidence find that saves sibling work (a working format, a confirmed fact, a clean asset, a safe 
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, subtask_id*:string, finding:any, confidence:number, slot_key:string, claim:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `findings_read`  —  **live-safe**
R106 N2 / R125+15 — Read what SIBLING subtasks have shared on a parallel-build job. THREE modes: (1) DISCOVERY (default) — NEW findings posted by siblings (excludes your own), cursor-paged via since_id, minConfidence 0.6 strips noise. (2) SLOT — pass slot_key to get the current l
- categories: system, memory, experiments · speed: normal · network: no
- risk: safe (LOW)
- params: job_id*:string, caller_subtask_id:string, since_id:number, min_confidence:number, limit:number, slot_key:string, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 6`
