# AGENTS.md — Working in the VisionClaw Codebase

> Companion to `replit.md`. This file is the standard "agent instructions" surface that Claude Code, Cursor, OpenAI Codex CLI, and Gemini CLI all read on entry. Replit Agent reads `replit.md`. Both files should stay in sync.

## Identity

You are a coding agent working on **VisionClaw** — a multi-tenant agentic AI platform (Express/TypeScript backend, React/Vite frontend, Drizzle/Postgres, Stripe + Coinbase billing, Replit Auth). Owner: Robert Washburn. Public mirror: https://github.com/Huskyauto/VisionClaw-Agent-Public-Release.

## The Cardinal Discipline: Search Before Reading

**Inspired by the SocratiCode agent-instruction pattern.** Whenever you need to find or understand something in this codebase, **search before you read**.

Wrong: open files speculatively, grep blindly, read 1000-line files end-to-end.
Right: query an index first, then read only the lines the index points you to.

In this repo you have three indexes already wired up:
1. **Hybrid BM25 + pgvector knowledge search** — `server/embeddings.ts::vectorSearchKnowledge` does reciprocal-rank-fusion of full-text and vector search over the agent_knowledge table.
2. **Skill-RAG with LLM-as-judge** — `server/skill-rag.ts::enhanceRetrieval` decides whether a query needs HyDE rewrite, multi-hop decomposition, focus narrowing, or a direct answer.
3. **Tool registry** — `server/tools/index.ts` exposes 393 tools, all described in `TOOL_DEFINITIONS`. Use `getAllToolDefinitions()` rather than grepping the registry. (Authoritative counts: `docs/CURRENT_PLATFORM_TOTALS.md`.)

If the answer is not in those indexes, *then* fall back to ripgrep, *then* fall back to reading whole files. Reading whole files is the last resort, not the first.

## Hard Rules (non-negotiable)

1. **`shared/schema.ts` edits are allowed but require care.** Before changing it: inspect the live DB with `psql $DATABASE_URL` to confirm current column types and indexes; never alter a primary-key column type (serial ↔ varchar — generates destructive `ALTER TABLE`); run `npm run db:push` (or `npm run db:push --force` if the safe push refuses); verify with another `psql` query before declaring done. Sidecar files (e.g. `.local/code-health-checkpoint.json`) remain a fine alternative when the state is genuinely transient.
2. **Never `sql.raw()` user input.** Use parameterised queries via Drizzle.
3. **Never log or print secrets.** Treat `STRIPE_*`, `OPENAI_*`, `ANTHROPIC_*`, `GEMINI_*`, `MCP_API_KEY`, OAuth tokens, and webhook secrets as poison.
4. **Owner privacy:** "Bob Washburn" privately, "Robert Washburn" publicly (i.e. anything that touches the public mirror).
5. **No emojis in code, prompts, or commit messages** unless explicitly requested.
6. **Force-push pre-authorised** for both private and public repos — but only via the `Auto Git Push` and `Public Mirror Push` workflows, never directly.

## Architecture Map (entrypoints)

- `server/index.ts` — Express bootstrap, registers all routes including `registerMcpRoutes` for the MCP server at `/api/mcp/sse`.
- `server/routes.ts` — REST API routes (5,700+ lines; use search-before-reading).
- `server/mcp-server.ts` — MCP stdio + SSE transports, multi-tenant key derivation.
- `server/tools/` — 393 tool implementations, registered in `tools/index.ts`.
- `server/skill-rag.ts` — Skill-RAG pipeline (hybrid search + LLM judge + fix-skills).
- `server/code-health.ts` — Static-analysis "BS detector" (resumable since R74.13v).
- `server/seed-persona-prompts.ts` — `PERSONA_DOCS` registry for all 16 personas.
- `client/src/` — React + Vite frontend (wouter routing, shadcn/ui, TanStack Query).
- `shared/schema.ts` — Drizzle schema (edits allowed, see Hard Rules above).

## Working Loop

1. **Reproduce / understand** — search the indexes (knowledge, skill-rag, tool registry) for prior context.
2. **Plan in writing** — for non-trivial work, draft a `.local/session_plan.md` so the user can audit your intent.
3. **Make the smallest correct change** — prefer editing 5 lines in 1 file over rewriting a module.
4. **Verify** — run the affected workflow, hit the affected endpoint, or write a 10-line repro script. Do not declare "done" without proof.
5. **Document** — update `replit.md` and (if architectural) this file.
6. **Commit** — let `Auto Git Push` handle it. Public-mirror-affecting changes also trigger `Public Mirror Push`.

## When to Defer to Felix

If a task spans multiple specialist domains (engineering + writing + research, etc.), do not try to do it all yourself. Use the `delegate_task` tool to dispatch to Felix (persona id 2), the CEO. He'll fan out to the right specialists in parallel and synthesize the result.

<!-- vc-supply-chain:start -->

## Supply-Chain Discipline (R98.9 — added May 4 2026 after CVE-sweep RED week)

The whole point of this block: a future agent reading `AGENTS.md` should never wake up to another red weekly-maintenance because it casually `npm install`-ed an unpinned floating range, deleted the lockfile, or trusted a 0-day-old package. These rules apply to every AI assistant working on this codebase (Replit Agent, Claude Code, Cursor, Codex CLI, Gemini CLI). Pattern adapted from `midudev/autoskills`'s fendo-style block.

