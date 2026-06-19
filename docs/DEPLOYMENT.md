# Deployment

VisionClaw is a single-port Express + Vite app. It runs anywhere Node 20+
runs, but we maintain three first-class targets:

1. **Replit** (current production — `agenticcorporation.net`)
2. **Docker** (multi-stage, non-root, ~slim runtime)
3. **Plain VPS / bare metal** (Node 20 + Postgres 14+)

---

## Prerequisites (all targets)

- **Node.js 20 or newer**.
- **PostgreSQL 14+** with the `pgvector` extension (used by the memory and
  embedding subsystems). Replit's managed Postgres ships with pgvector
  enabled.
- A model provider key — *one* of these is enough to start:
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENROUTER_API_KEY`
  - `XAI_API_KEY`

The platform degrades gracefully when optional providers are missing — it
just routes to whichever ones are configured.

### Optional integrations

Drop these in only as you need them. None block boot.

| Env var | Enables |
|---|---|
| `STRIPE_LIVE_SECRET_KEY` + `STRIPE_LIVE_PUBLISHABLE_KEY` | Storefront, paid services, customer-delivery loop |
| `COINBASE_COMMERCE_API_KEY` | Crypto checkout for autonomous-budget refills |
| `ELEVENLABS_API_KEY` | Voice synthesis tools |
| `BROWSERLESS_API_KEY` | HTML-to-PDF deliverables, browser automation |
| `FIRECRAWL_API_KEY` | Crawl-class extraction (`template_scrape` works without it) |
| `X_*` (4 keys) | X/Twitter posting + listening |
| Replit-installed connectors | Google Drive, Sheets, Mail, Calendar, OneDrive |

### Required env vars

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Long random string (≥ 32 bytes) for session signing |
| `OWNER_ALERT_EMAIL` | Where the platform sends owner-only alerts |

---

## Replit (recommended for fastest start)

VisionClaw was built on Replit and the deploy story is one click.

1. Fork or clone into a Replit workspace.
2. Add the secrets above via the Secrets tab. Postgres is provisioned
   automatically — `DATABASE_URL` is injected.
3. The `Start application` workflow runs `npm run dev`. The first start runs
   `db:push` automatically and seeds the registry.
4. Hit *Publish* — Replit handles TLS, custom domain, and health checks.
5. Webhook URLs to register in your providers:
   - Stripe → `https://<your-domain>/api/webhooks/stripe`
   - Coinbase Commerce → `https://<your-domain>/api/webhooks/coinbase`

---

## Docker

The provided [`Dockerfile`](../Dockerfile) is a two-stage build:

- **Stage 1 (`build`)** — installs full deps, runs `npm run build`, prunes
  dev deps.
- **Stage 2 (`runtime`)** — copies only `dist/`, pruned `node_modules`, and
  the schema files needed at runtime. Runs as non-root user `visionclaw`
  (uid 10001). Includes a `HEALTHCHECK` against `/healthz`.

```bash
docker build -t visionclaw .
docker run -d --name visionclaw \
  -p 5000:5000 \
  -e DATABASE_URL="postgres://..." \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e OPENAI_API_KEY="sk-..." \
  -e OWNER_ALERT_EMAIL="you@example.com" \
  visionclaw
```

The container is intentionally minimal — no `git`, no `python`, no shell
utilities beyond `node` itself. If you need a tool, add it explicitly to the
Dockerfile rather than reaching for a base image with everything pre-installed.

### Running migrations

`npm run build` does **not** run migrations. On first boot (and on every
schema change) run:

```bash
docker exec visionclaw npx drizzle-kit push
```

Or wire it into your container's entrypoint if you want auto-migration.

---

## Plain VPS / bare metal

```bash
# 1. Postgres
sudo apt install postgresql-14 postgresql-14-pgvector
sudo -u postgres createdb visionclaw

# 2. Node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs

# 3. App
git clone https://github.com/Huskyauto/VisionClaw-Agent.git
cd VisionClaw-Agent
npm ci
npm run build

# 4. Schema
DATABASE_URL=postgres://localhost/visionclaw npx drizzle-kit push

# 5. Process supervision (systemd recommended)
sudo cp deploy/visionclaw.service /etc/systemd/system/
sudo systemctl enable --now visionclaw
```

Run behind nginx/Caddy for TLS termination. The app listens on `PORT`
(default 5000), serves both API and static frontend on the same port.

---

## Health Checks & Observability

- `GET /healthz` — liveness probe. Returns 200 once the registry is loaded
  and the DB ping succeeds.
- `GET /api/system/health` — detailed JSON across 6 subsystems (DB,
  providers, sessions, tokens, queues, storage). Admin-only.
- Heartbeat watchdog runs every 60s and auto-clears stalled runs / expired
  approvals.
- Health monitor sweep every 300s.

---

## Backup & Restore

VisionClaw stores everything in Postgres + the `uploads/` directory. A
backup is therefore:

```bash
pg_dump $DATABASE_URL > visionclaw-$(date +%F).sql
tar czf visionclaw-uploads-$(date +%F).tgz uploads/
```

Restore is the inverse. The `.service-review-queue.json` file inside
`uploads/` is the live service-review state — back it up with the rest.

---

## Going to Multi-Replica

**Today: single replica only.** Two in-process mutexes (`withQueueLock`,
`withRecipeLock`) serialize JSON-file RMW for the service-review queue and
the template-scraper recipe cache. Multi-replica deploys would re-introduce
lost-update races on those two files.

Before scaling out, migrate both to Postgres advisory locks or move the JSON
state into proper tables. Tracked in
[`EVIDENCE.md`](./EVIDENCE.md#known-limitations).

---

## Hardening Checklist for Production

- [ ] `SESSION_SECRET` is ≥ 32 random bytes and rotated quarterly
- [ ] Postgres connections use TLS
- [ ] Container runs as non-root (default in our Dockerfile)
- [ ] Stripe webhook signature verification confirmed live
- [ ] Backup pipeline exercised (restore drill)
- [ ] `OWNER_ALERT_EMAIL` is monitored
- [ ] `agenticcorporation.net`-equivalent custom domain wired with TLS
- [ ] Auto-ship policies left at default OFF until the SKU has graduated
