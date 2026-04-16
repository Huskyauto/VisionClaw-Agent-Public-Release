# VisionClaw Agent

### Open-Source Multi-Tenant AI Agent Workspace — Documents, Research & Workflows

**Built for agencies, operators, and founders who want an always-on AI operations team they own and host themselves.**

**Created by Robert Washburn** | huskyauto@gmail.com

---

## What Is This?

VisionClaw Agent is an open-source, multi-tenant AI platform where 14 specialized agents work together to produce real deliverables — research reports, legal documents, financial models, marketing campaigns, slide decks, spreadsheets, and PDFs.

Instead of a single chatbot, you get a full agent workforce. Give it a task. The right agent picks it up, selects the right tools, coordinates with other agents when needed, and delivers a finished result. Every decision is traceable, every action is governed, and every integration degrades gracefully when not configured.

**Fork it. Configure your API keys. Deploy. You have an AI operations team.**

**The app runs with just one LLM key and a Postgres database.** Everything else — email, payments, voice, Drive — is optional and appears automatically when you add the key.

Over 129k lines of TypeScript. 40+ pages. 195+ tools. 37+ AI models. 6 providers.

<p align="center">
  <img src="docs/images/screenshot-home.jpg" alt="VisionClaw Landing Page" width="800" />
</p>
<p align="center"><em>Landing page with live agent activity feed and command center stats</em></p>

<p align="center">
  <img src="docs/images/screenshot-setup.jpg" alt="VisionClaw Setup Dashboard" width="800" />
</p>
<p align="center"><em>First-run setup dashboard — real-time status of every integration</em></p>

---

## Try These Prompts

Once you're set up, paste any of these into the chat to see the platform in action:

| Prompt | What Happens |
|--------|-------------|
| "Research the top 5 competitors in [your industry] and build me a comparison spreadsheet" | Radar researches, Atlas structures data, exports a formatted .xlsx to Google Drive |
| "Draft a professional proposal for [client name] based on our last conversation" | Scribe pulls context from memory, writes a styled PDF, Proof reviews it for quality |
| "Analyze this contract for risks" *(attach a PDF)* | Luna scans for 20 risk patterns across 9 regulatory frameworks, scores compliance |
| "Create a weekly content calendar for our social media" | Teagan builds a structured plan with post ideas, hashtags, and optimal timing |
| "Give me a financial forecast for Q3 based on current revenue trends" | Cassandra models projections, generates charts, delivers an executive summary |
| "What happened in AI news this week?" | Neptune runs a deep research sweep across arXiv, HN, Reddit, and tech blogs |

---

## Platform at a Glance

| Metric | Count |
|--------|-------|
| AI Agents (Personas) | 14 |
| Built-in Tools | 195+ |
| AI Models Supported | 37+ |
| AI Providers | 6 (OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity) |
| Governance Rules | 40 |
| Corporate Operation Scaffolds | 75 |
| Corporate Departments | 12 |
| Agent Skills | 61 |
| Frontend Pages | 40+ |
| API Endpoints | 300+ |
| Database Tables | 113 |

---

## How It Works

```
  User Request
       │
       ▼
┌──────────────────┐     ┌─────────────────────────────┐
│   Chat Engine    │────▶│   Agent Router              │
│  (SSE streaming) │     │   picks best agent for task  │
└──────────────────┘     └──────────┬──────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │  Felix   │  │  Forge   │  │ Neptune  │  ... 14 agents
              │  (CEO)   │  │ (Eng)    │  │(Research)│
              └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │              │
                   ▼             ▼              ▼
            ┌─────────────────────────────────────────┐
            │          195+ Tools                     │
            │  Search · Write · Build · Analyze ·     │
            │  Email · Pay · Generate · Research       │
            └──────────────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
        ┌──────────┐   ┌────────────┐   ┌────────────┐
        │ PostgreSQL│   │ Google     │   │ 6 AI       │
        │ + pgvector│   │ Drive      │   │ Providers  │
        │ 113 tables│   │ Storage    │   │ 37+ models │
        └──────────┘   └────────────┘   └────────────┘
```

**Example flow:** You say "Research competitor pricing and build me a comparison spreadsheet."
1. The **Chat Engine** routes to **Felix** (CEO) who sees this needs research + document production
2. Felix spawns **Radar** (Intelligence) to research competitors and **Atlas** (Metrics) to structure the data
3. Radar uses web search and scraping tools, deposits findings into the knowledge base
4. Atlas pulls findings, builds a formatted Excel spreadsheet, uploads to Google Drive
5. You get back a summary with a download link — no manual steps

