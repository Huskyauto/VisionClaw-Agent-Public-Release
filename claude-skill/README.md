# VisionClaw Claude Code Skill (scaffolding)

This directory contains the v0.1 scaffolding for publishing VisionClaw as a public **Claude Code / Cursor / Gemini CLI / Codex skill** — a one-line install (`npx skills add Huskyauto/visionclaw`) that teaches any AI coding agent how to delegate work to the hosted VisionClaw platform.

Inspired by [HeyGen's Hyperframes skill distribution model](https://github.com/heygen-com/hyperframes) — they made themselves discoverable inside every AI developer's IDE by registering as a slash command.

## What's here

- `visionclaw/SKILL.md` — the v0.1 skill content (covers auth, 4 core endpoints, agent roster, prompt patterns, anti-patterns)

## What's left to do before publishing publicly

1. **Stand up the public API endpoints** referenced in SKILL.md:
   - `POST /api/agents/dispatch` — currently internal; needs auth-scoped public surface
   - `GET /api/agents/jobs/:id` — same
   - `GET /api/agents/jobs/:id/stream` (SSE) — same
   - `GET /api/docs` — OpenAPI / docs page so external agents can discover the contract
2. **Build an API-key issuance UI** at `/settings/api-keys` (currently no public-facing key system exists)
3. **Create a separate public GitHub repo** `Huskyauto/visionclaw-skill` and split this directory into it
4. **Submit to the [vercel-labs/skills](https://github.com/vercel-labs/skills) registry** so `npx skills add Huskyauto/visionclaw` works
5. **Publish companion skills**: `visionclaw-research`, `visionclaw-deliverables`

This work is parked — see "Hyperframes Nuggets (Apr 21, 2026)" in `replit.md` for the full ranking and rationale.

## Distribution parity target: agentic-stack adapter contract

When this work is revived, ship the skill so it drops cleanly into [`codejunkie99/agentic-stack`](https://github.com/codejunkie99/agentic-stack) (Apache 2.0, ~900 stars as of Apr 2026). That gets us free distribution to every project running `agentic-stack claude-code | cursor | windsurf | opencode | openclaw | hermes | pi | standalone-python` instead of inventing our own per-harness packaging.

**What their adapter expects** (pattern from `adapters/openclaw/config.md` and `adapters/claude-code/`):

1. A **system-prompt include** that tells the agent to read this skill at session start, in a fixed order (map → preferences → lessons → permissions).
2. A **trigger list** for when to invoke the skill ("deploy / migration / refactor / debug / failing test" etc — for us: research, video gen, agent dispatch, deliverables packaging).
3. A **recall hook** the host agent runs before non-trivial tasks — for us, `GET /api/agents/recall?intent=...` returning ranked prior-job summaries with citations.
4. A **memory-reflect hook** the host agent calls after significant actions — for us, `POST /api/agents/reflect` writing a compact lesson back to the platform.
5. **Hard rules block** — no force-push to `main`/`production`/`staging`; explicit "blocked means blocked" language.

**Concrete parity checklist when reviving:**
- [ ] Author `claude-skill/visionclaw/SKILL.md` startup section in their `Startup (read in order)` format
- [ ] Add `recall` and `reflect` endpoints to the public API (alongside `dispatch` / `jobs`)
- [ ] Author an `adapters/openclaw-system.md` style system-prompt include (single file, pasteable)
- [ ] Submit a PR to `codejunkie99/agentic-stack` adding `adapters/visionclaw/` with the same shape as `adapters/openclaw/`
- [ ] Confirm `agentic-stack visionclaw` would install our skill alongside their `.agent/` folder without conflict
