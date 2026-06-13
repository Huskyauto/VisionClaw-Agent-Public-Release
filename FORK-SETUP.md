# VisionClaw Agent — Fork & Deploy Setup Guide

This guide walks you through configuring your own instance of VisionClaw Agent after forking the repository.

> **You must host this yourself.** Every fork runs on its own infrastructure with its own database, API keys, and accounts. We do not provide hosting, shared instances, or access to our production environment. If you are using Replit, you need your own Replit account.

## Fastest path (forking on Replit)

When you fork/remix this Repl, two things behave differently:

1. **Carries over automatically** — everything in `.replit` under `[userenv.shared]`. That includes all `SITE_*` / `OWNER_*` site identity and a large set of API keys already stored there (e.g. GitHub, Google, xAI, YouTube, Perplexity, Camofox, AgentMail, Two-Slides). You do **not** re-enter these.
2. **Does NOT carry over** — the encrypted **Secrets** store. Replit deliberately keeps secrets out of the forkable config, so these need a one-time paste on the new fork.

**One-time secret paste (the turnkey step):** open the fork → **Tools → Secrets → "Edit as .env" → paste the whole bootstrap block → Save.** That single paste restores all live keys (Stripe, Coinbase, OpenAI/Anthropic/OpenRouter, ElevenLabs, GitHub PAT, Google OAuth, Railway, owner email, AI-integration gateway keys, session secret). Ask the owner for the current `fork-bootstrap-secrets` block.

