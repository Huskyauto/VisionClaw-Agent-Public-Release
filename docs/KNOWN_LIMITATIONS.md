# Known Limitations

VisionClaw Agent is solo-maintained, ambitious, and improving fast — but it's
honest about what it doesn't yet do well. This page exists so you can decide
whether to fork, contribute, or wait.

Last reviewed: April 24, 2026 (Round 74).

---

## Setup & deployment

- **No managed/hosted version.** Every fork runs on its own infrastructure.
  We do not offer shared hosting or a managed cloud. The live demo at
  [agenticcorporation.net](https://agenticcorporation.net) is a single-tenant
  showcase, not a SaaS.
- **Postgres + pgvector is required.** The platform will not boot against
  vanilla Postgres without the pgvector extension. Render, Railway, Neon,
  and Replit Postgres all support it; AWS RDS requires the right extension
  flag at provision time.
- **One-click deploy buttons are partial.** Replit works. Render and Railway
  buttons are present but you may need to add the env vars manually after
  the first deploy succeeds. See [QUICKSTART_LOCAL.md](QUICKSTART_LOCAL.md).
- **No automated migrations on schema upgrades.** The codebase uses
  `psql $DATABASE_URL` direct ALTER TABLE for production-shaped data
  changes rather than `drizzle-kit push`. If you fork at one round and
  pull a later round, you may need to manually apply schema changes.

## AI provider behavior

- **Cost ledger is approximate, not authoritative.** Provider invoices are
  the source of truth. The ledger is accurate to within ~5–10% in our
  testing, but exchange-rate timing, retry overhead, and partial-stream
  aborts can cause drift.
- **Cost-aware routing is best-effort.** The router prefers cheaper
  providers but will fall back to whatever is healthy. If you have a
  strict budget, set per-tenant caps in the cost ledger and monitor.
- **Daily catalog discovery (R73) is OpenRouter-only.** We don't yet scan
  Anthropic, Google, or OpenAI for new model releases — those still
  require manual registry updates.
- **No local-first model routing yet.** Ollama and llama.cpp tier ahead
  of cloud providers is on the backlog. Today, every LLM call goes to a
  cloud provider.

## Tools and tool execution

- **No formal tool-permission UI.** Permission levels are declared in code
  (`server/tool-router.ts`) but there is no per-tenant admin screen for
  toggling individual tool access yet. The skills marketplace has a
  per-tenant disable list; tools do not.
- **No undo for high-risk tool calls.** Once a `send_email` succeeds, the
  email is sent. The Trust Engine + human approval queue mitigates this
  for the highest-risk calls, but lower-risk calls (e.g. `update_customer`)
  do not auto-create a snapshot for rollback.
- **Some tools are no-ops without their key.** They return a clear "not
  configured" message instead of failing — intentional graceful
  degradation — but a fresh agent may attempt them once before the
  router learns to skip them.

## Multi-agent orchestration

- **Up to 5 levels of agent-to-agent delegation** before the depth guard
  kicks in. Most real workflows are 2–3 levels; 5 is a hard ceiling.
- **No cross-instance agent bus.** All agents in a deployment share the
  same database. Cross-tenant or cross-instance message bus over
  SSE/WebRTC is on the backlog.
- **The orchestrator can over-fan-out on ambiguous prompts.** A request
  like "do everything you can to grow my business" can spawn 6+ subagents
  in parallel. Set per-tenant cost caps to make this safe to leave running.

## Data and storage

- **Google Drive is the primary file store.** Without `GOOGLE_DRIVE_*`
  configured, files are written to local `./uploads/` instead. On
  Replit Deployments, local files do not persist across deploys — Drive
  is strongly recommended for production.
- **No automated test data fixtures.** A fresh fork starts empty. There
  is no `seed --demo` flag that populates a sample tenant with conversations,
  invoices, and a project.

## Frontend

- **Mobile is functional but not optimized.** Responsive breakpoints
  exist for every page, but the agent board, agent diagram, and code-
  proposals views assume desktop width.
- **No offline mode.** Lose your network connection mid-conversation
  and you'll need to refresh.
- **40+ pages, 1 maintainer.** Some less-used pages (e.g.
  `/agent-board/legacy`) are not regularly QA'd. Open an issue if you
  hit a broken page.

## Documentation

- **API docs are not yet generated.** OpenAPI / Swagger spec for the
  300+ HTTP endpoints is in progress (see [ROADMAP.md](../ROADMAP.md)).
  Today, the source of truth is `server/routes.ts` itself.
- **No demo video yet.** The README has screenshots but no walkthrough
  video showing intake → execution → delivery. On the next-up list.
- **Some setup docs lag the code.** We try to keep
  [CURRENT_PLATFORM_TOTALS.md](CURRENT_PLATFORM_TOTALS.md) accurate as
  the single source of truth; report any mismatch as a docs bug.

## Security

- **No SOC 2, HIPAA, or PCI compliance certification.** This is a self-
  hosted open-source platform. If you process regulated data, you are
  responsible for the compliance posture of your deployment.
- **Backup/restore does not include credentials.** This is intentional
  (see [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md)) — a restored
  deployment requires you to re-enter API keys.
- **No HSM/KMS integration.** Encryption keys are derived from
  `SESSION_SECRET`. For higher-assurance deployments, use disk-level
  encryption and rotate `SESSION_SECRET` only during planned maintenance.

## Roadmap pointers

For what's actively being worked on, see [ROADMAP.md](../ROADMAP.md).
For what's already shipped, see the same file's "Recently Shipped" section.

---

If something on this page blocks you from using VisionClaw, please open an
issue with the **"Limitation report"** label. Honest feedback shapes the
roadmap.

— Robert "Bob" Washburn · huskyauto@gmail.com