---

## The 14-Agent Team

Every agent has a defined role, personality, skill set, and operating rules. They work independently or collaborate through orchestration engines.

| Agent | Role | What They Do |
|-------|------|-------------|
| **VisionClaw** | Personal Assistant | Default conversational agent — handles general tasks, delegates complex ones |
| **Felix** | CEO / COO | Revenue strategy, task orchestration, multi-agent DAG decomposition |
| **Forge** | Staff Engineer | Code execution, engineering standards, infrastructure, security review |
| **Teagan** | Content Marketing | Social media strategy, content calendars, brand voice, ad copy |
| **Blueprint** | Innovation Lead | Skill creation, tool learning, self-improvement, capability expansion |
| **Chief of Staff** | Operations Director | System health monitoring, task routing, scheduling, daily operations |
| **Scribe** | Content Creator | Long-form writing, editing, SEO content, documentation, blog posts |
| **Proof** | Quality Reviewer | Proofreading, fact-checking, QA, content review, accuracy scoring |
| **Radar** | Intelligence Analyst | Market intelligence, competitive analysis, trend tracking, OSINT |
| **Neptune** | Deep Research | Academic analysis, overnight autonomous research, multimedia deep dives |
| **Apollo** | Revenue & Pipeline | Sales outreach, lead qualification, pipeline management, CRM |
| **Atlas** | Metrics & Reporting | Analytics, dashboards, KPI tracking, data visualization |
| **Cassandra** | CFO | Budgets, forecasting, P&L modeling, financial analysis |
| **Luna** | Legal & Compliance | Contract review, regulatory compliance, risk assessment, legal drafting |

---

## Feature Overview

### AI & Intelligence

- **37+ AI Models** with cost-aware auto-routing across OpenAI, Anthropic, Google Gemini, xAI Grok, OpenRouter, and Perplexity
- **Subscription-First Routing** — connect your existing ChatGPT Plus or Gemini Advanced subscription via OAuth to use for inference at $0 API cost
- **Streaming Responses** via Server-Sent Events (SSE) — real-time token-by-token output
- **Thinking Mode** — explainable reasoning with decision traces for complex problems
- **Model Failover** — automatic fallback to healthy providers when one goes down
- **Context Window Management** — automatic conversation compaction that preserves every fact before summarizing

### Document & Content Production

- **PDF Reports** — executive-quality styled PDFs with cover pages, branded headers/footers, charts, and tables
- **Word Documents (.docx)** — professional documents with formatting, headers, and styles
- **Excel Spreadsheets (.xlsx)** — auto-formatted workbooks with formulas and conditional formatting
- **Google Slides** — automated presentation generation delivered to Google Drive
- **Charts & Diagrams** — Recharts visualizations and Mermaid.js diagrams rendered to PNG
- **PDF Form Filling** — fill existing PDF forms programmatically
- **Invoices** — professional invoices with line items, taxes, and branding

### Research & Intelligence

- **Autonomous Overnight Research** — configurable research programs that run autonomously, with LLM-judged experiment scoring and auto-deposit of findings into your knowledge base
- **Web Search** — powered by Perplexity with Wikipedia and Jina fallbacks
- **Deep Web Scraping** — Firecrawl integration for full-site crawling and markdown extraction
- **Trend Research** — parallel scanning across Reddit, Hacker News, Polymarket, and X/Twitter
- **Competitive Intelligence** — automated competitor analysis with structured output

### Memory & Knowledge

- **Semantic Memory Palace** — hierarchical memory organized by Wing and Room with three-tier recall (Hot/Warm/Cold)
- **Zero-Loss Compaction** — full pre-compaction transcripts archived and recoverable; every fact extracted before conversation summarization
- **Vector Knowledge Base** — RAG-powered knowledge retrieval with MMR diversity re-ranking
- **Temporal Knowledge** — subject-predicate-object facts with time validity tracking
- **Dialectic User Modeling** — three internal agents (Deriver, Dialectic, Dreamer) progressively build a profile of each user from conversations

### Multi-Agent Orchestration

- **Crews** — agent teams with defined roles, goals, and backstories working toward a shared objective
- **Flows** — event-driven workflow pipelines that chain agent actions
- **Minds** — 4-role deliberation system (Proposer, Critic, Synthesizer, Judge) for complex decisions
- **Auto-Orchestration** — the COO automatically decomposes complex requests into DAG task graphs and delegates to specialists
- **Subagent Spawning** — agents can spawn child agents for sub-tasks with full tool access
- **Chain of Debates** — multi-persona deliberation where 3-6 specialists argue complex questions from different perspectives