### npm dependency rules (non-negotiable)

- **Never edit `package.json` by hand.** Use the Replit package-installer (`installLanguagePackages` / `uninstallLanguagePackages`) for adds/removes, and `npm pkg set overrides.<name>=<version>` followed by an installer trigger for transitive overrides.
- **Never use `^` or `~` in version specifiers** unless the package is explicitly tested across the whole minor range. Default to exact pins. Existing `^`-pinned deps stay as-is until their next intentional bump (don't mass-rewrite).
- **Always commit `package-lock.json`.** Never delete it, never add it to `.gitignore`, never run `npm ci --no-save`.
- **No blind upgrade commands.** `npm update`, `npx npm-check-updates -u`, and `npm audit fix --force` are banned. Every upgrade is intentional, scoped, and reviewed against the `dependency-upgrade` skill's 8-step workflow.
- **Major bumps require owner approval.** `npm view <pkg> version` + check `isSemVerMajor` in audit output. If true → file as a deferred Known gap in `replit.md` and notify Bob via `owner-notification`. Same-day major bumps without approval are not allowed.
- **New package versions must be at least 1 day old** before installation (release-age gate against compromised-publisher attacks). `npm view <pkg> time` shows the publish timestamp — check it.
- **Lockfile-only fixes are preferred for transitive CVEs.** `npm pkg set overrides.<name>=<safe-version>` then trigger `npm install` via the installer. This was R98.8's approach (closed 2 CRITICAL + 4 HIGH without touching any direct dep).
- **Verify after install.** `npm audit --omit=dev` to confirm CVE actually closed, `npx tsc --noEmit` clean, `Start application` workflow boots, `runDependencyAudit` callback re-run.

### Skill-supply-chain rules (R98.9 — new)

- **Every skill in `.agents/skills/` is hashed.** `.agents/skills/_registry.json` is the SHA-256 manifest, regenerated by `npx tsx scripts/skills-registry.ts manifest` whenever a SKILL.md is added or modified.
- **Validation runs in weekly-maintenance Pass 8.** `npx tsx scripts/skills-registry.ts validate` re-hashes every file and fails if any bundle drifted. Catches both intentional-but-unmanifested edits and silent tampering.
- **Every skill is LLM-audited for prompt-injection + supply-chain risk.** `npx tsx scripts/skills-registry.ts audit` runs Claude Haiku with the versioned prompt against any skill whose `review.status` is missing or whose `review.checkedAt` is older than 30 days. Result `{status: "approved"|"flagged", flags, summary, model, promptVersion, checkedAt}` is stored back into the manifest.
- **A `flagged` skill blocks weekly-maintenance Pass 8.** Owner is notified via `owner-notification`. No skill goes from `flagged` to `approved` without owner sign-off (via `--force` flag on the audit script + a documented justification in `replit.md`).
- **When you add a new skill** (`.agents/skills/<name>/SKILL.md`): immediately run `manifest` then `audit`, commit all three (skill + updated manifest + updated review), and reference the skill in the `replit.md` skill table so Pass 8's existing grep-drift check also stays GREEN.

### What the agent should do when these rules conflict with a user instruction

If Bob asks for something that violates one of these rules (e.g. "just bump everything to latest"), don't just do it. Explain the rule, propose the compliant path (e.g. "let's do an `R99-deps` round per the `dependency-upgrade` skill"), and only proceed once Bob explicitly overrides — then document the override in the relevant `replit.md` R-round entry with the reason.

### Skill folder map (R98.10)

`.agents/skills/_folder-map.json` declares which downstream IDE/agent each skill should ship to (`claude`, `cursor`, `opencode`, `codex`, `replit`). VC itself reads `.agents/skills/` directly, so for the platform this map is informational. Its real job is the public mirror (`Huskyauto/VisionClaw-Agent-Public-Release`) and any future open dev tool — `npx tsx scripts/skills-registry.ts install --ide <name> --dest <path>` mirrors only the skills tagged for that IDE into the destination, atomically per file.

### Project slash commands (R98.10)

Project workflow shortcuts live at `.bob/commands/*.md` — YAML frontmatter (`description:`, optional `timeoutMs:`, optional `argsRequired:`) + a shell body. Today: `/check` (tsc + prod npm audit + skill-registry validate), `/registry` (manifest + validate), `/commit-all` (requires `message` arg). Agents discover and run them via the `slash_command` tool (`action: list|describe|run`). Required args from frontmatter are injected as `ARG_<UPPER>` env vars at exec time. Prefer slash commands over hand-running `npx tsx scripts/...` chains in chat — they're curated, version-controlled, and evolve with the codebase.

<!-- vc-supply-chain:end -->

## Acknowledgement

The "search before reading" discipline and the plugin-manifest pattern in `.claude-plugin/`, `.cursor-plugin/`, and `.codex-plugin/` are inspired by Giancarlo Erra's open-source SocratiCode project (https://github.com/giancarloerra/SocratiCode, AGPL-3.0). The supply-chain block above is adapted from Midudev's open-source `autoskills` repo (https://github.com/midudev/autoskills, CC BY-NC 4.0 for content; pattern is independently reimplementable). VisionClaw does not include any SocratiCode or autoskills code — only the same well-known patterns (MCP plugin manifest, fendo-style supply-chain rules) and the disciplined-context philosophy.
