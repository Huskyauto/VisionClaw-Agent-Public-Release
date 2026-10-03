# Tool Smoke-Test — Stage 5 of 20

> 20 tools. Status: ⬜ pending. Generated from `manifest.json` (registry SoT).
> **live-safe** ⇒ may be invoked with minimal args; **doc-only** ⇒ document + confirm wiring, NEVER auto-invoke (destructive/sensitive/network/slow/gated).
> Each tool below carries an auto-computed wiring verdict (registry + policy + static doc). `[x]` = wired & documented; `[ ]` = needs attention (e.g. missing static doc). Replace the verdict with a live-invoke result when you opt to exercise a `live-safe` tool.

## `define_icp`  —  **doc-only**
Define an Ideal Customer Profile (ICP) with scoring criteria. Used by score_leads to automatically qualify leads. Describe your target customer characteristics and scoring weights.
- categories: leadEnrichment · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: name*:string, icpDescription*:string, criteria*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `delegate_task`  —  **doc-only**
Delegate a task to another agent (persona). One-shot tasks (schedule='once') execute INLINE — the specialist runs immediately and returns their result in this conversation. Recurring tasks (cron schedule) are queued for approval. Use this to dispatch work to specialists like Nept
- categories: ai · speed: very_slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=very_slow (likely LLM/expensive)
- params: targetAgent*:string, taskName*:string, description:string, prompt*:string, schedule:string, gate_command:string, gate_timeout_ms:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=very_slow (likely LLM/expensive))

## `delete_custom_tool`  —  **doc-only**
Use ONLY after explicit Bob approval to permanently remove a registered custom tool by name (typically because the tool turned out to be wrong, redundant, or unused). Returns success/failure. Cannot be undone — to temporarily disable, prefer toggling is_active via the custom-tool
- categories: tools · speed: normal · network: no
- risk: destructive (HIGH) · gates: risk=destructive; requiresApproval (HITL); trustedPersonasOnly; irreversible (snapshot-guarded)
- params: name*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; requiresApproval (HITL); trustedPersonasOnly; irreversible (snapshot-guarded))

## `deliver_product`  —  **doc-only**
Full automated digital product delivery pipeline. Creates a dated subfolder in Google Drive, uploads the file, makes it publicly shareable, sends a branded delivery email to the customer, and logs the entire transaction. Use this for any order fulfillment or digital product deliv
- categories: delivery · speed: very_slow · network: yes
- risk: sensitive (HIGH) · gates: risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: customerName*:string, customerEmail:string, productName*:string, fileName*:string, filePath:string, orderId:string, stripePaymentId:string, emailSubject:string, emailBody:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `delivery_status`  —  **live-safe**
Use AFTER any send_message / scheduled-delivery to confirm receipt, when a recipient says "I never got it", or when auditing recent multi-channel deliveries. Returns delivery rows with channel, status (sent/delivered/failed), timestamp, and error. Includes a retry sub-op for fail
- categories: delivery · speed: normal · network: no
- risk: safe (LOW)
- params: command*:string, deliveryId:number, limit:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `detect_competitor_changes`  —  **doc-only**
Compare the latest snapshot of competitor pages against previous snapshots. Uses AI to identify meaningful changes in pricing, features, messaging, and positioning. Ignores cosmetic changes.
- categories: competitorIntel · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: competitorId:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `detect_emotional_state`  —  **doc-only**
Safety: scan a user message for shame-spiral / catastrophic / self-attack language patterns. Returns intensity (low/medium/high), pattern names matched, and whether intervention is needed. CRITICAL: if needsImmediateIntervention=true, the user expressed distress requiring an imme
- categories: wellness, safety, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `detect_fatigue`  —  **doc-only**
Wellness: scan a user message for late-night fatigue / craving / stress signals. Returns detected boolean, confidence (0-100), fatigue type (late_night | general_exhaustion | stress_craving), and matched keywords. Use BEFORE responding when user is messaging late at night or ment
- categories: wellness, felix · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: message*:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `doc_search`  —  **live-safe**
Search indexed document collections (like QMD). Modes: keyword (BM25-style), semantic (vector), hybrid (BM25+vector fusion, auto-reranked by Cohere when COHERE_API_KEY is set — strongly preferred). Use for notes, docs, knowledge bases, meeting transcripts, or any uploaded markdow
- categories: knowledge · speed: normal · network: no
- risk: safe (LOW)
- params: action*:string, query:string, mode:string, collection:string, collectionId:number, docPath:string, content:string, context:string, auto_contextualize:boolean, name:string, description:string, topK:number, minScore:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **live-safe**, live invocation optional/deferred

