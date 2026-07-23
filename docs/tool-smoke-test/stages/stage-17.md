# Tool Smoke-Test — Stage 17 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `sessions_list`  —  **live-safe**
List active agent sessions (conversations) across the VisionClaw platform. Use to discover other agents/personas and their active sessions before sending inter-agent messages. Returns session keys, persona info, models, and activity timestamps.
- categories: sessions · speed: normal · network: no
- risk: safe (LOW)
- params: kinds:array, limit:number, activeMinutes:number, messageLimit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `sessions_send`  —  **doc-only**
Send a message to another agent session. The target session's persona will process the message and generate a reply. Use for inter-agent coordination, delegation, and cross-persona collaboration. Reply with REPLY_SKIP to end any ping-pong follow-up.
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sessionKey*:string, message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sessions_spawn`  —  **doc-only**
Spawn a background sub-agent run to perform a task asynchronously. The sub-agent runs in its own session and announces results back when finished. Use for parallelizing research, long tasks, or slow tool work without blocking the main conversation. Each sub-agent gets its own con
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: task*:string, label:string, agentId:number, model:string, thinkingLevel:string, runTimeoutSeconds:number, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `set_department_budget`  —  **doc-only**
Set a spend cap for a department (executive, engineering, marketing, sales, finance, operations, research, creative, support). When spend approaches the cap the heartbeat emits budget.warning; over the cap it emits budget.exceeded and the budget guard throttles that department's 
- categories: agentic, governance, finance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; trustedPersonasOnly
- params: department*:string, limitUsd*:number, period:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; trustedPersonasOnly)

## `set_my_profile_photo`  —  **doc-only**
R98.6 — Register the user's own face photo at the platform level so produce_video can auto-attach it to first-person slides ('I lost 236 lbs', 'my journey'). One-time setup: the user uploads a photo, you call this with the path, and from then on every produce_video call auto-inje
- categories: system, media · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, photo_path:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `set_policy`  —  **doc-only**
R76 — Trust-tier policy engine. Create or update a per-tenant tool policy that pre-approves or blocks specific tool calls so they bypass HITL. Owner-only. Use 'list' to see active policies, 'create' to add one, 'delete' to remove. Examples: allow send_email to your own address, a
- categories: system · speed: normal · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: action*:string, scope_kind:string, scope_value:string, policy_action:string, max_amount_cents:number, reason:string, policy_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `show_diff`  —  **live-safe**
Generate a diff between two texts, or format a unified patch. Shows additions, deletions, and change statistics. Use when comparing versions of text, code, configs, or any content.
- categories: diff · speed: normal · network: no
- risk: safe (LOW)
- params: before:string, after:string, patch:string, path:string, context:number, mode:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `simulate_plan`  —  **doc-only**
IMAGINATION-SPACE PLAN ROLLOUT (R74.13z-quint Nugget 3, LeWorldModel-inspired). BEFORE committing to a multi-step plan that costs real money / time / side-effects, call this to score the plan against historical step traces in milliseconds. For each proposed step, the simulator fi
- categories: planning, felix, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: steps*:array, plan_summary:string, persist:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `site_login`  —  **doc-only**
Log into a website using credentials stored in the Credential Vault. Navigates to the site, finds the login form, auto-fills username/password from the vault, and submits. If no vault entry exists for the site, returns an error asking the user to add credentials first. Supports p
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: url*:string, usernameSelector:string, passwordSelector:string, submitSelector:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `skill_seeker`  —  **doc-only**
Self-evolution engine: when you realize you can't do something, use this tool to research, learn, and build the capability. It searches the web, GitHub, and npm for solutions, analyzes feasibility, and automatically creates new tools or skills. This is how you grow your own abili
- categories: tools · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: action*:string, description:string, context:string, gap_id:number, status:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `skillify`  —  **doc-only**
Extract a reusable skill from the current conversation. Analyzes the session's tool calls, delegation chains, user corrections, and outcomes to create a structured skill definition that can be replayed in future conversations. Use when the user says 'save this as a skill', 'make 
- categories: tools · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: name:string, conversation_id:number, persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `slash_command`  —  **doc-only**
R98.10 — Discover and execute project slash commands defined as markdown files in `.bob/commands/*.md`. Each command is a YAML-frontmatter `description:` plus a shell body. Use `action='list'` to enumerate available commands (e.g. /check = full quality gate, /registry = refresh s
- categories: system, code · speed: slow · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly
- params: action*:string, name:string, args:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly)

## `start_video_job`  —  **doc-only**
R98.14 W1.3 — LEGACY. Start a long-running video render as a BACKGROUND JOB. Returns {job_id, status:'rendering', total_chapters} immediately. PREFER `build_video_from_brief` for new requests — it plans chapters+scenes for you AND sets autoFinalize/autoDeliver so the runner conca
- categories: product_output, media · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, chapters*:array, voice:string, voiceProvider:string, strictVoice:boolean, resolution:string, fps:number, transition:string, crossfadeMs:number, kenBurns:boolean, backgroundMusicPath:string, uploadToDrive:boolean, emailTo:string, projectId:number, autoFinalize:boolean, autoDeliver:boolean, customerName:string, customerEmail:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `stealth_browse`  —  **doc-only**
Browse websites using Rayobrowse stealth browser — a fingerprint-spoofing Chromium that bypasses bot detection, CAPTCHAs, and anti-scraping systems. Unlike standard headless Chrome, Rayobrowse spoofs WebGL, fonts, timezone, screen resolution, user agent, and dozens of other signa
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, url:string, selector:string, text:string, fields:object, extract:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `stealth_browse_camofox`  —  **doc-only**
Browse websites using Camofox — a Camoufox-based stealth browser microservice (Firefox fork with C++-level fingerprint spoofing for navigator.hardwareConcurrency, WebGL, AudioContext, screen geometry, WebRTC). Bypasses Cloudflare, Google bot detection, and most anti-scraping syst
- categories: web · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: action*:string, url:string, tabId:string, ref:string, text:string, direction:string, amount:number, schema:object, sessionKey:string, userIdSuffix:string, trace:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `store_triple`  —  **doc-only**
Store a temporal knowledge triple (subject-predicate-object fact with time validity). Use for entity-relationship facts that may change over time. Examples: ('Alice', 'is CEO of', 'Acme Corp', from: '2025-01-01') or ('VisionClaw', 'runs on', 'PostgreSQL 15'). Set valid_until when
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: subject*:string, predicate*:string, object*:string, confidence:number, valid_from:string, valid_until:string, wing:string, room:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `strategic_interview`  —  **doc-only**
Conduct a structured Socratic interview to clarify vague or complex requests before execution. Asks focused questions across 7 business dimensions (goal, audience, constraints, differentiation, risks, metrics, scope), scores clarity in real-time, and produces a Strategic Brief wh
- categories: personas · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: action*:string, topic:string, interview_id:string, answer:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `stress_intervention`  —  **doc-only**
Wellness: provides a directive, somatic-based intervention script for breaking inertia during stress-induced frozen states. Use when a user reports being 'stuck', 'frozen', 'staring at the fridge', 'can't move', or when an agent loop appears stalled. Returns a script + somatic ac
- categories: wellness, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: context:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `subagents`  —  **doc-only**
Use when checking on a delegated specialist run ("did the architect finish"), when killing a stuck sub-agent before retry, or when auditing what work the platform has spawned. Returns active/completed sub-agent runs with id, parent persona, status, and elapsed time. The kill oper
- categories: sessions · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, runId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `sunset_task_force`  —  **doc-only**
Close a task-force (status → sunset) when its mission is done or abandoned, optionally recording a result summary.
- categories: agentic, governance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, result:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 17`