### Communication & Integrations

- **Email** — built-in email server with tenant-specific inboxes, send/reply, and notification handling
- **WhatsApp** — full bot integration for sending/receiving messages and approval workflows
- **Telegram** — bot integration for external interaction
- **Discord** — bot integration for team communication
- **Google Workspace** — Gmail, Calendar, Sheets, Docs, Slides, and Contacts integration
- **Google Drive** — primary storage for generated deliverables; every project gets a dedicated Drive folder with automatic backup

### Payment Processing

- **Stripe** — subscription management, checkout sessions, usage billing, and customer portal
- **Stripe Connect** — tenants can connect their own Stripe accounts for white-label payment processing
- **Coinbase Commerce** — cryptocurrency payments via hosted checkout
- **Coinbase CDP** — on-chain wallet management and balance checks
- **Usage Metering** — token tracking and feature access limits tied to billing tiers

### Voice & Media

- **Text-to-Speech** — ElevenLabs integration with 23+ voice profiles
- **Voice Conversations** — real-time voice input/output with configurable wake words
- **Image Generation** — DALL-E and Replit AI image generation
- **Video Production** — scene-based MP4 pipeline with parallel TTS, Ken Burns motion, 25+ transitions, and background music

### Project Management

- **Project Brain** — filing cabinet system linking conversations, files, notes, and Google Drive assets to projects
- **Scheduled Tasks** — cron-like automation for recurring agent work
- **Activity Logging** — comprehensive system-wide activity tracking
- **Agent Board** — visual overview of all agent activities and status

### Governance & Safety

- **40 Governance Rules** — built-in rules controlling agent autonomy and behavior
- **Process Governor** — enforces execution limits and approval requirements
- **Trust Engine** — evaluates safety and reliability of tool calls; high-risk actions require human approval
- **Prompt Injection Scanner** — detects and blocks malicious injection attempts
- **3-Layer Failure Recovery:**
  1. Self-correction retry with adjusted parameters
  2. Lean mode fallback to a lighter model on overload
  3. Backup agent reroute to mapped specialist
  4. 5-part failure transparency (what failed, why, what was tried, what succeeded, what the user should know)
- **Critique Agent** — every response auto-evaluated on accuracy, completeness, relevance, and clarity (scored 1-10); low scores trigger auto-refinement

### Multi-Tenant Architecture

- **Full Tenant Isolation** — each tenant has separate conversations, memory, projects, files, settings, and billing
- **Per-Tenant WhatsApp/Email/Payment** — communication and payment channels isolated by tenant
- **Team Management** — invite users, manage roles, and control access
- **API Keys** — per-tenant API key management for external integrations

### Developer & Admin Tools

- **Settings Dashboard** — comprehensive admin panel with tabs for General, Payments, Integrations, Voice, Tools, Security, Data, and Tenants
- **Diagnostics** — stuck task detection, health monitoring, provider latency testing
- **Heartbeat Engine** — system health monitoring with configurable check intervals
- **Auto-Tuner** — autonomous performance optimization that runs daily
- **Webhook System** — inbound/outbound webhook triggers for external automation
- **MCP Server** — Model Context Protocol server for AI tool integration
- **Backup & Restore** — automated daily backups to Google Drive with manual export/import
- **Vault** — secure credential storage for sensitive data

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Wouter, TanStack Query v5 |
| **Backend** | Express.js, TypeScript, Node.js 20+ |
| **Database** | PostgreSQL with pgvector extension, Drizzle ORM |
| **AI Routing** | OpenAI, Anthropic, Google Gemini, xAI Grok, OpenRouter, Perplexity |
| **Real-time** | Server-Sent Events (SSE) for streaming |
| **Auth** | Email/Password with HMAC-SHA256, Admin PIN, Replit OAuth, Google OAuth |
| **Validation** | Zod schemas with drizzle-zod integration |
| **Security** | Helmet, CSRF protection, rate limiting, injection scanning |
| **File Storage** | Google Drive (primary), local uploads (fallback) |
| **Payments** | Stripe, Coinbase Commerce, Coinbase CDP |
| **Voice** | ElevenLabs TTS (23+ voices) |
| **Search** | Perplexity, Firecrawl, Jina, Wikipedia |

---

## Repository Structure

