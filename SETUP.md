# VisionClaw Agent Platform — Fork Setup Guide

Welcome! You've forked the **VisionClaw Agent Platform**, a multi-tenant agentic AI corporation platform built by [Your Company]. This guide will walk you through getting your own instance running.

---

## Quick Start (5 Minutes)

### 1. Database

Your Replit fork comes with a **PostgreSQL database** automatically provisioned. The `DATABASE_URL` environment variable is set for you — no action needed.

On first run, the app will automatically:
- Create all 154 tables
- Build 280 production indexes
- Seed 40 governance rules
- Initialize 16 AI personas
- Set up 5 nightly autoresearch programs

> Authoritative counts: see [docs/CURRENT_PLATFORM_TOTALS.md](docs/CURRENT_PLATFORM_TOTALS.md).

### 2. Required Secrets

Open the **Secrets** tab (lock icon in the left sidebar) and add these:

| Secret | How to Get It | Why It's Needed |
|--------|--------------|-----------------|
| `SESSION_SECRET` | Run `openssl rand -hex 32` in the Shell | Encrypts sessions and passwords |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Primary AI provider |
| `ADMIN_PIN` | Pick any 4+ digit number you'll remember | Gates `/admin/*` routes (admin operations, proposed-skills review, A/B run results) — without it, admin pages refuse to load |

That's it — with these three secrets, the platform boots, you can chat with all 16 AI personas, and you can reach the admin surfaces.

> **`ENABLE_SELF_PUSH`** (optional, advanced) — leave **unset** unless you want this fork to auto-push commits to your own GitHub remote. The two background workflows (`Auto Git Push`, `Public Mirror Push`) refuse to push without `ENABLE_SELF_PUSH=1`, so a fresh fork stays read-only by default.

### 3. Run

Click the **Run** button or use the Shell:

```bash
npm run dev
```

The app starts on port 5000. You'll see a full startup log confirming all subsystems are online.

---

## Optional Secrets (Add as Needed)

These unlock additional capabilities. The platform works without them — features that need a missing key will gracefully degrade or show a clear message.

