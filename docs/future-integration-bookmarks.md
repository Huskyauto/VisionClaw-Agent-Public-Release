# Future Integration Bookmarks

Living index of external projects / APIs / repos that **aren't worth integrating today** but **are worth remembering** if a specific customer ask or platform direction shows up later. Each entry: what it is, when to revisit, what the integration would look like.

Add new bookmarks at the **top**.

---

## mattpocock/skills — Matt Pocock's Claude Code skill library

- **Repo:** https://github.com/mattpocock/skills
- **Stars / license:** ~48-77k / **MIT** (clean for code borrow OR pattern adaptation)
- **What it is:** Matt Pocock's personal `.claude/skills/` folder, published as a public reference set of production agent skills. Targets three engineering failure modes: misalignment, shared domain language, feedback loops (TDD). Portable across Claude Code, Cursor, and any harness that reads the open SKILL.md spec.
- **Bookmarked:** 2026-05-20

### Already adopted (R121)
- **`tdd`** → `.agents/skills/tdd/` (VisionClaw-adapted with sensitive-surface invariant table)
- **`handoff`** → `.agents/skills/cross-session-handoff/` (VisionClaw-adapted; distinct from session_plan.md which is intra-turn)
- **`zoom-out`** → `.agents/skills/zoom-out/` (VisionClaw-adapted with module-map vocabulary + escalation to explore subagent)
- **`write-a-skill`** → `.agents/skills/write-a-skill/` (diff-merge with `.local/skills/skill-authoring/` — sharper description framing + scripts criteria + review checklist on top of existing platform conventions)

### Remaining (not adopted — don't fit VisionClaw)
- `to-issues`, `to-prd`, `triage` — GitHub-issue-tracker oriented. VisionClaw uses `project_tasks` + `.local/session_plan.md` instead.
- `git-guardrails-claude-code` — already covered: bash `git commit` blocked by sandbox; Auto Git Push handles commits autonomously on 90-second quiet timer.
- `scaffold-exercises`, `migrate-to-shoehorn` — Matt-specific (TypeScript-teaching workflow + his own library). Not applicable to a corporate-ops platform.
- `prototype`, `diagnose`, `improve-codebase-architecture` — useful patterns but overlap heavily with existing `architect` / `critique` / `mockup-sandbox` skills.

### When to revisit
Matt updates the repo frequently. If a sharp new primitive lands (e.g., a new feedback-loop skill, a new misalignment-mitigation primitive), diff-import on a per-skill basis using `write-a-skill` skill's R-N-import-attribution convention. Don't bulk-resync.

---

## HKUDS/AI-Trader — autonomous AI-agent trading platform

- **Repo:** https://github.com/HKUDS/AI-Trader
- **Live:** https://ai4trade.ai
- **Stars / license:** ~17k / **MIT** (clean for code borrow OR external connector)
- **Stack:** Python FastAPI backend + React frontend + dual DB (SQLite/Postgres) + Redis cache + standalone background worker
- **What it is:** A trading platform designed for AI agents (not humans). REST + MCP + skill-based integration so any AI agent can paper-trade NASDAQ-100, SSE-50, crypto, and Polymarket; publish signals; follow other agents; compete in a multi-model leaderboard. Built by HKU Data Science department.
- **Bookmarked:** 2026-05-20

### Why not today
VisionClaw is a horizontal corporate-ops platform; AI-Trader is a vertical destination. Every architectural pattern worth borrowing (skill-as-contract, MCP toolchain, heartbeat notifications, multi-model competition, web-news search) is already present in VisionClaw at a deeper-engineered level (24 `.agents/skills/` + 62 db + 25 output-skills, R113.7+sec MCP server with scope gating, MoA jury + `ensemble_query` κ concordance, R112.17 Tier-1 web-access). No code lift makes sense.

### When to revisit
- Customer ask: *"Can VisionClaw's stock-analyzer persona actually execute paper trades and track P&L over time, not just analyze?"*
- Or: Bob decides VisionClaw should offer a managed paper-trading capability as a productized feature.

