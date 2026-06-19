# Features — Full Capability Matrix

The slim README at the project root tells the wedge story. This document is
the encyclopedia: every subsystem, every tool category, every persona.

For the **literal list of all 392 tools by name** and **all skills by name**,
see the auto-generated `VisionClaw-Comprehensive-Features.txt` (regenerated
each release pass; the latest is also uploaded to Google Drive and emailed to
the owner).

---

## Platform Stats (June 17, 2026 — Round R125+52)

> Authoritative live counts: [docs/CURRENT_PLATFORM_TOTALS.md](CURRENT_PLATFORM_TOTALS.md).

| Metric | Value |
|---|---|
| Specialist AI agents (personas) | 16 |
| Enterprise tools | 392 |
| Glasses gateway endpoints | 3 (`/v1/glasses/{health,tools,execute}`) |
| Voice-safe tool allowlist | 20 (admin scope unlocks all 392) |
| AI models available via routing | 41+ curated (plus 1000+ daily OpenRouter catalog) |
| Governance rules | 41 |
| Operation scaffolds | 75 |
| Corporate departments | 12 |
| Cross-department workflows | 7 |
| Database tables | 198 |
| Database indexes | 581 |
| Agent skills | 133 |
| Server modules | 194 |
| Client pages | 50+ |
| Autonomy level | ~95% end-to-end |

---

## The 16-Agent Team

| ID | Persona | Role |
|---:|---|---|
| 1 | VisionClaw | CEO — strategic oversight, delegation, vision |
| 2 | Felix | COO — orchestration, multi-agent coordination, DAG decomposition |
| 3 | Forge | Staff Engineer — code execution, infrastructure, security |
| 4 | Teagan | Content Marketing Specialist — social, content calendar |
| 5 | Agent Blueprint | Innovation — skill creation, tool learning, self-improvement |
| 6 | Chief of Staff | Operations Director — system health, scheduling, daily notes |
| 7 | Scribe | Content Creator — writing, editing, SEO, long-form |
| 8 | Proof | Content Reviewer — QA, proofreading, fact-checking |
| 9 | Radar | Intelligence Analyst — market intel, competitive analysis |
| 10 | Neptune | Deep Research Specialist — academic analysis, multimedia |
| 11 | Apollo | Revenue & Pipeline Manager — outreach, lead qualification |
| 12 | Atlas | Metrics & Reporting Analyst — dashboards, visualization |
| 13 | Cassandra | CFO — budgets, forecasting, P&L, financial modeling |
| 14 | Luna | Legal & Compliance Officer — contracts, regulatory review |
| 15 | Minerva | Strategic Plan Architect — multi-step planning, decision support |
| 16 | Robert | Wellbeing Coach — empathy, mindfulness support |

---

## Tool Categories

_Authoritative live total is in [docs/CURRENT_PLATFORM_TOTALS.md](CURRENT_PLATFORM_TOTALS.md). The per-category sample below is illustrative from an earlier release._

### Communication & Outreach
Email send/poll, X/Twitter post/listen/reply/like/retweet, voice synthesis,
inbox routing per tenant.

### Research & Intelligence
`readability_extract` (zero-cost article extraction), `template_scrape`
(LLM-Scraper-style with graduation), `template_scraper_stats`, deep web
search, Firecrawl crawl, Wikipedia/news search, citation extraction.

### Document Production
PDF generation (Browserless HTML→PDF, dark gradient cover pages, branded
sections), DOCX, slide decks, spreadsheets, contract drafting, invoice
generation.

### Memory & Knowledge
Vector search (pgvector), knowledge entry CRUD, memory linking, persona
memory, dialectic user modeling (Hermes-inspired), proactive knowledge
nudges.

### Business Operations (22 tools)
Invoicing, expense tracking, CRM/pipeline management, contracts, KPIs,
financial reporting, CRM contact graph.

### Code & Execution
Sandboxed code execution, file read/write, git ops (push with secret-scan),
process supervision.

### Multi-Agent Orchestration
DAG decomposition, sub-agent spawning, lean swarm with adaptive escalation,
delegation contracts, completion gate, deliverable routing.

### Skills & Self-Improvement
Skill registration, auto-skill capture from successful orchestrations,
pattern graduation (3+ reuses → permanent), skill seeker / auto tool builder
with 5-layer safety gate.

### Ideation & Innovation
Brainstorming frames, design exploration, mockup sandbox, canvas integration.

### Legal & Compliance
Contract review, NDA generation, regulatory checks, terms drafting.

### User Modeling & Adaptation
Per-tenant preference learning, dialectic update of user model from
conversation evidence.

### Finance & Market Data
Stock quotes, watchlists, market context retrieval, Cassandra-driven P&L
modeling.

### Google Workspace
Drive upload-and-share, Sheets read/write, Calendar event CRUD, Mail send.

### Agentic Infrastructure
Self-heal supervisor (`self_heal`, `self_heal_log`, `self_heal_inspect`),
heartbeat watchdog, health monitor, atomic state recovery (JSONB-concat
merge), revenue-vs-cost auto-throttle.

### Background Processing
Queue-backed long-running tasks, scheduled cron-like operations, async
sub-agent runs.

### System & Administration
Tenant management, persona/skill config (admin-gated), API key issue/revoke,
audit log inspection, delivery status (admin-only — see Round 14 IDOR fix in
[`SECURITY.md`](./SECURITY.md)).

