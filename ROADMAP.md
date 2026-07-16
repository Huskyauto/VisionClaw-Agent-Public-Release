# VisionClaw Agent — Public Roadmap

This is a living document. **Last updated: June 17, 2026** (after Round R125+52).

The roadmap below shows where we've been (so you can size the project) and
where we're going (so you can decide whether to fork, contribute, or wait).

> **Authoritative platform totals:** [docs/CURRENT_PLATFORM_TOTALS.md](docs/CURRENT_PLATFORM_TOTALS.md) is the single source of truth. The number on the bottom of this page must agree with that file.

---

## ✅ Selected Shipped Highlights

A curated sample of rounds that shaped the platform. This is **not** the full
changelog — current per-round detail (up to the latest round) lives in the
"What's New" section of the public README. Older round-by-round detail is
collapsed into the "Earlier highlights" section below.

| Round | Title | What it gave you |
|------:|-------|------------------|
| R74 | Security hardening bundle | Email path fails closed when tenant unresolved · Stripe Connect routes return explicit 401 instead of `?? 1` · admin-gating for `/api/cache/stats`, `/api/drive-health`, `/api/setup/status` env-var matrix · model-catalog log-fix preventing crash on empty digest. |
| R73 | Adaptive Model Discovery + Cost Ledger | Daily OpenRouter catalog scan, tier-classifies the full live catalog, emails the owner a ranked digest of new models worth adding · per-tenant cost ledger with `pg_advisory_lock` keyed on `(ledgerKey, tenantId)` to prevent double-counting. |
| R71 | Route orphan triage | Audited every endpoint in `routes.ts`, reconciled with frontend usage, removed 18 dead routes, documented every public route. |
| R64 | File upload + injection hardening | MIME magic-byte sniff on every upload · cross-tenant ownership check on `/uploads` static mount · HMAC-signed download URLs · reserved-key prefix bypass closed in tool argument normalization. |
| R63 | Proactive self-healing engine | Auto-apply loop for verified code proposals (R25) now closes the loop with Minerva-drafted strategic plans before the apply step runs. |
| R54 | Vector tenant isolation + KB fences | Vector search throws if `tenantId` is undefined · KB sections wrapped in untrusted-data fences in the system prompt. |
| R41 | Wiring invariants tripwire | Boot-time + 6-hour heartbeat scans 4 wiring invariant categories (`schedule_binding`, `program_persona_map`, `code_proposal_targets`, `outcome_canary`, `dormant_tools`) and fires an attention-bus event on critical drift. |

## 🛠 In Progress (active rounds)

- **OpenAPI / Swagger spec** for the 300+ HTTP endpoints — for enterprise pitches and contributor onboarding.
- **GitHub Actions polish** — current CI runs `npm ci && npm run build` and security/tenant-isolation tests; expanding to LSP-only `tsc --noEmit` gating and a smoke boot test against pgvector.
- **Public mockup-extract / mockup-graduate workflow** — UI components can be mocked on a canvas first, then graduated into the main app with import rewriting.
- **Sample outputs gallery** — checked-in PDFs / Excel / Slides showing what the agents actually produce, so prospective forkers can see deliverable quality before installing.

## 🎯 Next (likely next 1–2 rounds)

- **Demo video on the landing page** — a 2-minute walkthrough showing intake → execution → delivery.
- **Tools.ts modularization** — split the `server/tools.ts` mega-file by category (research, documents, payments, social, …) without changing runtime behavior. Easier contributor PRs. Authoritative count in [`docs/CURRENT_PLATFORM_TOTALS.md`](docs/CURRENT_PLATFORM_TOTALS.md).
- **Routes.ts modularization** — split route handlers by feature domain.
- **One-click deploy buttons polish** — Render and Railway buttons exist; tightening the env-var prefill so a new fork boots cleanly without manual config.
- **Embeddable agent widget** — drop a `<script>` tag on any site to embed a tenant-scoped chat with the full agent team behind it.

## 🗺 Backlog (no committed timeline)