### Concrete integration shape (when triggered)
Treat AI-Trader as an **external connector**, not a code merge. Estimated effort: **1-2 engineer-days**.

| Component | Detail |
|---|---|
| New tools | `ai_trader_submit_signal`, `ai_trader_get_portfolio`, `ai_trader_paper_trade`, `ai_trader_get_leaderboard` |
| Connector | Bearer-token auth (their REST API; no OAuth) — single API key in env, registered in env-vars skill |
| TOOL_POLICIES | All 4 tools `safe` by default; `ai_trader_paper_trade` `sensitive` (paper-only); real-money trading **blocked at the tool layer** (intent-gate strict, refusal copy: "VisionClaw does not execute real-money trades") |
| Persona wiring | `.local/secondary_skills/stock-analyzer/SKILL.md` extends with "use `ai_trader_paper_trade` for hypothesis validation; never for real money" guidance |
| AHB safety_profile | Stock-analyzer persona gets `restrictedCategories: ["real_money_trading", "investment_advice_disclaimer"]` |
| Schema | None needed — AI-Trader holds the portfolio state |
| UI | Optional `/paper-trading` page surfacing the leaderboard + per-persona P&L (consumes AI-Trader REST directly) |

### Anti-goals
- **Do not** lift AI-Trader source files into VisionClaw — MIT license allows it but the architecture is too different to be worth the maintenance burden. Use it as an external API.
- **Do not** wire real-money trading. Ever. Liability + regulatory + ToS landmines.

---

## OpenBMB/MiniCPM-o 4.5 + Omni-Flow — full-duplex omnimodal interaction layer

- **Repo:** https://github.com/OpenBMB/MiniCPM-o
- **Companion work:** Thinking Machines Lab "Full-Duplex Time-aligned micro-turn" preview (2026-05)
- **Stars / license:** ~22k / **MiniCPM Model License** (NOT permissive — academic use OK, commercial use needs a written agreement with OpenBMB; verify before any production wiring)
- **Stack:** 9B omnimodal transformer + Omni-Flow framework (shared temporal axis: video tokens + audio tokens + LLM hidden states + speech tokens + waveform gen, all chunked on one timeline); <12GB RAM edge deployable; surpasses Qwen3-Omni-30B-A3B on omni-modal benches
- **What it is:** The first viable open full-duplex voice/video model. Breaks the walkie-talkie UX (user-talks → model-waits → model-replies). Model perceives while responding — interrupt-friendly, time-aligned, near-realtime.
- **Bookmarked:** 2026-05-20

### Why not today
VisionClaw is async corporate-ops: invoices, CRM, contracts, leads, MoA jury, autoresearch, Built-With-Bob video production — all multi-minute deliverable generation, none realtime-conversational. Voice today is one-way TTS (ElevenLabs primary, Fish Audio fallback, "onyx" for YouTube). The product surface that *would* benefit (Glasses Gateway at `/v1/glasses/{tools,execute,health}`) has no deployed wearable client. Full-duplex solves a problem we don't currently have, and adoption cost is non-trivial: new GPU microservice (we're LLM-API-only by design), Railway/Camofox-style deploy, and a non-permissive commercial license that requires legal sign-off.

### When to revisit
- Bob deploys a real wearable / glasses client and wants hands-free realtime corporate ops (the Glasses Gateway already exists — needs a client).
- We build a phone-answering persona (e.g. Robert auto-answering accountant calls, Apollo qualifying inbound sales calls) — full-duplex is the architecture to evaluate FIRST before stitching Twilio + Whisper + ElevenLabs + LLM in a leaky pipeline.
- Customer asks for a Pi-style / Hume-style realtime AI companion built on VisionClaw's persona stack.
- OR: a fully permissive (MIT/Apache) full-duplex open model ships and the license blocker dissolves.

