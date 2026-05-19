# Contributing

VisionClaw is a single-owner production platform first, an open-source repo
second. PRs are welcome but read this before opening one — it'll save us both
a round-trip.

## Hard Rules

1. **Never commit secrets.** The push helper `bash /tmp/push-gh.sh` scans
   tracked files for 10+ secret patterns and refuses if any match. Run it
   before opening a PR. If your editor saved a `.env` somewhere, the scanner
   will catch it.
2. **Never break tenant isolation.** Every table that holds tenant-owned
   data has `tenant_id` `.notNull()` with no default. Every storage call
   must thread tenantId. The tests in
   [`tests/storage/tenant-isolation.test.ts`](../tests/storage/tenant-isolation.test.ts)
   guard this — keep them green.
3. **Never weaken `isAdminRequest`.** No anonymous bypass, no PIN-absent
   auto-admin. Tests in
   [`tests/security/admin-gate.test.ts`](../tests/security/admin-gate.test.ts).
4. **Never bypass `isSafeUrl` + `isSafeDns`** when adding new fetch surfaces.
   See [`SECURITY.md`](./SECURITY.md#ssrf-defense). Tests in
   [`tests/security/ssrf.test.ts`](../tests/security/ssrf.test.ts).
5. **Default-OFF auto-ship for new SKUs.** Per Bob's principle: every new
   service product ships with manual review until proven. Don't override.

## Getting Set Up

```bash
git clone https://github.com/Huskyauto/VisionClaw-Agent.git
cd VisionClaw-Agent
npm ci

# Required: Postgres + at least one model key
export DATABASE_URL=postgres://localhost/visionclaw
export SESSION_SECRET=$(openssl rand -hex 32)
export OPENAI_API_KEY=sk-...
export OWNER_ALERT_EMAIL=you@example.com

npx drizzle-kit push   # apply schema
npm run dev            # http://localhost:5000
```

## Running the Tests

```bash
# Hard gates (mirror CI):
npm run build
bash tests/run.sh

# Informational:
npm run check 2>&1 | grep -c "error TS"
```

If you add a new test file, append it to [`tests/run.sh`](../tests/run.sh)
*and* glob it from [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Adding a Tool

1. Define the tool in `server/tools.ts` (the registry).
2. Implement the handler — keep handlers thin; push business logic into a
   purpose-named module.
3. Tag the tool with the right scope (`chat`, `read`, `tools`, or `admin`).
   Anything that mutates platform-wide config must be `admin`.
4. If the tool fetches arbitrary URLs, route through `isSafeUrl()` +
   `isSafeDns()`.
5. If the tool emits LLM-shaped output you'll then execute, write a
   validator like `validateRules()` in
   [`server/structured-extraction.ts`](../server/structured-extraction.ts).
6. Add a test under `tests/security/` for whatever new attack surface you
   opened up.

## Adding a Persona

Personas are seeded in code and in DB. Bump the count in
[`docs/FEATURES.md`](./FEATURES.md), [`README.md`](../README.md), and the
auto-generated `VisionClaw-Comprehensive-Features.txt`.

## Adding a Skill

Read [`.local/skills/skill-authoring/SKILL.md`](../.local/skills/skill-authoring/SKILL.md).
Skills go in either `.local/skills/` (Replit-managed) or `.agents/skills/`
(user-authored).

## Commit & PR

- Conventional-ish commit messages (verb-first, brief). The post-edit
  pipeline will re-write the auto-backup commit message anyway, so don't
  agonize.
- Reference the round you're working in if applicable
  (e.g., "Round 15 — split routes.ts into auth / chat / tool slices").
- Open the PR against `main`.

## Code Style

- TypeScript strict mode is the goal — we have a tracked burn-down (see
  [`EVIDENCE.md`](./EVIDENCE.md#ci-informational-tracked-burn-down)).
  Don't make it worse.
- No new `any` types in new code unless there's a real reason.
- Keep `server/routes.ts` from growing. New endpoints get their own
  module under `server/` and are mounted via a one-liner.

## Releasing

The post-edit pipeline ([`.agents/skills/post-edit-pipeline`](../.agents/skills/post-edit-pipeline))
runs after every editing session: code review, replit.md update, GitHub
push, comprehensive features PDF + text regen, Drive upload, owner email.
Run it with: *"run the post-edit pipeline"* — the agent handles the rest.