### AI Providers

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) | Claude models (Sonnet, Opus, Haiku) |
| `XAI_API_KEY` | [x.ai](https://x.ai/) | Grok-3, Grok-3 Mini |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai/) | DeepSeek, Llama, Qwen, MiniMax, 20+ models |

The platform has **cost-aware auto-routing** — it will always prefer free/cheap providers before paid ones. If you have Replit's AI integrations installed (OpenAI, Anthropic, Gemini), those are used at $0 cost to you.

### Services

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `BROWSERLESS_API_KEY` | [browserless.io](https://www.browserless.io/) | PDF generation, browser automation |
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io/) | Text-to-speech (23 voices) |
| `FIRECRAWL_API_KEY` | [firecrawl.dev](https://firecrawl.dev/) | Web scraping and crawling |

### Payments

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `STRIPE_LIVE_SECRET_KEY` | [dashboard.stripe.com](https://dashboard.stripe.com/) | Subscriptions, invoicing |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | Same as above | Frontend Stripe integration |
| `COINBASE_COMMERCE_API_KEY` | [commerce.coinbase.com](https://commerce.coinbase.com/) | Crypto payments |
| `COINBASE_COMMERCE_PROJECT_ID` | Same as above | Coinbase project identifier |
| `COINBASE_CDP_API_KEY_ID` | Same as above | Coinbase Developer Platform |

### X/Twitter

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `X_API_KEY` | [developer.x.com](https://developer.x.com/) | 9 native X/Twitter tools |
| `X_API_SECRET` | Same as above | API authentication |
| `X_ACCESS_TOKEN` | Same as above | Post, like, retweet, search |
| `X_ACCESS_TOKEN_SECRET` | Same as above | OAuth 1.0a signing |

### Communications

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `DISCORD_BOT_TOKEN` | [discord.com/developers](https://discord.com/developers/) | Discord bot integration |
| `TELEGRAM_BOT_TOKEN` | [@BotFather on Telegram](https://t.me/BotFather) | Telegram bot integration |

### YouTube

| Secret | Service | What It Unlocks |
|--------|---------|----------------|
| `YOUTUBE_CLIENT_ID` | [console.cloud.google.com](https://console.cloud.google.com/) | YouTube OAuth integration |
| `YOUTUBE_CLIENT_SECRET` | Same as above | YouTube API access |

### Admin & Operations

| Secret | What It Does |
|--------|-------------|
| `ADMIN_PIN` | PIN for admin operations (set any 4+ digit number) |
| `OWNER_NAME` | Your name (used in PDF headers/footers) |
| `OWNER_EMAILS` | Your email (for automated reports) |
| `ADMIN_ALERT_EMAIL` | Email for system alerts |
| `PRODUCTION_DOMAIN` | Your published domain (for QR codes, links) |
| `GITHUB_TOKEN` | GitHub PAT for automated code pushes |

---

## Replit Integrations (Recommended)

Replit has built-in integrations that provide API access at no extra cost. Install these from the **Integrations** panel:

- **OpenAI** — Free GPT-4.1, GPT-5 Mini access
- **Anthropic** — Free Claude access
- **Gemini** — Free Gemini 3 Flash, 3.1 Pro access
- **Google Drive** — File storage and sharing
- **Google Sheets** — Spreadsheet operations
- **Google Calendar** — Calendar sync
- **Google Mail** — Email via Gmail
- **Stripe** — Payment processing
- **ElevenLabs** — Text-to-speech

When Replit integrations are installed, they're used automatically — you don't need separate API keys for those services.

---

## What You Get

### 16 AI Personas
Each persona is specialized for different corporate functions:

| ID | Name | Specialty |
|----|------|-----------|
| 1 | VisionClaw | General AI Assistant |
| 2 | Felix | CEO — Strategy, orchestration, presentations |
| 3 | Forge | Staff Engineer — Code, architecture |
| 4 | Teagan | Content Marketing — Social, brand |
| 5 | Agent Blueprint | Multi-Agent Systems — Orchestration |
| 6 | Chief of Staff | Operations — Admin, scheduling |
| 7 | Scribe | Content Creator — Writing, reports |
| 8 | Proof | Content Reviewer — QA, editing |
| 9 | Radar | Intelligence Analyst — Competitive intel |
| 10 | Neptune | Deep Research — Academic analysis |
| 11 | Apollo | Revenue Manager — CRM, sales pipeline |
| 12 | Atlas | Metrics Analyst — KPI, dashboards |
| 13 | Cassandra | CFO — Financial strategy, P&L |
| 14 | Luna | Legal & Compliance — Contracts, regulatory |
| 15 | Minerva | Strategic Plan Architect — Multi-step planning, decision-theory |

### 243 Agentic Tools
Organized across 20+ categories: business operations, CRM, research, document production, social media, browser automation, competitive intelligence, lead pipeline, legal, finance, and more.

### Key Features
- **Autonomous Self-Correcting Agents** — Outcome Completion Gate detects and rebuilds incomplete responses
- **Auto-Skill Capture** — Agents learn from successful orchestrations automatically
- **Agent Board** — Real-time visibility into all agent activity at `/agent-board`
- **Multi-Layer Delegation** — Up to 5 levels of agent-to-agent delegation
- **40 Governance Rules** — Process governor for all agent operations
- **Cost-Aware Model Routing** — Automatically picks the cheapest capable model
- **Multi-Tenant** — Full data isolation, BYOK (Bring Your Own Key) support
- **Document Pipeline** — PDFs, Slides, Spreadsheets, Videos with branded templates

---

## Architecture Overview

```
Frontend (React 18 + Vite)
  └── shadcn/ui + TailwindCSS + Framer Motion
  └── Wouter routing + TanStack Query v5

Backend (Express.js + TypeScript)
  └── Drizzle ORM → PostgreSQL (154 tables)
  └── SSE streaming for real-time responses
  └── 16 AI personas with semantic tool routing
  └── Multi-provider model routing (OpenAI, Anthropic, Gemini, xAI, OpenRouter)

Infrastructure
  └── Heartbeat Engine (health monitoring)
  └── Auto-Tuner (24h optimization cycles)
  └── Stability Watchdog (auto-remediation)
  └── Agent Channels (request multiplexing)
```

---

## Customization

### Change the Company Branding
Update these locations:
- `client/src/pages/landing.tsx` — Landing page content, company name, stats
- `server/pdf-create.ts` — PDF cover page branding, logo, footer
- `data/visionclaw-logo.png` — Replace with your logo

### Add a New AI Persona
1. Insert a new row into the `personas` table via SQL
2. The persona automatically gets access to all tools
3. Customize tool access via the `persona_tool_access` table

### Add a New Tool
1. Add the tool definition to `server/tools.ts` in `TOOL_DEFINITIONS`
2. Add the execution handler in `server/tool-router.ts` in `executeTool()`
3. Run `sync_personas` to update all personas with the new tool

### Add a Governance Rule
```sql
INSERT INTO governance_rules (rule_name, category, description, enforcement_level, rule_config)
VALUES ('your_rule', 'operations', 'Description', 'strict', '{}');
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| App won't start | Check that `DATABASE_URL` and `SESSION_SECRET` are set |
| "No AI provider available" | Add at least one AI provider key (OpenAI recommended) |
| PDF generation fails | Add `BROWSERLESS_API_KEY` |
| Port 5000 in use | The app auto-retries 5 times with self-healing; restart if needed |
| Database migration error | The app auto-creates tables on startup — just restart |
| Empty AI responses | Check your API key is valid and has credits |

---

## Deployment

The app is configured for Replit Autoscale deployment:

```toml
[deployment]
deploymentTarget = "autoscale"
run = ["npm", "run", "start"]
build = ["npm", "run", "build"]
```

Click **Publish** in the Replit workspace to deploy. The platform handles TLS, health checks, and scaling automatically.

---

## Support & Links

- **Production Instance**: [agenticcorporation.net](https://agenticcorporation.net)
- **GitHub**: [github.com/Huskyauto/VisionClaw-Agent](https://github.com/Huskyauto/VisionClaw-Agent)
- **Built by**: [Your Company]

---

*© 2026 [Your Company]. All rights reserved.*
