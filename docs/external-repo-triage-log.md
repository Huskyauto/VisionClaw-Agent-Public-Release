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
