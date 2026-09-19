# External repo nugget triage log

When Bob drops a link to an interesting external repo, the triage lives here. Pattern mirrors `docs/vimax-nuggets-log.md` (Felix video pipeline future-work): one section per repo, explicit IMPORTED / REJECTED / DEFERRED verdict per sub-package or sub-feature, trigger conditions for revisiting any DEFERRED items.

Goal: kill the "we already looked at this and decided no" memory tax — every link gets a written verdict so we never re-debate the same import twice.

---

## 2026-05-15 — `Lyellr88/MARM-Systems` (Memory Accurate Response Mode, v2.2.6)

**Repo:** https://github.com/Lyellr88/MARM-Systems (master branch)
**Description:** "Universal MCP Server (supports HTTP, STDIO, and WebSocket) enabling cross-platform AI memory, multi-agent coordination, and context sharing."
**Stack:** Python 3.10+ / FastAPI 0.115.4 / FastAPI-MCP 0.4.0 / SQLite (WAL mode) / sentence-transformers (`all-MiniLM-L6-v2`) / Docker / MIT license
**Surface:** 18 MCP tools (semantic recall, contextual log, session management, logging system, summary, context bridge, notebook CRUD, current_context, system_info, reload_docs).

### Triage summary: NOTHING MATERIAL TO IMPORT THIS ROUND.

MARM is essentially "VisionClaw's memory system in a box, packaged as an MCP server for single-user Python developers who don't have a platform." We are 18+ months ahead of MARM's memory sophistication. Two micro-nuggets DEFERRED for later revisit; everything else REJECTED.

### Feature-by-feature triage

| MARM feature | VisionClaw equivalent | Verdict |
|---|---|---|
| `marm_smart_recall` — semantic cosine top-k over memories | MNEMA k=5 decorrelated kin scoring + pgvector + confidence-weighted scoring | **REJECT** — we're more sophisticated (decorrelation + confidence weighting beats raw top-k) |
| `marm_contextual_log` — auto-classify + embed + store | Memory V2 with confidence-scored facts + whitespace-normalized dedup + phantom-stage supersession + debounced async writes | **REJECT** — we're way ahead |
| Auto-classification (code / project / book / general) | Knowledge library tags + capability registry | **REJECT** — equivalent + multi-tenant-safe |
| `marm_context_bridge` — workflow transition between sessions | chat-engine session continuity + `recall_context` tool + Memory V2 retrieval | **REJECT** — equivalent |
| Sessions with per-session memory | tenant_id + conversation context + cross-conversation memory graph | **REJECT** — we have multi-tenant; MARM is single-user |
| MCP server packaging (HTTP / STDIO / WebSocket) | We are a platform, not a memory layer for external MCP clients | **N/A** — different product shape |
| `all-MiniLM-L6-v2` (384-dim) embeddings | OpenAI `text-embedding-3-small` (1536-dim) for tool ranking; better quality for everything | **REJECT** — strictly inferior |
| Hardcoded local OAuth dev credentials (`local_client_b6f3a01e` / `local_secret_ad6703cd2b4243ab`) baked into the README | Real `SESSION_SECRET` + `HITL_TOKEN_SECRET` + CSRF + AHB intent gate + destructive-tool policy | **REJECT** — actively a security smell; do not import this pattern under any circumstance |
| SQLite WAL + custom connection pooling | Postgres + Drizzle ORM + pgvector + 168-table multi-tenant schema | **REJECT** — strictly inferior at our scale |
| IP-based rate limiting tiers (60/min default, 20/min memory-heavy, 30/min search) | Per-tenant CSRF + AHB destructive-tool gates + delivery-pipeline auth + cron-secret + tenant-scope enforcement | **REJECT** — IP rate limiting is what people reach for when they don't have real tenant auth; we have real tenant auth |
| **Notebook** — toggle-activated reusable instruction sets (`marm_notebook_use "key1,key2,key3"`) | Skills (auto-fire on triggers) + pinned context block | **DEFER** — see Micro-nugget #1 below |
| **Auto-summary checkpoint every N messages** (Q2 roadmap, opt-in `Auto-Log`) | Heartbeat-driven Memory V2 writes + debounced async commits, but no explicit N-message trigger | **DEFER** — see Micro-nugget #2 below |
| Docker containerized deployment with health/readiness checks | Replit deployment + health-check endpoints + deployment-verification skill | **REJECT** — we have equivalent at the platform layer |
| Response size management (MCP 1MB compliance) | Context-budget audit tool + chunk-and-parallel for large outputs | **REJECT** — we have stronger upstream truncation |

### Micro-nugget #1 (DEFERRED) — Toggle-activated instruction notebooks