**Do NOT copy these** — the fork auto-provisions its own: `DATABASE_URL`, `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`, `REPL_ID`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`. Pointing a fork at the original's database would mix data.

After the paste, the fork has all setup + secrets and is ready to run. The per-variable reference below documents what each value does.

## Prerequisites

- Your own Replit account (or any Node.js 20+ hosting environment)
- A PostgreSQL database
- At least one AI provider API key (OpenAI, Anthropic, Google, or xAI)

## Step 1: Environment Variables

### Required — Core Platform

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | Random string for session encryption | `openssl rand -hex 32` |

### Required — At Least One AI Provider

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `XAI_API_KEY` | xAI (Grok) API key |
| `OPENROUTER_API_KEY` | OpenRouter API key (access to 100+ models) |

### Recommended — Site Identity

These configure your platform branding, legal pages, and generated documents:

| Variable | Description | Default |
|----------|-------------|---------|
| `SITE_COMPANY_NAME` | Your company name | `Your Company` |
| `SITE_COMPANY_LEGAL` | Legal entity name | `Your Company LLC` |
| `SITE_COMPANY_EIN` | EIN (optional) | _(empty)_ |
| `SITE_OWNER_NAME` | Platform owner name | `Admin` |
| `SITE_OWNER_EMAIL` | Owner contact email | _(empty)_ |
| `SITE_OWNER_PHONE` | Phone number (optional) | _(empty)_ |
| `SITE_LOCATION` | Company location | _(empty)_ |
| `SITE_STATE` | State/region | _(empty)_ |
| `SITE_WEBSITE_URL` | Public URL of your deployment | _(empty)_ |
| `SITE_PLATFORM_NAME` | Platform display name | `VisionClaw` |
| `SITE_AGENT_NAME` | Default AI assistant name | `Assistant` |
| `SITE_LOGO_URL` | Logo image URL for documents/slides | _(empty)_ |
| `SITE_CONTACT_EMAIL` | Contact form recipient | Falls back to `SITE_OWNER_EMAIL` |
| `PRODUCTION_DOMAIN` | Domain for file URLs | _(empty)_ |
| `ALLOWED_HOSTS` | Comma-separated allowed hostnames | `localhost:5000` |

### Optional — Service Integrations

#### Email (AgentMail)
| Variable | Description |
|----------|-------------|
| `AGENTMAIL_API_KEY` | AgentMail API key |
| `AGENTMAIL_INBOX` | Your inbox address (e.g. `yourbot@agentmail.to`) |
| `AGENTMAIL_USERNAME` | Your AgentMail username |

#### Google Drive
| Variable | Description |
|----------|-------------|
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive folder ID for file storage |

#### Google OAuth (for user-connected Google services)
| Variable | Description |
|----------|-------------|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 2.0 client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 client secret |

#### OpenAI OAuth (for BYOK token flow)
| Variable | Description |
|----------|-------------|
| `OPENAI_OAUTH_CLIENT_ID` | OpenAI OAuth app client ID |

#### Stripe (payments)
| Variable | Description |
|----------|-------------|
| `STRIPE_LIVE_SECRET_KEY` | Stripe secret key |
| `STRIPE_LIVE_PUBLISHABLE_KEY` | Stripe publishable key |

#### Other Integrations
| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | ElevenLabs voice synthesis |
| `FIRECRAWL_API_KEY` | Firecrawl web scraping |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration |
| `DISCORD_BOT_TOKEN` | Discord bot integration |
| `BROWSERLESS_API_KEY` | Browserless PDF generation |

## Step 2: Database Setup

The platform auto-creates all tables on first run. Just ensure `DATABASE_URL` points to a valid PostgreSQL instance.

```bash
npm install
npm run dev
```

The seed script will populate default personas, skills, and platform configuration on first boot.

### GitHub Push (Optional)

| Variable | Description |
|----------|-------------|
| `PUBLIC_GITHUB_REPO` | `YourUser/YourRepo` — used by `push-public.sh` to push clean releases |
| `GITHUB_TOKEN` | GitHub personal access token for push access — **read SECURITY.md → "Self-modification capability" before setting this**. When set, the running platform can `git push` to its own source. Leave unset for safer default deployment posture. |

### Advanced — Seed Control

| Variable | Description | Default |
|----------|-------------|---------|
| `SEED_OWNER_DATA` | Set to `false` to prevent owner-specific seed data from loading. Only relevant if you forked from the original repo and want a clean slate. | Auto-detected |

## Step 3: First-Run Setup

1. Open your deployment URL — fresh deployments auto-redirect to `/setup`
2. The setup checklist shows which services are configured and which need env vars
3. All required items (database, AI provider) should show as "Configured"
4. Click "Create Account" to sign up — the first account becomes the admin
5. Test a conversation with any configured AI provider

## Architecture Overview

- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **AI**: Multi-provider routing (OpenAI, Anthropic, Google, xAI, OpenRouter)
- **16 AI Personas**: VisionClaw, Felix, Forge, Teagan, Blueprint, Chief of Staff, Scribe, Proof, Radar, Neptune, Apollo, Atlas, Cassandra, Luna, Minerva, Robert
- **Hundreds of built-in tools**: Research, documents, email, CRM, code execution, and more
- **180+ database tables**, **500+ production indexes**, **120+ capabilities**, dozens of skills + governance rules, and a curated AI-model registry + 1000+ daily catalog discovery
- See [docs/CURRENT_PLATFORM_TOTALS.md](docs/CURRENT_PLATFORM_TOTALS.md) for the authoritative count.

## Graceful Degradation

Services that aren't configured will gracefully degrade — features are hidden from the UI and tools return clear "not configured" messages:

- No email key → Email, WhatsApp, WhatsApp Approvals hidden from sidebar
- No Telegram token → Telegram page hidden from sidebar
- No Stripe key → Payments page hidden from admin panel
- No Drive folder → files saved locally only, Drive tools return "not configured"
- No ElevenLabs key → voice tools return "not configured"
- No Firecrawl/Browserless keys → scraping tools fall back gracefully
- No Coinbase keys → crypto payment features disabled
- No OAuth IDs → OAuth connection buttons hidden

The `/setup` page provides a real-time checklist showing which services are configured.

## Support

If you encounter issues with your fork, check:
1. All required env vars are set
2. PostgreSQL is accessible
3. At least one AI provider key is valid
4. Console logs for startup errors
