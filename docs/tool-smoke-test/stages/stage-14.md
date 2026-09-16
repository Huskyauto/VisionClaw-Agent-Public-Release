# Tool Smoke-Test — Stage 14 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `recall_capabilities`  —  **live-safe**
R125+3.9 — The 'what can I do for THIS prompt' tool. Single semantic-search entrypoint that returns a ranked shortlist of (a) past release-rounds, (b) .agents/ + output/ skill bodies, (c) directly matching registered tools — for the user's current ask. Use at the START of any non
- categories: knowledge, system, reasoning · speed: normal · network: no
- risk: safe (LOW)
- params: query*:string, top_k:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `recall_context`  —  **doc-only**
Recall earlier conversation history that was compacted (summarized) to save context space. Use this when you need to remember details from earlier in a conversation or from OTHER conversations in the same project. Search by keyword to find specific topics. This is your long-term 
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: conversationId:number, query:string, limit:number, projectWide:boolean, level:string, direction:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_failure_patterns`  —  **doc-only**
R98.7 — Pull your past strategic mistakes so you don't repeat them. CALL THIS at the START of any non-trivial task and AGAIN before declaring it done. Returns the most recently-recorded patterns for this persona/tenant, optionally filtered by tags. Pair with the static `data/pers
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tags:array, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_references`  —  **doc-only**
R98.14 — Recall references previously learned via learn_from_reference. Filter by deliverable_type and/or style_tags. Returns up to N matching references with full pattern lists. Use at task start (alongside recall_strategic_wins + recall_failure_patterns) to load relevant taste 
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: deliverable_type:string, style_tags:array, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recall_strategic_wins`  —  **doc-only**
R98.12 W7 — Pull strategic wins recorded by record_strategic_win, tenant + persona scoped. Optional tag filter. CALL THIS at task start (alongside recall_failure_patterns) so you start from your best known patterns instead of cold. Returns parsed structured rows including win, tr
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: tags:array, impact_min:string, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recommend_best_tool`  —  **live-safe**
TOOL SELECTION GATE (R112.18 Layer 2). Returns the top-3 tools most likely to handle a given intent, ranked by embedding similarity against the 341-tool inventory plus per-tenant historical performance. MANDATORY before any plan with 3+ tool-call steps OR any tool call involving 
- categories: planning, system · speed: fast · network: no
- risk: safe (LOW)
- params: intent*:string, excludeTools:array, topK:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `record_ab_event`  —  **doc-only**
Record an impression or conversion for one variant of a running A/B experiment.
- categories: agentic, experiments · speed: fast · network: no
- risk: sensitive (LOW) · gates: risk=sensitive
- params: experimentId*:number, variantLabel*:string, kind*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_bwb_weight`  —  **live-safe**
Built With Bob — log Bob's weigh-in WITHOUT triggering any video build. Persists his weight figures to the same durable store (agent_settings) the weekly recap reads as a SUPPLIED FACT, and stamps the update time. Use this whenever Bob states his weight in conversation (e.g. 'I w
- categories: data · speed: fast · network: no
- risk: safe (LOW)
- params: currentWeight:number, totalLost:number, startWeight:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `record_failure_pattern`  —  **doc-only**
R98.7 — Record a strategic mistake you (or another persona) just made so you don't repeat it next session. Persisted into memory_entries with category='strategic_lesson' and surfaced by recall_failure_patterns at the start of any related task. USE THIS whenever Bob points out a r
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: pattern*:string, trigger*:string, fix*:string, self_check:string, severity*:string, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_kpi`  —  **doc-only**
Record a KPI metric value. Categories: revenue, growth, engagement, operations, financial, marketing, sales, product. Tracks against optional targets.
- categories: kpi · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: metric_name*:string, category*:string, value*:number, target:number, unit:string, period:string, period_start:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `record_strategic_win`  —  **doc-only**
R98.12 W7 — Mirror of record_failure_pattern for SUCCESSES. Persist a strategic WIN (a planning move, tool combination, prompt approach, or workflow that produced an unusually good outcome) so recall_strategic_wins can surface it next session. Use whenever Bob praises a result, O
- categories: memory, self_improvement · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: win*:string, trigger*:string, technique*:string, do_this_again:string, impact*:string, tags:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `recursive_synthesize`  —  **doc-only**
Synthesize an answer across LONG content (research dumps, many documents, long transcripts, scraped pages — anything larger than a single direct LLM call can handle reliably). Implements Algorithm 1 from the Recursive Language Models paper (Zhang/Kraska/Khattab, MIT CSAIL Jan 202
- categories: reasoning, research · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: content*:string, task*:string, rootModel:string, subModel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `register_character_portrait`  —  **live-safe**
R99 — Felix Visual Continuity (ViMax #1). Manually add ONE canonical portrait of a recurring character or environment to the tenant's portrait registry. Identifier+view is the natural key (UPSERT — second call for same key replaces image_path). Views: 'front' | 'three_quarter' | 
- categories: media, system · speed: normal · network: no
- risk: safe (LOW)
- params: identifier*:string, view*:string, image_path*:string, description:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `reject_felix_proposal`  —  **doc-only**
Use when Bob explicitly rejects a Felix proposal AND can articulate why (the reason teaches Felix). Bob-only operation. Returns success. The reason is stored in the proposal row and feeds Felix's lesson loop — vague reasons ("no") teach nothing; specific reasons ("wrong tenant" /
- categories: agentic, felix, governance · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: id*:number, reason*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

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

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 14`
