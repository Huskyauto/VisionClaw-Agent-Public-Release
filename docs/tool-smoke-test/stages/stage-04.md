# Tool Smoke-Test — Stage 4 of 21

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `create_invoice`  —  **doc-only**
Create a business invoice with line items, auto-calculate totals, and track in the accounting system. Use for billing clients. Returns invoice ID and total. The invoice is stored in the database for tracking, aging reports, and P&L.
- categories: invoicing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: customer_name*:string, customer_email:string, customer_id:number, invoice_number:string, issue_date:string, due_date:string, tax_rate:number, payment_terms:string, notes:string, items*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_knowledge`  —  **doc-only**
Add a new entry to the permanent knowledge base. Use for storing reference material, guides, or important documentation.
- categories: knowledge · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, content*:string, category*:string, priority:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_memory`  —  **doc-only**
Store a new fact in the Memory Palace. Automatically checks for duplicates and resolves contradictions. Use for important preferences, personal details, or things the user asks you to remember. Assign a wing (project/domain) and room (topic) for hierarchical organization. R98.19:
- categories: memory · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: fact*:string, category*:string, wing:string, room:string, confidence:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_mind`  —  **doc-only**
Create or manage a Mind — an autonomous multi-agent system inspired by Imbue's Minds framework. A Mind has 4 roles: talking (user-facing), thinking (orchestration brain), working (execution), verifying (quality judge). Minds use tickets to track work, events for communication, an
- categories: crews · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: command*:string, name:string, purpose:string, soul:string, mindId:number, maxConcurrentWorkers:number, talkingPersonaId:number, thinkingPersonaId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_payment_link`  —  **doc-only**
Mint a shareable Stripe Payment Link for a SKU already registered via product_listing_create. Owner-only, trusted personas only. Creates the Stripe product + price (idempotent: reuses previously saved Stripe refs) and a payment link whose metadata carries ONLY the bundle_sku — th
- categories: business · speed: normal · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); trustedPersonasOnly
- params: sku*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); trustedPersonasOnly)