### Concrete integration shape (when triggered)
Treat as an **external microservice**, not a code merge. Estimated effort: **5-8 engineer-days** for first surface.

| Component | Detail |
|---|---|
| Infra | New Railway service (GPU-backed: A100 40GB or L4 24GB minimum), running MiniCPM-o + Omni-Flow runtime, WebSocket endpoint streaming PCM in / PCM+text out |
| Auth | mTLS or HMAC-signed JWT between VisionClaw and the omnimodal service; same pattern as Camofox |
| New tools | `start_realtime_session` (returns WebSocket URL + signed token), `end_realtime_session` (close + persist transcript to `conversations`), `realtime_session_transcript` (read-after) |
| TOOL_POLICIES | All 3 `sensitive` — sessions cost real GPU-time; `start_realtime_session` rate-limited per tenant via R115.5+sec storage tenant-scope |
| AHB safety_profile | Any persona granted realtime tools needs `intentGate: "strict"` (audio jailbreaks are easier than text — voice-pitch-and-pacing carriers exist) + `restrictedCategories: ["voice_impersonation", "audio_jailbreak"]` |
| Persona wiring | Start with ONE persona (Apollo or Robert) — never blanket. Adversarial scope. |
| Schema | NEW `realtime_sessions` table (tenantId notNull, sessionId, persona_id, started_at, ended_at, transcript jsonb, cost_cents); index on (tenantId, started_at desc) |
| UI | New `/realtime/<sessionId>` page (mic permission + waveform + live caption); existing chat UI links into it via "Start voice session" button on persona detail |
| Quality gates | The Felix-style grade-then-revise loop doesn't apply (realtime ≠ batch); instead add per-session cost cap + auto-disconnect at $0.50 / 5min / N tokens; surface refund flow if cap blew without delivering value |
| Cost ceiling | Document the Kulkarni reflexive-loop scale boundary applies here too — realtime sessions stack worse than batch; hard-cap concurrent sessions per tenant at 1 until we have data |

### Anti-goals
- **Do not** wire full-duplex into all 16 personas at once. Start with ONE adversarial-scoped persona, measure jailbreak rate, expand.
- **Do not** ship without OpenBMB's written commercial-use sign-off (the MiniCPM Model License is a real blocker, not a formality).
- **Do not** route real-money tools (`stripe_*`, `delete_*`, `send_mass_email`) into a realtime session — destructive-tool-policy + HITL flow doesn't survive a streaming voice turn. Hard-block at the tool layer if `is_realtime_session === true`.
- **Do not** persist raw audio waveforms — store transcripts only (PII surface + storage cost). If raw audio is genuinely needed for a debug case, it goes to the same `__VisionClaw-Admin-Backups__/` admin-marker folder hardened in R119.2+sec.
- **Do not** swap our text chat for realtime by default. Text chat is multi-deliverable + auditable + cheap. Realtime is a *new surface*, not a replacement.

### Watchlist (cheaper triggers than full adoption)
- Qwen3-Omni-Next or DeepSeek-Omni shipping under Apache-2.0 with comparable quality — dissolves the license blocker.
- Anthropic / OpenAI / Google shipping a hosted full-duplex realtime API at <$0.10/min — eliminates the GPU microservice cost, collapses 5-8 engineer-days to ~1 day for tool wiring.
- The Thinking Machines Lab paper landing with reference code + Apache license — same trigger.

---

## 2026-05-23 — Multi-agent-in-chat "war room" UX (agent-room.com / designedbycommittee pattern)

**Source links Bob flagged:**
- https://www.agent-room.com/ — multi-agent chat room where agents see each other's messages
- https://github.com/SPhillips1337/designedbycommitee — proposer + critic LLM pair converging on combined answer
- https://agentchat.me/ — third sighting of the same pattern (2026-05-23); signal that conversational multi-agent UX is hitting indie-builder zeitgeist

**What it is:** turn-based conversational multi-agent in one shared thread. Two (or more) LLMs see each other's free-text replies, one proposes, the other critiques, they converge.