```
client/                       # React frontend
  src/
    pages/                    # 40+ route pages
    components/               # Reusable UI components (shadcn/ui)
    hooks/                    # Custom React hooks
    lib/                      # Utilities, query client, API helpers
server/                       # Express backend
  chat-engine.ts              # Core AI conversation engine with streaming
  tools.ts                    # 195+ tool definitions and execution handlers
  routes.ts                   # 300+ API endpoints
  site-config.ts              # Centralized env-driven configuration
  seed.ts                     # Database seeding (113 tables, 40 rules, 14 personas)
  heartbeat.ts                # Background task scheduler
  agent-manager.ts            # Autonomous agent orchestration
  subagents.ts                # Hierarchical agent spawning
  agent-channels.ts           # Internal agent messaging system
  google-drive.ts             # Google Drive integration
  stripe-connect.ts           # Stripe payment processing
  coinbase-commerce.ts        # Crypto payment processing
  whatsapp.ts                 # WhatsApp bot integration
  email.ts                    # Email server and tenant inboxes
  scaffolding.ts              # 75 corporate operation scaffolds
shared/
  schema.ts                   # Drizzle ORM schema (113 tables)
scripts/
  clean-for-release.sh        # Sanitize codebase for public release
FORK-SETUP.md                 # Detailed setup instructions
```

---

## Getting Started

### Prerequisites

- **Node.js 20+** (or a Replit account)
- **PostgreSQL** database
- **At least one AI provider API key** (OpenAI, Anthropic, Google, or xAI)

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Huskyauto/VisionClaw-Agent-Public-Release.git
cd VisionClaw-Agent-Public-Release

# 2. Install dependencies
npm install

# 3. Set required environment variables
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export SESSION_SECRET="$(openssl rand -hex 32)"
export OPENAI_API_KEY="sk-..."   # Or ANTHROPIC_API_KEY, XAI_API_KEY, etc.

# 4. Start the platform
npm run dev

