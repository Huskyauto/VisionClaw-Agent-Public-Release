# Quickstart — Run VisionClaw with Docker

This is the fastest path from a clean machine to a running instance. It needs
**only Docker** (with the Compose plugin) — no Node, no Postgres, no local
toolchain.

If you would rather run it natively with Node, see [FORK-SETUP.md](FORK-SETUP.md).

---

## Prerequisites

- Docker Engine 20.10+ with the Compose plugin (`docker compose version`).
- ~2 GB free disk for the images.

That's it.

## 1. Get the code

```bash
git clone <this-repo-url> visionclaw
cd visionclaw
```

## 2. Create your `.env`

```bash
cp .env.example .env
```

Open `.env` and set the **three** values you truly need to boot. Everything
else has a safe default or is optional:

| Variable | Why | Example |
|---|---|---|
| `POSTGRES_PASSWORD` | Password for the bundled Postgres container. | any strong string |
| `SESSION_SECRET` | Signs login sessions. | `openssl rand -hex 32` |
| One LLM key | The agents need a model provider. Any **one** of these is enough to start. | `OPENAI_API_KEY=sk-...` |

> The `docker-compose.yml` reads `POSTGRES_PASSWORD` and constructs
> `DATABASE_URL` for the app container automatically — you do **not** need to
> hand-build a connection string.

Optional but recommended for a real workout: add provider keys for Anthropic
(`ANTHROPIC_API_KEY`) and Google (`GOOGLE_API_KEY`) so multi-provider routing
has somewhere to route.

## 3. Boot it

```bash
docker compose up --build
```

The first build takes a few minutes. When it finishes you'll see the app
container come up and run database migrations on first boot.

## 4. Open it

```
http://localhost:5000
```

Health check (should return `ok`):

```bash
curl -fsS http://localhost:5000/healthz
```

---

## What just happened

`docker-compose.yml` starts two services:

1. **`db`** — `pgvector/pgvector:pg16` (Postgres 16 with the `vector` extension
   the schema requires).
2. **`app`** — the VisionClaw server + built frontend on a single port (`5000`).

The app applies its schema on startup, so the first boot is the slow one.

## Common issues

| Symptom | Fix |
|---|---|
| `port 5000 already in use` | Stop whatever owns 5000, or change the published port in `docker-compose.yml`. |
| `type "vector" does not exist` | You changed the `db` image away from `pgvector/pgvector`. Put it back — vanilla `postgres:16` lacks pgvector. |
| App boots but agents error on every call | No LLM key set. Add at least one provider key to `.env` and `docker compose up` again. |
| Want a clean slate | `docker compose down -v` (the `-v` drops the database volume). |

## Verify it's the real thing

This same Docker boot path is exercised on every commit by the `docker` CI job
(a **hard gate**) in `.github/workflows/ci.yml`: it builds the image, runs it
against a real Postgres, and fails the build if `/healthz` doesn't answer. See
[`docs/TRUST-RECEIPTS.md`](docs/TRUST-RECEIPTS.md).