## `draft_social_post`  —  **doc-only**
Draft a social media post for VisionClaw Health marketing. Generates platform-optimized content using AI with brand voice guidelines. Returns draft text ready for review/posting.
- categories: marketing · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: platform*:string, topic*:string, style:string, include_cta:boolean, include_hashtags:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `edit_pdf`  —  **doc-only**
Edit an existing PDF — add text, add fillable form fields, add blank pages, or remove pages. The output remains editable. Use for modifying, annotating, or extending existing PDFs.
- categories: pdf · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: inputPath*:string, addText:array, addFields:array, addPages:number, removePages:array, outputPath:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `emit_event`  —  **doc-only**
Emit a business event to the event bus. Other personas subscribed to this event type will be notified and can take action. Use this when you detect something that other departments should know about — new leads, content published, deals progressed, etc.
- categories: system · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: eventType*:string, data*:object
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `enrich_lead`  —  **doc-only**
Enrich a lead with company data scraped from their website. Extracts industry, company size, products, and target market. Stores enriched data for scoring.
- categories: leadEnrichment · speed: slow · network: yes
- risk: sensitive (MEDIUM) · gates: risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive)
- params: leadName*:string, leadEmail:string, companyName:string, companyUrl:string, role:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; network tool (external/costly side-effect); speed=slow (likely LLM/expensive))

## `enroll_in_sequence`  —  **doc-only**
Enroll a contact in an outreach sequence. They'll receive step 1 immediately when the sequence is advanced, then subsequent steps at the defined intervals.
- categories: outreachSequencing · speed: normal · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: sequenceId*:number, contactName*:string, contactEmail*:string, companyName:string, personalContext:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `ensemble_query`  —  **doc-only**
Mixture-of-Agents (MoA): when you face a hard reasoning, factual, or judgment question and want the most reliable answer, run the same question through diverse frontier models in parallel (Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash) and have a strong aggregator (Claude Opus 4.8, 
- categories: reasoning, research, system · speed: very_slow · network: yes
- risk: safe (LOW) · gates: network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive)
- params: question*:string, proposer_pool:string, restate_gate:boolean, dissent_quota:boolean
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (network tool (external/costly side-effect); speed=very_slow (likely LLM/expensive))

## `estimate_cost`  —  **doc-only**
Predict resource consumption before executing a plan — estimate token usage, API costs, time, and risk level. Use before plan_and_execute or orchestrate to give the user visibility into what an operation will cost.
- categories: ai · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: steps*:array, modelId:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `evaluate_against_contract`  —  **doc-only**
R115.5 — Record an evaluator verdict against a pinned sprint contract. The contract is looked up by (refKind, refId) with status='open'; the row's sha256 is re-checked against the stored doneCondition (tamper detection). Marks the contract 'passed' or 'failed' and writes the eval
- categories: planning, governance, system · speed: fast · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive
- params: refKind*:string, refId*:string, evidence*:string, verdict*:string, scoredBy:string, notes:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive)

## `exec`  —  **doc-only**
Execute a shell command in the workspace. Security-gated: only allowlisted commands run by default. Use for system inspection, file operations, data processing, or running scripts. Must be enabled in Settings → Exec Tool.
- categories: code · speed: slow · network: no
- risk: destructive (CRITICAL) · gates: risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly
- params: command*:string, workdir:string, timeout:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=destructive; speed=slow (likely LLM/expensive); requiresApproval (HITL); trustedPersonasOnly)

## `execute_code`  —  **doc-only**
Execute JavaScript code in a secure sandbox. Supports math, data transforms, JSON processing, string manipulation, regex, and logic. No file system, network, or module access. Use for calculations, data analysis, format conversions, algorithm testing, or any computation the user 
- categories: code · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: code*:string, description:string
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

## `execute_felix_proposal`  —  **doc-only**
Run an APPROVED Felix proposal through the SWD verification rail: capture pre-state from the verifier table, fire the action (LIVE MODE ONLY — currently dry-run until 2026-05-12), capture post-state, verify actual delta matches expected_count_delta. On mismatch, status flips to '
- categories: agentic, felix, governance · speed: slow · network: no
- risk: sensitive (MEDIUM) · gates: risk=sensitive; speed=slow (likely LLM/expensive)
- params: id*:number
- [x] wired & documented (registry✓, policy✓, doc✓) — **doc-only**, NOT invoked (risk=sensitive; speed=slow (likely LLM/expensive))

---
When every tool above is reviewed, run: `npx tsx scripts/tool-smoke-test.ts --complete 5`