**MARM idea:** Pre-write reusable instruction blocks (e.g. "always cite sources", "BWB brand voice", "strict-typescript-only"), give each a key, then let a user one-line activate a subset for the current session via `marm_notebook_use "voice_bwb, cite_sources, no_emoji"`.

**Why it's interesting:** Our skills auto-fire on triggers (`activate when user asks X`). There's no "manually pin these 3 instruction blocks to my next 5 turns" mechanism. A power user who knows what kind of conversation they're about to have today could pre-load the relevant rails without depending on trigger-detection accuracy.

**Why it's deferred, not imported now:**
- Not solving a current pain point — Bob isn't complaining about skill triggers missing.
- Would need a UI surface (sidebar checkbox list, slash-command, or chat-prefix) to be useful — that's at least a half-day of frontend work.
- Skills + pinned context already cover ~80% of the use cases.

**Trigger to revisit:** Bob ever says "I wish I could just turn on these instructions for this conversation" OR we see logs of users asking the same kind of "act like X, do Y, never Z" preamble three turns in a row.

### Micro-nugget #2 (DEFERRED) — Auto-summary checkpoint every N messages

**MARM idea:** Opt-in `Auto-Log` feature that fires a semantic summary every N messages (their Q2 roadmap, not yet shipped on their side either).

**Why it's interesting:** We have heartbeat-driven Memory V2 writes and debounced async commits, but no explicit "after every 20 turns, condense the conversation into a checkpoint fact and write it." For very long conversations where the early context drops out of the rolling window, this would catch decisions that never crossed Memory V2's confidence threshold but would matter if referenced 30 turns later.

**Why it's deferred, not imported now:**
- ~30 lines in `chat-engine.ts` to wire — but Memory V2's existing behavior already covers most cases via confidence-scored fact extraction.
- Risk: spam Memory V2 with low-quality "checkpoint" facts that pollute the kin-scoring distribution. Would need a separate `facts_kind = 'auto_checkpoint'` namespace + lower confidence ceiling.
- Phantom-stage supersession already handles the "early decisions get superseded later" case, which is the bigger failure mode.

**Trigger to revisit:** Bob (or a user) reports "the agent forgot something from earlier in this long conversation that wasn't a fact, it was a vibe / decision / preference" AND we can trace it to a checkpoint that should have been auto-summarized.

### Rejected — explicit non-imports (for the record)

- **The entire Python/FastAPI/SQLite stack** — strictly inferior to Postgres + pgvector + Drizzle at our scale.
- **The MCP-server packaging** — we ARE the platform; we don't need to expose memory to external MCP clients. If we ever wanted to (Phase 4+ scenario), we'd build a thin adapter, not adopt their server.
- **The single-tenant assumption** — would actively break our tenant-isolation invariants.
- **`all-MiniLM-L6-v2`** — strictly inferior to our existing embeddings.
- **IP-based rate limiting** — wrong abstraction for our model; we have per-tenant policies + AHB destructive-tool gates which are stronger.
- **Hardcoded OAuth dev credentials** — security smell I don't want anywhere near our codebase. Their own README admits "not suitable for production" — but the pattern of baking credentials into a repo, even as "dev only," teaches the wrong reflexes.

### One-liner for future-me

> MARM is what VisionClaw's memory system would look like if you stripped out multi-tenancy, replaced Postgres with SQLite, replaced pgvector with sentence-transformers, replaced AHB with hardcoded local OAuth, and exposed the whole thing as an MCP server for external clients. None of those moves help us. Two UX patterns (toggle-activated instruction notebooks, N-message auto-summary checkpoints) might be worth importing if a user complaint surfaces; everything else, hard no.

---

## 2026-06-07 — `pat-jj/harness-1` (Harness-1, arXiv:2606.02373)

**Paper:** https://arxiv.org/abs/2606.02373 · **Code:** https://github.com/pat-jj/harness-1
**Authors:** Jiang, Shi, Hong, Xu, Sun, Sun, Bashir, Han (UIUC / UC Berkeley / Chroma), 1 Jun 2026
**Description:** "Reinforcement Learning for Search Agents with State-Externalizing Harnesses." A 20B open search agent (gpt-oss-20b LoRA) trained with RL (CISPO) over a stateful *harness* that holds environment-side working memory, so the policy only makes semantic decisions. Hits 0.730 avg curated recall across 8 retrieval benchmarks, beating the next open search sub-agent by +11.4 and staying competitive with much larger frontier searchers — gains strongest on held-out transfer.
**Core thesis:** stop using the LLM context as the notebook. The model keeps the hard calls (what to search / inspect / keep / verify / when to stop); a deterministic harness keeps the recoverable state (candidate pool, importance-tagged curated set, evidence graph, verification cache, dedup, budget-aware rendering). Cleaner RL signal + cheaper context.

### Triage summary: VALIDATES our research-engine architecture. RL half N/A. ONE nugget DEFERRED.