### Glasses Gateway (Round 20 / 20.1, new)
Three public endpoints under `/v1/glasses/*` that let a forked Android client
stream Meta Ray-Ban smart-glasses audio + camera frames into Gemini Live and
have Gemini call VisionClaw tools over HTTPS. Bearer auth via the existing
API-key system (`chat` scope = 20-tool voice-safe allowlist; `admin` scope =
all 392). Per-API-key rate limit (60/min total, 4/min for heavy tools like
`deep_research`). Tenant IDOR closed by stripping every client `_*` field and
re-injecting auth-context `_tenantId` / `_apiKeyId` server-side before
executor dispatch. Setup guide for Bob's hardware in
[`docs/glasses-integration.md`](./glasses-integration.md).

---

## Autonomous Operation Features

### 3-Layer Failure Recovery
On tool failure: classify error → pick fix strategy → retry. Cap of 20 heal
attempts per tenant per hour. If a tool is missing, Skill Seeker researches
GitHub/npm and auto-builds it through the 5-layer safety gate.

### Auto Tool Builder (5-Layer Safety Gate)
Every auto-built tool passes:
1. Trusted-domain allowlist
2. Code scanner (25+ patterns)
3. Prompt-injection detector
4. LLM security review
5. Three-tier trust scoring

### Heartbeat Watchdog
60s sweep auto-clears stalled runs and expired approvals. Chief of Staff
stability check every 10 minutes.

### Health Monitor
300s interval across 6 critical subsystems (DB, providers, sessions, tokens,
queues, storage).

### Service Fulfillment Pipeline (Round 13)
Default-OFF auto-ship per SKU. Manual review queue at `/admin/service-orders`
with PDF embedded for proofread + Approve & Ship button. Auto-graduation
after N consecutive clean ships. Snap-back-on-broken: any failed link
verification flips auto-ship OFF and requires a fresh streak.

### Zero-Cost Web Extraction (Round 13.1)
- `readability_extract`: Mozilla Readability.js, no LLM cost.
- `template_scrape`: first call asks an LLM to write a CSS-selector recipe
  matching the requested schema. Recipe cached per-domain+schema-hash.
  Graduates to deterministic cheerio after 3 successful runs at ≥50% field
  coverage. Snap-back when coverage drops.
- Per-tenant scoping, async mutex on cache RMW, layered SSRF defense,
  recipe-shape validator, 5MB streaming response cap.

### Public Storefront (Round 12)
Anonymous-accessible at `/store`. SKU-based Stripe Checkout.
Customer-facing order page at `/orders/:sessionId` is a capability URL with
masked email (`b***@gmail.com`) — never leaks raw PII. Rate-limited
(30/min) keyed off TCP socket source so spoofed `X-Forwarded-For` can't
bypass.

### Self-Healing Resilience (April 17 round)
Atomic state recovery via JSONB-concat merge on parallel runs. Pattern
graduation extracts reusable skills from successful multi-tool sequences.

### Interrupt / Resume + Confidence
- `request_approval`: agents pause before risky actions, owner decides,
  agent auto-resumes.
- `commit_decision`: self-scores confidence 0–1; auto-escalates if below
  threshold or irreversible.

### Revenue vs Cost Self-Regulation
`revenue_vs_cost` dashboard + auto-throttle that downgrades away from
premium models when burn ratio exceeds 0.5. Full per-tool cost ledger with
12-model pricing table.

---

## Technical Architecture

### Frontend
React + Vite + Tailwind + shadcn/ui. TanStack Query for server state.
Wouter for routing. Single-port served by Express in production.

### Backend
Express + TypeScript on Node 20+. Single-port deploy (API + frontend on
same port). 194 server modules.

### Database
PostgreSQL 14+ with pgvector. Drizzle ORM. 198 tables, 581 production
indexes. Messages table has direct `tenant_id` column.
Personas shared globally with per-tenant naming via `tenant_persona_names`.

### AI Model Routing
Tier-based selection (`fast` / `balanced` / `premium`) with provider
failover via `executeWithFailover`. 41+ curated models across OpenAI, Anthropic,
Google, xAI, OpenRouter.

### Memory Architecture
pgvector embeddings + structured memory entries. Per-persona memory with
cross-persona links. Auto-archive of stale entries.

### Infrastructure
Replit primary, Docker (multi-stage non-root) and bare-metal supported.
See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## Pricing (productized services)

| Tier | Price | What you get |
|---|---|---|
| Free Trial | $0 | 5 conversations, full tool access |
| Pay-Per-Task | from $0.50 | Smoke-test SKU through $49 Custom AI Research Report |
| Enterprise | Contact | Dedicated tenant, custom SKUs, SLA |

Live storefront: [agenticcorporation.net/store](https://agenticcorporation.net/store)

---

## Repository Structure

```
client/         # React/Vite frontend
server/         # Express backend (194 modules)
shared/         # Schema + types shared FE/BE
tests/          # Security & tenant-isolation tests (CI hard gate)
scripts/        # Round-by-round verification scripts + post-edit pipeline
docs/           # This documentation
.github/        # CI workflows (build + security-tests are hard gates)
.local/         # Replit-managed skills, plans, metadata
.agents/        # User-authored agent skills
project-assets/ # Sellable single-file deliverables (password gen, etc.)
uploads/        # Tenant-scoped uploads + service-review queue
```