- Native mobile shell (Expo) wrapping the existing PWA.
- Local-first model routing (Ollama / llama.cpp tier ahead of cloud providers).
- Per-persona custom voice cloning via ElevenLabs Voice Library.
- Marketplace for community-contributed tools (graduate path mirroring the existing skill graduation pipeline).
- Agent-to-agent open protocol (cross-tenant, cross-instance message bus over SSE/WebRTC).
- Native Slack and MS Teams bots (Discord, WhatsApp, Telegram, AgentMail are already shipped).
- Persistent shared memory across tenants (opt-in) — for franchise / multi-org deployments.
- SSO (SAML / OIDC) for enterprise deployments.

## 💡 Ideas under evaluation

- **Self-replicating tenants** — Felix (the CEO persona) spawning a sub-tenant with a scoped budget for a one-off mission, then sunsetting it.
- **Continuous architect-review loop** — every shipped round automatically triggers an architect review with severity-tagged findings posted to the `/code-proposals` page.
- **Public capability registry mirror** — surface a read-only `/api/capabilities` endpoint listing tools, skills, personas, and governance rules so external systems can introspect before delegating.

---

## Earlier highlights (R13–R35)

| Round | Title | What it gave you |
|------:|-------|------------------|
| R13 | Zero-Cost Article Extraction | Mozilla Readability + LLM-Scraper template recipes that graduate to deterministic parsers after 3 cache hits. |
| R18 | Per-Tenant Personalization & 3-Phase Dreaming | `userNotesMarkdown` profile + `disabledSkillNames` + Light/Deep/REM consolidation with Dream Diary. |
| R20 | Glasses Gateway | Meta Ray-Ban smart glasses streaming live vision + Gemini Live audio with sub-second voice replies. |
| R21 | Mixture of Agents (MoA) | 4 frontier proposers + Claude Opus aggregator for ensemble-quality answers. |
| R22 | Cost Optimizer | `cost-eval-runner.ts` runs a frozen 20-query suite per candidate model and stores numeric cost + judge score. |
| R25 | Self-Improving Codebase | Nightly research generates real code edits; `proposal-verifier.ts` shadow-compiles each in an isolated git worktree; only verified proposals reach the admin Apply button. |
| R30–R31 | Cost-Tracking Monkey-Patch | Wrapped the `replitOpenai` singleton so 100+ legacy call sites became metered without source edits. |
| R32 | Minerva — Chief Planner | 15th persona — Strategic Plan Architect for multi-step task decomposition. |
| R34 | Internal Event Resolver | CAS-overlay finalizes every `event_log` entry into one of 5 terminal statuses with 30-second watchdog scanning for orphans. |
| R35 | Cost-Telemetry Parity | New `createMeteredOpenAIClient` factory wraps chat, embeddings, TTS, and Whisper so every byte across the OpenAI billing boundary is visible in the agent ledger. |

---

## Current platform totals

**395 tools · 143 skills · 16 personas · 212 tables · 623 production indexes · 129 active capabilities · 41 governance rules · 45 curated AI models in the core registry plus daily catalog discovery against 1000+ models on OpenRouter · ~320k LOC across 1,100+ TypeScript files.** ([authoritative counts](docs/CURRENT_PLATFORM_TOTALS.md))

Single source of truth: [docs/CURRENT_PLATFORM_TOTALS.md](docs/CURRENT_PLATFORM_TOTALS.md).

---

## How to influence the roadmap

- ⭐ Star the [public release](https://github.com/Huskyauto/VisionClaw-Agent-Public-Release) — it tells us the direction is right.
- Open an issue using one of the templates (bug, feature, new tool).
- Open a PR — see [CONTRIBUTING.md](CONTRIBUTING.md). We merge thoughtful, tested, focused changes quickly.
- Sponsor — see `.github/FUNDING.yml`. Direct funding speeds things up enormously for a solo-maintained project.

— Robert "Bob" Washburn · [Your Company] · huskyauto@gmail.com