The paper independently arrives at the design we already run in `server/research-engine.ts`. The headline numbers come from RL-training an open 20B policy — **not importable** (we run frontier API models, no fine-tuning). Evaluate the scaffold only; one genuinely net-new structure is worth a future spike.

### Feature-by-feature triage

| Harness-1 element | VisionClaw equivalent | Verdict |
|---|---|---|
| Externalize search state out of the LLM context | `research_sessions` / `research_experiments` DB tables drive the loop; model is fed a structured summary, not a growing transcript | **REJECT (already native)** |
| Importance-tagged curated set + keep/discard | GPT-judge 4-criteria rubric (Specificity/Actionability/Relevance/Novelty), keep ≥6 → `agent_knowledge` with priority (3–5) + TTL (14–30d) | **REJECT (already native)** |
| Budget-aware context rendering / compression | `context-window-guard.ts` condenses dropped history into a quarantined `[HISTORICAL SUMMARY]` (summarize-not-truncate) + orphan-tool-pair repair; Lost-in-the-Middle U-shaped reorder after truncation | **REJECT (already native)** |
| Candidate pool (cap 30, importance eviction, auto-seed top-8) | Flat scored finding list; no explicit bounded pool w/ eviction policy | **DEFER (minor)** — eviction policy is a small refinement, low ROI alone |
| Dedup of observations (BM25 sentence selection, chunk-ID filters) | Context guard + reorder; no BM25 sentence-level observation dedup | **DEFER (minor)** |
| **Evidence graph** (entities→docs, bridges + singletons) **+ per-claim verification cache** (claim→verdict, per-doc yes/no) | Flat scored list, NOT a graph; CoVe/jury verify FINAL answers, not running per-claim during search | **DEFER — see nugget below** |
| RL training the policy (CISPO, gpt-oss-20b LoRA, teacher rollouts → SFT → RL) | Frontier API models, no fine-tuning | **N/A — not importable** |

### Nugget (DEFERRED) — Evidence graph + per-claim verification cache for multi-hop research

**Harness-1 idea:** during a search task, maintain (a) an evidence graph mapping entities → the documents that support them, distinguishing "bridge" facts that connect documents from "singletons", and (b) a verification cache recording which specific claims have been checked and with what verdict — both rendered back into the working-memory view each turn.

**Why it's interesting:** our research loop keeps a *flat* scored list of findings. For **multi-hop synthesis** — where the answer requires connecting a fact in doc A to one in doc C via doc B — a graph beats a list, and a running verification cache prevents re-checking the same claim and makes "what's still unverified" explicit. Our CoVe/jury verifies *final answers*, not claims *during* the search, so this is a real gap, not a rename of something we have. Highest leverage on competitor-intel and deep-research deliverables that span many sources.

**Why it's deferred, not built now:**
- No current pain point — Bob hasn't reported multi-hop research producing disconnected/unverified findings.
- Net-new state shape (graph table or jsonb on `research_experiments` + a verification cache) + new "add edge / record verdict" actions in the loop + budget-aware rendering of the graph view — a real spike, not a 30-line wire.
- The flat keep-list already covers single-hop and shallow multi-hop fine.

**Trigger to revisit:** a deep-research or competitor-intel deliverable comes back with findings that are individually fine but *don't connect* (no synthesis across sources), OR we catch the loop re-verifying the same claim repeatedly, OR Bob asks for "research that actually ties the sources together."

### One-liner for future-me

> Harness-1 is third-party proof that our research-engine architecture (externalized DB state + importance-tagged keep-judge + summarize-not-truncate budgeting) is the right call — frontier-lab researchers RL-trained a 20B model to reach what our prompt-driven loop already does structurally. The ONLY thing to steal is the evidence-graph + per-claim verification-cache for multi-hop synthesis; the RL training that produces their numbers is irrelevant to an API-model platform. Don't re-debate importing search-agent RL papers — evaluate the scaffold, ignore the training.

---

## 2026-06-07 — Hermes "SOUL.md" agent operating-charter (tonysimons_ on X)

**Source:** X article by @tonysimons_ (id 2056545463713640917) + attached `SOUL.md` (145 lines)
**What it is:** NOT a repo or paper — a single-file **agent operating charter / system prompt** for a personal autonomous operator ("Hermes"). Sections: SOUL, Stance, Accountability, Pushback, Autonomy, Mission, Tone, Operating Mode, Delegation, Standards, Lookup, Escalation, Self-Improvement, End State.

### Triage summary: VALIDATES our operating philosophy (~80% already encoded). Cherry-pick 2 sharp behaviors. One construct belongs to the PERSONAL layer, not VCA core.

