# Local Quickstart — 5 minutes from `git clone` to a running platform

This is the fastest path to a working VisionClaw on your laptop. For Replit
deploys, see the **Deploy** table at the top of [README.md](../README.md).
For all configuration knobs, see [FORK-SETUP.md](../FORK-SETUP.md).

---

## Prerequisites

- **Node.js 20+** — `node --version` should print `v20.x.x` or higher.
- **Postgres 14+ with pgvector** — local install, Docker, Render, Railway,
  Neon, or Supabase all work.
- **One AI provider key** — OpenAI is the simplest; Anthropic, xAI, or
  OpenRouter all work too.

---

## 1. Clone

```bash
git clone https://github.com/Huskyauto/VisionClaw-Agent-Public-Release.git
cd VisionClaw-Agent-Public-Release
npm install
```

The install pulls ~600 MB of dependencies and takes 1–2 minutes on a
typical home connection.

## 2. Postgres with pgvector

**Option A — Docker (fastest):**

```bash
docker run -d --name vc-pg \
  -e POSTGRES_PASSWORD=visionclaw \
  -p 5432:5432 \
  pgvector/pgvector:pg16

export DATABASE_URL="postgresql://postgres:visionclaw@localhost:5432/postgres"
```

**Option B — local Postgres:**

```bash
# macOS
brew install postgresql@16 pgvector
brew services start postgresql@16

# Ubuntu / Debian
sudo apt install postgresql-16 postgresql-16-pgvector

# Then enable the extension on your database:
psql -d your_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
export DATABASE_URL="postgresql://localhost/your_db"
```

**Option C — managed (Neon / Render / Railway / Supabase):**

Provision the database in their dashboard, copy the connection string,
and set:

```bash
export DATABASE_URL="postgres://...your-managed-url..."
```

All four providers support pgvector — enable it via their UI or run
`CREATE EXTENSION vector;` in their SQL console.

## 3. The two required env vars

```bash
export SESSION_SECRET="$(openssl rand -hex 32)"
export OPENAI_API_KEY="sk-..."
```

That's it for required config. Everything else is optional and degrades
gracefully — pages and tools that need a missing key just hide themselves
or return a clear "not configured" message.

If you'd rather use Anthropic, xAI, or OpenRouter as your primary
provider, swap the key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# or
export XAI_API_KEY="xai-..."
# or
export OPENROUTER_API_KEY="sk-or-..."
```

## 4. Boot

```bash
npm run dev
```

Watch the startup log. You should see, in order:

1. `[db] migration check: no schema changes`
2. `[seed] 100 tables verified`
3. `[seed] 40 governance rules ensured`
4. `[seed] 16 personas ensured`
5. `[providers] cost-tracking wrapper installed`
6. `[heartbeat] engine started`
7. `serving on port 5000`

## 5. First-run setup

Open http://localhost:5000 — fresh deployments auto-redirect to `/setup`.

The setup checklist shows real-time status of every integration:

- **Required** items should all show ✅ Configured.
- **Optional** items show 🔵 Not configured with a one-line description
  of what they unlock.

Click **Create Account**. The first account becomes the platform admin.

You're done. Try one of the prompts from the README:

> "Research the top 5 competitors in [your industry] and build me a
> comparison spreadsheet."

The default agent picks it up, routes through the Radar (intelligence)
and Atlas (metrics) personas, and delivers a download link.

---

## Adding more capabilities later

Every optional integration follows the same pattern: set the env var,
restart the server, and the corresponding page appears in the sidebar
or the corresponding tool stops returning "not configured".

Common next adds:

| Capability | Env vars |
|---|---|
| Branded PDFs | `BROWSERLESS_API_KEY` |
| Voice (TTS) | `ELEVENLABS_API_KEY` |
| Web scraping | `FIRECRAWL_API_KEY` |
| Email | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX`, `AGENTMAIL_USERNAME` |
| Google Drive storage | `GOOGLE_DRIVE_ROOT_FOLDER_ID` + OAuth |
| Stripe payments | `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_PUBLISHABLE_KEY` |

Full list: [FORK-SETUP.md](../FORK-SETUP.md).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `error: extension "vector" is not available` | pgvector not installed on your Postgres | See step 2; for managed Postgres, enable in the dashboard. |
| App boots but `/setup` shows DB unreachable | `DATABASE_URL` not exported in the shell that ran `npm run dev` | Re-run `export` in the same shell. |
| `Empty AI responses` | Wrong key or out-of-credit | Verify the key is valid and has balance. |
| Port 5000 in use | Another service is on that port | Stop it, or set `PORT=3000` and restart. |
| Drive tool returns "not configured" | No Google OAuth set up | Files save to local `./uploads/` instead — add `GOOGLE_DRIVE_*` env vars to enable Drive. |

---

For deployment to Render, Railway, Fly.io, or Replit, see the **Deploy**
section of [README.md](../README.md). For the complete env-var reference,
see [FORK-SETUP.md](../FORK-SETUP.md). For what's intentionally not
supported yet, see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