# 5. Open your browser
# Visit http://localhost:5000
# Fresh deploys auto-redirect to /setup
```

### What Happens on First Run

In under 10 minutes, you go from `git clone` to a live dashboard with 14 agents, seeded governance, and a `/setup` checklist that tells you exactly what's configured and what's missing.

1. The database auto-creates all 113 tables and 298 indexes
2. 40 governance rules and 14 AI personas are seeded automatically
3. You're redirected to the **Setup Checklist** at `/setup` showing what's configured
4. Click **Create Account** — the first account becomes the admin
5. Start chatting — the AI is ready to work

### Environment Variables

See [FORK-SETUP.md](./FORK-SETUP.md) for the complete list. Here's the quick reference:

#### Required

| Variable | What It Does |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Random string for session encryption |
| One AI key | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, or `OPENROUTER_API_KEY` |

#### Recommended (Branding)

| Variable | What It Does | Default |
|----------|-------------|---------|
| `SITE_PLATFORM_NAME` | Your platform's display name everywhere | `VisionClaw` |
| `SITE_COMPANY_NAME` | Company name for branding | `Your Company` |
| `SITE_OWNER_EMAIL` | Admin contact email | _(empty)_ |
| `SITE_WEBSITE_URL` | Your public URL | _(empty)_ |

#### Optional (Unlock More Features)

| Variable | What It Unlocks |
|----------|----------------|
| `ELEVENLABS_API_KEY` | Voice synthesis (23+ voices, text-to-speech) |
| `FIRECRAWL_API_KEY` | Advanced web scraping and full-site crawling |
| `BROWSERLESS_API_KEY` | PDF generation and browser automation |
| `STRIPE_LIVE_SECRET_KEY` + `STRIPE_LIVE_PUBLISHABLE_KEY` | Payment processing and subscriptions |
| `COINBASE_COMMERCE_API_KEY` | Cryptocurrency payments |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive file storage and backups |
| `AGENTMAIL_API_KEY` + `AGENTMAIL_INBOX` | Email sending/receiving |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration |
| `DISCORD_BOT_TOKEN` | Discord bot integration |
| `X_API_KEY` + `X_API_SECRET` + `X_ACCESS_TOKEN` + `X_ACCESS_TOKEN_SECRET` | X/Twitter posting and search |

---

## Graceful Degradation

Features that aren't configured don't break the app — they gracefully disappear:

| Missing Config | What Happens |
|---------------|-------------|
| No email key | Email, WhatsApp pages hidden from sidebar |
| No Telegram token | Telegram page hidden |
| No Stripe keys | Payments page hidden from admin panel |
| No Drive folder | Files saved locally; Drive tools show "not configured" |
| No ElevenLabs key | Voice tools return "not configured" |
| No Firecrawl/Browserless | Scraping tools fall back gracefully |
| No Coinbase keys | Crypto payment features disabled |
| No OAuth client IDs | OAuth connection buttons hidden |

The `/setup` page gives you a real-time checklist showing exactly what's configured and what's not.

---

## Admin Settings

Once logged in as admin, the **Settings** page (`/settings`) gives you control over everything:

| Tab | What You Configure |
|-----|-------------------|
| **General** | Agent name, personality, default AI model, API keys, OAuth connections, billing |
| **Payments** | Stripe/Coinbase integration, pricing plans, subscription tiers |
| **Integrations** | Discord bot, public chat settings, webhooks, system hooks |
| **Voice** | Wake words, text-to-speech provider, voice profiles |
| **Tools** | Browser/search settings, code sandbox, safety limits, rate limiting |
| **Security** | Access PIN, auth health monitoring |
| **Data** | Backup to Google Drive (manual + automated at 3 AM UTC), export/import |
| **Tenants** | Multi-tenant management for agency deployments |

---

## Pages & Navigation

The platform includes 40+ pages organized by function:

**Core:** Home, Chat, Inbox, Email, Projects, Files, Documents

**AI Management:** Personas, Memory, Knowledge, Skills, Skills Marketplace, Agent Board, Agentic Operations

**Intelligence:** Research, Insights, Content Writing, Scheduled Tasks

**Communication:** WhatsApp, Telegram, Discord (with approval workflows)

**Admin:** Settings, Analytics, Activity Logs, Heartbeat, Team, API Keys, MCP, Webhooks, Channel Routing, Payments

**Public:** Landing Page, Architecture Overview, Login/Signup, Legal Pages (Terms, Privacy, About, Contact, Refund)

---

## Agentic Design Patterns

These are the patterns we actually use in daily production — not just research papers:

1. **Parallel Tool Execution** — read-only tools run concurrently via Promise.all; mutating tools execute sequentially for causal ordering
2. **Critique Agent / Self-Correction** — every response auto-evaluated across 4 dimensions (accuracy, completeness, relevance, clarity); scores below 6/10 trigger auto-refinement
3. **Chain of Debates** — 3-6 specialist agents argue complex questions from their domain expertise; synthesizes a recommendation with consensus level
4. **Tree-of-Thought Reasoning** — 2-5 distinct analytical branches evaluated by a meta-reasoning judge for optimal answers
5. **Auto-Orchestration** — complex requests decomposed into DAG task graphs with dependency tracking and parallel execution
6. **Dialectic User Modeling** — three agents (Deriver, Dialectic, Dreamer) progressively understand user preferences and behavior

---

## Deployment

The platform is designed to run on Replit but works on any Node.js hosting:

- **Replit:** Fork, set secrets in the Secrets panel, hit Run
- **Railway/Render:** Connect your repo, set env vars, deploy
- **Docker:** `docker-compose up -d` — includes PostgreSQL with pgvector, ready out of the box
- **VPS:** Clone, `npm install`, set env vars, `npm run dev`
- **Port:** Serves frontend and backend on a single port (default: 5000)

```bash
git clone https://github.com/Huskyauto/VisionClaw-Agent-Public-Release.git
cd VisionClaw-Agent-Public-Release
cp .env.example .env   # edit with your API keys
docker-compose up -d    # or: npm install && npm run dev
```

---

## About the Name

**VisionClaw Agent** is an independent AI agent platform — not related to the [Intent-Lab/VisionClaw](https://github.com/Intent-Lab/VisionClaw) project (a smart glasses AI assistant for Meta Ray-Ban). This repo is a standalone, self-hosted multi-tenant operations platform. It works with just an LLM provider and PostgreSQL — no external ecosystem required.

---

## Roadmap

Areas under active development:

- **Modularization** — Breaking down large server files (routes, tools) into domain-specific modules for easier navigation and community contribution
- **Type safety** — Incremental migration from `any` types to strict TypeScript interfaces
- **CI/CD** — GitHub Actions pipeline for lint, typecheck, and automated testing
- **Plugin architecture** — Making it easier to add custom tools and agents without modifying core files
- **API documentation** — OpenAPI/Swagger spec for the 300+ endpoints

Community contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT License — free to fork, modify, and deploy for any purpose. See [LICENSE](LICENSE).

---

**Created by Robert Washburn** | huskyauto@gmail.com