This is a well-written charter, but most of it is already live across `replit.md` prefs + Felix/agent-ops prompts + AHB/destructive-tool-policy. **Frame mismatch:** it's a single-principal "I/my" personal-operator doc; VCA is multi-tenant, so its "mission map" construct fits Bob's personal layer ([Your Product] / a personal-operator persona), not VCA core.

### Section-by-section triage

| SOUL.md section | VisionClaw equivalent | Verdict |
|---|---|---|
| **Stance / high-agency / act-don't-ask** | Felix prompt "ACT IMMEDIATELY — do NOT present options A/B/C"; replit.md act-don't-ask standing order | **REJECT (already native)** |
| **Pushback w/ evidence** | `pinned-hypotheses.ts` causal-graph "attach evidence" + active-clarification gate | **REJECT (already native, arguably more hardened)** |
| **Autonomy hard line** (approval for posting/publishing/purchasing/paid-signups/messaging-real-people/deleting/destructive/exposing-private/credentials-security) | `destructive-tool-policy.ts` gates payouts, bulk email, cross-platform post, deletes, `set_policy`, `reveal_secret`; deploy is human-initiated (`suggest_deploy` terminal) | **REJECT (already native)** — but a useful AUDIT CHECKLIST; confirm "paid signup / purchasing" has an explicit prompt-level rule (we gate Stripe payouts but not a generic "don't subscribe to a paid service") |
| **Operating Mode / orchestration-not-solo + own-the-outcome** | Felix "you delegate, GET the result, and present it"; "promised N slides, emitted 1 = defect to retry" | **REJECT (already native)** |
| **Delegation Rules (synthesize, don't dump raw subagent output)** | Felix + agent-ops synthesis rules | **REJECT (already native)** |
| **Lookup Protocol (local before external)** | recall_context / Memory V2 / knowledge library retrieval precedes web | **REJECT (already native)** |
| **Tone (private concise / public match-voice, no corporate sludge)** | replit.md public-voice rules + BWB brand-style-guide | **REJECT (already native)** |
| **Accountability — "create motion, not artifacts for the graveyard"; flag when surfaced work is being IGNORED; call out opening loops without closing** | NOT present — we surface follow-ups + inbox items but don't self-monitor whether they're acted on | **DEFER — nugget #1** |
| **Escalation TEMPLATE — issue + tradeoff + recommendation + exact decision needed (never "what do you want?")** | We have "error + fix-plan" + user_query Score Rule, but not this as the escalation FORMAT | **DEFER — nugget #2 (cheap)** |
| **Mission map** (priorities / active builds / needs-work / back-burner / sunset / debt, consulted to weight attention + reject off-mission ideas) | No high-level mission/priority check per turn; implied by operating_loop | **DEFER — nugget #3 (personal layer only)** |

### Nugget #1 (DEFERRED) — Feedback-loop accountability ("don't generate artifacts for the graveyard")

The sharpest idea in the file: an agent that notices when *its own surfaced work is being ignored* and flags the broken loop ("if I'm not acting on what you surface, the loop is broken… if I keep opening new loops instead of closing important ones, call that out"). We surface follow-up tasks + agent-inbox items but never measure whether they're acted on. Pairs directly with the **atrophy** + **illusory-productivity** prefs in replit.md (we already track predicted-vs-actual orchestration cost; this is the next axis — surfaced-vs-acted-on). **Trigger to revisit:** follow-up tasks / inbox items pile up unactioned, OR Bob says "you keep suggesting things I never do."

### Nugget #2 (DEFERRED, cheap) — Escalation template

Standardize owner-notification + HITL escalations to: **issue → tradeoff → recommendation → exact decision needed**, never a bare "what do you want me to do?", and take the safe partial path while waiting. ~A few lines into `agent-ops-prompt.ts` + the owner-notification skill. Low cost, high clarity. **Trigger:** next time we touch the escalation/owner-notification path.

### Nugget #3 (DEFERRED, personal layer) — Mission map

A living prioritized map (active / needs-work / back-burner / sunset / debt) the operator consults to weight attention and push back on off-mission ideas. Strong for a **personal** operator; awkward for multi-tenant VCA core. **Trigger:** Bob wants a personal-operator persona ([Your Product] or standalone) — build it there, not in VCA.

### One-liner for future-me

> The Hermes SOUL.md is a clean writeup of the operating philosophy VisionClaw already runs — act-don't-ask, evidence-based pushback, orchestrate-and-own-the-outcome, gated hard-line autonomy. Two behaviors are genuinely worth stealing into our prompts: (1) feedback-loop accountability (flag when surfaced work is ignored — pairs with the atrophy pref), (2) the issue+tradeoff+recommendation escalation template. The "mission map" is a personal-operator construct — put it in Bob's personal layer, not VCA core. Don't wholesale-adopt external charters; cherry-pick behaviors.