## `create_pdf`  —  **doc-only**
Low-level PDF tool for fillable forms and simple documents ONLY. For reports, analyses, deliverables, or any professional document, use create_styled_pdf instead — it produces premium executive-quality output with branded cover pages, stats grids, data tables, highlight boxes, an
- categories: pdf, presentations · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title:string, content:string, sections:array, fields:array, headerImage:object, fontSize:number, pageSize:string, outputPath:string, customerName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_plan`  —  **doc-only**
Minerva's planner: compose a structured multi-step plan for an objective. Each plan step names an agent, tools, dependencies, cost estimate, and time estimate. Plans are persisted with status=awaiting_approval, a roster snapshot, and emit the plan.proposed event — waking Felix fo
- categories: planning, minerva · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: objective*:string, source:string, sourceRef:string, parentPlanId:number, revisionFeedback:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_sequence`  —  **doc-only**
Create a multi-step outreach email sequence. Define each step's subject, body template, and wait time. Templates support {{name}}, {{company}}, {{email}} placeholders. Steps are personalized with AI when personal context is provided.
- categories: outreachSequencing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, description:string, steps*:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_slides`  —  **doc-only**
Create a professional Google Slides presentation with rich visual layouts, diagrams, charts, tables, and themes. Builds real, editable Google Slides with native shapes and elements. Use for presentations, pitch decks, keynotes, meetup talks.

Available layouts per slide:
- TITLE 
- categories: presentations · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: topic*:string, slideCount:number, slides:array, theme:string, logoUrl:string, filename:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `create_slideshow_video`  —  **doc-only**
Create a cinematic video from slide images + audio using FFmpeg. Supports per-slide audio sync, Ken Burns motion effects (zoom/pan on stills for cinematic feel), 30+ transition types (fade, wipe, slide, dissolve, zoom, etc.), background music mixing under narration, and PDF-to-sl
- categories: media · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: pdf_path:string, slides:array, audio_path:string, background_music_path:string, music_volume:number, output_filename:string, project_id:number, title:string, duration_per_slide:number, crossfade_ms:number, transition_type:string, ken_burns:boolean, ken_burns_intensity:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `create_spreadsheet`  —  **doc-only**
Create a professional Excel spreadsheet (.xlsx) with formatted headers, alternating row colors, auto-filters, frozen header row, and Excel formulas. Supports multiple sheets. Automatically uploads to Google Drive. Use for financial models, data analysis, budgets, project trackers
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, author:string, sheets*:array, fileName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_styled_report`  —  **doc-only**
Create a PREMIUM styled PDF report with professional cover page, branded colors, stats grid, data tables, highlight boxes, two-column layouts, and auto-uploaded to Google Drive. This is the TOP-TIER PDF system — use it for ALL reports, analyses, deliverables, and professional doc
- categories: docs · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, subtitle:string, companyLines:array, coverStats:array, sections*:array, footerLines:array, orientation:string, fileName:string, folderLabel:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_task_force`  —  **doc-only**
Spin up a scoped task-force: a bounded sub-team of personas with its own mission, budget, and optional deadline. Charges/usage are tracked against the task-force budget. Use to ring-fence a focused initiative without polluting the main tenant's accounting.
- categories: agentic, governance · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, mission*:string, personaIds:array, budgetUsd:number, deadline:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_tension`  —  **doc-only**
Record a TENSION — a structured 'predicted ≠ actual' conflict so the next persona can pick up where you stopped instead of relearning the wall. Use whenever a result contradicts your assumption: a bug that violates your model, a customer answer that breaks an ICP, a metric that w
- categories: memory, reasoning, experiments, system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: title*:string, predicted_state*:object, actual_state*:object, evidence:array, owner_persona_id:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `create_tool`  —  **doc-only**
Create a new custom tool that the AI agent can use in future conversations. Describe what the tool should do and the system will generate a safe, sandboxed implementation. Created tools persist across conversations. Use when a recurring task would benefit from a dedicated tool ra
- categories: tools · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly
- params: description*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly)

## `critique_response`  —  **doc-only**
Request a quality critique of content before sending it. A specialized Critique Agent evaluates accuracy, completeness, relevance, and clarity on a 1-10 scale and provides improvement suggestions. Use this for important deliverables — reports, analyses, recommendations — before p
- categories: ai · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: content*:string, context*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `cross_critique`  —  **doc-only**
Three-AI adversarial review panel (Donahoe Trident). Fires Claude/OpenAI/Gemini in parallel against the same target with different lenses (ux/technical/strategic), ranks counter-arguments by 'rebuttal survival score', and surfaces consensus findings (flagged by 2+ panelists). Use
- categories: reasoning, experiments, ai · speed: very_slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: target*:string, context:string, panelists:array
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `crossref_lookup`  —  **doc-only**
R125+4 — Query Crossref, the authoritative DOI registry (~150M works). Dual-mode: (a) if the query LOOKS like a DOI ('10.x/y' pattern), does a direct DOI lookup; (b) otherwise runs a search query. FREE public JSON API, polite mailto pool. Returns normalized ScholarResult[] with H
- categories: research, web · speed: slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: query*:string, max_results:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `customer_pipeline`  —  **doc-only**
View the sales pipeline — shows deal counts and values at each stage (prospect → lead → qualified → proposal → negotiation → closed). Includes win rate and lifetime revenue.
- categories: crm · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: (none)
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `debate`  —  **doc-only**
Initiate a Chain of Debates — convene 3-4 relevant specialist personas to deliberate on a complex question from their unique perspectives (financial, legal, technical, strategic, etc.). Each persona argues their position, then a synthesis produces a final recommendation with cons
- categories: ai · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: question*:string, participantCount:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 4`