**Why we did NOT build it now (Bob 2026-05-23):** the *substance* of the pattern is already shipped — `ensemble_query` (MoA, 3 proposers + aggregator) and `jury_triage` (3-model vote with auto-apply, R125+3.6+sec.1) do exactly this, just batched not turn-based. The novelty of agent-room is the *theater* of watching agents argue in a chat thread, not the underlying logic.

**Revisit trigger:** if/when Bob wants a Bob-facing "war room" UX surface — pitch an idea, watch 2-4 personas (Felix / Apollo / Architect / etc.) chime in *visibly in parallel* in one thread. Build cost ~2-3 days, reuses `ensemble_query` infra under the hood. Matches the atrophy-fight preference (intentional friction, see them disagree, don't rubber-stamp). Skip the customer-facing flavor (injection surface + AHB intent-gate ambiguity + R125+3.6+sec.1 liability direction) and skip the MCP-mesh framing (internal agent-to-agent is already subagent + tool calls — adding MCP in the middle is pure overhead).

---

## 2026-05-23 — Agentic Commerce Surface (AP2 / Universal Cart + tenant-facing avatar tool)

**Source signal:** Google I/O 2026 dropped three things in one week — (a) another Search core update making SEO ranking volatility worse, (b) Universal Cart + Agent Payments Protocol (AP2) so agents can transact on behalf of humans with spending caps, (c) Google Omni AI avatar quality at near-studio level. Marketing essay Bob flagged 2026-05-23 framed (a)+(b)+(c) as a funnel-rewrite; the real signal is (b) and (c), not (a).

**Why this is a future-bookmark not a build-now:** AP2 spec is fresh; tenant demand isn't measurable yet; avatar quality from third parties (HeyGen / D-ID / Synthesia / Google Omni) is moving so fast that building our own avatar layer now would be obsoleted by the next quarterly release.

**The paired idea (Karpathy "speedups ≠ just faster" play):**
1. **Agent-discoverable brand surface for tenants** — extend the existing `/.well-known/agent.json` pattern to a tenant-facing product: every VC tenant gets a public `/agent.json` + structured product feed (schema.org Product + AP2 payment-metadata block) so when a buyer's agent shops via Universal Cart or equivalent, the tenant's offering surfaces with clean, agent-readable schema. Optional `paymentEndpoint` + `spendingCapPolicy` metadata to actually accept AP2 transactions.
2. **`avatar_synthesize` tool** — drop alongside `mpeg_produce_parallel` in the video pipeline. Initially wraps a third-party (HeyGen API / D-ID API) so we don't bet on a specific provider; later swap to whatever wins on quality/cost. Cuts Bob's Built With Bob filming time for talking-head segments; gives tenants a "branded face" option for their own video output.

**Revisit triggers:**
- AP2 reaches v1.0 with multi-retailer reference implementations (not just Google's first-party Universal Cart).
- A VC tenant explicitly asks "can buying agents find me through your platform" — that's the demand signal we need before building (1).
- Avatar provider pricing drops to <$0.05/minute generated OR Google Omni opens a paid API — that's the trigger for (2).
- The agentic-commerce category produces 2+ measurable revenue events for any indie founder in our network (not just Google's own demo).

**Why NOT to build now (explicit):** (a) tenant demand is hypothetical; (b) AP2 spec is pre-1.0 and Google could change auth/payment shape; (c) third-party avatar APIs are moving fast enough that any wrapper we ship this quarter is technical debt next quarter; (d) we have higher-leverage work in front of us (jury implementer pipeline Phase-2, marketing-week-autopilot adoption).

**What we already have that makes this cheap when triggered:** existing `/.well-known/agent.json` route, MCP server with 12 tools as the wire format, video pipeline + `deliverDigitalProduct` for output handling, structured-output ensemble pattern for generating clean schema.org JSON from messy tenant data. Build cost when triggered: ~1 week for (1), ~3 days for (2) wrapping a provider.

---

## 2026-05-24 — book-to-skill converter (virgiliojr94)

**Source signal:** Bob flagged [virgiliojr94/book-to-skill](https://github.com/virgiliojr94/book-to-skill) (Apache-2.0) — converts PDF/EPUB/DOCX into Claude Code / Amp skill packages via Docling extraction + multi-pass chapter summarization.

**Status:** Inspected. Useful nuggets imported into `.agents/skills/write-a-skill/SKILL.md` § _Optional sub-flow: import from a reference doc_ (R125+7):
- Five-bucket extraction taxonomy: Frameworks / Principles / Techniques / Anti-patterns / Voice calibration.
- REPL-style large-doc access pattern (`wc` → `grep -n` → `sed -n` → targeted `Read(offset, limit)`) instead of full-file Read for any doc >50k tokens.
- Two-phase HITL gate: produce extraction report → human sign-off on taxonomy + name + triggers → THEN draft SKILL.md. Prevents the auto-generated-skill failure mode (bloated body + vague description = never loaded).

**NOT imported (and why):**
- The Docling-based extractor / multi-format detection / per-chapter generation pipeline. We already ingest PDFs via `learn_from_reference` (vision LLM → 3-8 copyable patterns into agent_knowledge), autoresearch, and the vector knowledge library. The problem book-to-skill solves on the input side is already solved here.
- The "default to auto-publish" mode. Our `write-a-skill` discipline explicitly requires human curation of the `description:` field because that's the only thing future-agent sees when deciding whether to load the skill.
- Cost-estimate pre-flight. We don't need it; the REPL-style probe pattern keeps cost proportional to output not source.

**Revisit triggers:**
- A specific book Bob wants ingested at full-chapter fidelity where `learn_from_reference`'s 3-8-pattern extraction is too lossy (e.g. DDIA, Designing Machine Learning Systems, A Philosophy of Software Design).
- Demand for skills generated from non-PDF formats we don't currently handle (EPUB, DOCX, RTF, MOBI).
- The 2-phase HITL flow in `write-a-skill` actually getting used and proving the taxonomy works — then maybe automate phase 1 via a script.

**Why NOT to build the converter now:** zero customer story; existing ingestion + vector library already handles "I want the agent to know what this book says"; the hard part of a usable skill (sharp description, real trigger phrases) doesn't automate well.

---

### A2A CLIENT / outbound agent-mesh — DEFERRED (jury verdict, 2026-06-06)

**Idea (from `agulli/atlas-agents`, the "Hands-on AI Agents" book repo):** build an A2A *client* — discover and CALL external third-party agents via their A2A v0.3 Agent Cards (Linux Foundation spec), i.e. participate OUTBOUND in an external agent mesh. (We already PUBLISH our own card at `GET /.n/agent.json`; this is the missing outbound direction.)

**Verdict: DEFER (do not build now).** `jury_triage` ran 3 frontier proposers (gemini-3.5-flash, deepseek-v4-pro, claude-opus-4-8): **unanimous 3/3**, concordance κ=0.83, no escalation, logged as decision **#410**. The verdict label is "ACCEPT" but ACCEPT = *accept the disposition of deferral* — all three voted YAGNI: don't build now, keep it as a documented, inert deferral.

**Why defer:** single-user platform, zero concrete external agents to call today; internal agent-to-agent is already fully covered by subagents + tool calls (and "MCP-in-the-middle is pure overhead", per the earlier bookmark); building now front-loads a real new attack surface (prompt-injection from untrusted agents, SSRF, destructive-tool-policy gating) + ongoing security-review cost against purely speculative benefit. Publishing the card already signals intent toward the spec, so deletion is wrong — deferral is correct.

**Re-open triggers:** (1) a concrete external A2A agent Bob actually wants to delegate to; (2) multi-user / partner-integration demand; (3) A2A reaching a stable v1.0.

---

(More bookmarks land above this line as they come up.)
