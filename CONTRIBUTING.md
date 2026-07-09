# Contributing to VisionClaw Agent

Thanks for your interest in contributing! This project welcomes contributions of all kinds — bug fixes, new tools, documentation improvements, and feature ideas.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Follow the setup instructions in [FORK-SETUP.md](FORK-SETUP.md)
4. Create a feature branch: `git checkout -b my-feature`
5. Make your changes
6. Test locally to make sure everything works
7. Commit with a clear message describing what you changed
8. Push to your fork and open a Pull Request

## How public-mirror contributions are merged

**Read this before you invest time.** This GitHub repository is a **public
mirror** of a private development repository. Each tagged release is a sanitized
snapshot, which has two implications for contributors:

1. **PRs opened against this mirror will be wiped on the next snapshot
   unless the change is also replayed into the private repo.** That replay
   is the maintainer's responsibility, not yours — but be aware that your
   PR's specific commit hash will not survive long-term.
2. **Authorship is preserved via `Co-Authored-By:` trailers** in the
   snapshot commit produced by `scripts/build-public-mirror.sh`.

The flow is:

1. Open a PR against this mirror as usual.
2. The maintainer reviews it here.
3. If accepted, the change is replayed into the private repo with a
   `Co-Authored-By: <your name> <your email>` trailer.
4. The next public mirror snapshot republishes the change with attribution.
5. Expect a 1–2 week lag between approval and the change appearing on
   `main` of this mirror.

If your change is large (>200 LOC), security-sensitive, or modifies the
public API, please **open a GitHub Discussion or Issue first** so the
maintainer can confirm the replay strategy before you invest the time.

## What We're Looking For

- **Bug fixes** — Found something broken? Fix it and send a PR.
- **New tools** — VisionClaw has 395 tools. If you build a useful one, we want it. See "How to add a new tool" below for the recipe. (Authoritative counts live in [docs/CURRENT_PLATFORM_TOTALS.md](docs/CURRENT_PLATFORM_TOTALS.md) — please update there first.)
- **Documentation** — Clearer explanations, better examples, typo fixes — all welcome.
- **Performance improvements** — Faster queries, better caching, reduced token usage.
- **New integrations** — Connect a new service or API provider.
- **UI/UX improvements** — Better layouts, accessibility fixes, responsive design.

## Code Style

- TypeScript throughout (frontend and backend)
- Use existing patterns — look at how similar features are implemented before adding new ones
- Keep changes focused — one feature or fix per PR
- Add `data-testid` attributes to interactive and display elements

## How to add a new tool

Tools are the verbs the agent team uses. They live in `server/tools.ts` and are grouped by category. **Full guide with a copy-paste template: [docs/adding-a-tool.md](docs/adding-a-tool.md); a standalone runnable example lives at [`server/tools/example-tool.ts`](server/tools/example-tool.ts).**

> ⚠️ **Note:** `server/tools.ts` is ~20,000 lines / ~1.2 MB, so GitHub's web viewer refuses to render it inline (it shows *"we can't show files that are this big"* and can look empty). It is **not** empty or stubbed — view it via the [raw URL](https://raw.githubusercontent.com/Huskyauto/VisionClaw-Agent-Public-Release/main/server/tools.ts) or `git clone`.

The short version is a 4-step recipe:

1. **Pick a snake_case name** that an LLM would intuitively reach for (e.g. `forecast_ticker`, `analyze_portfolio`). Open an issue with the **"New tool proposal"** template first if you'd like maintainer feedback before writing code.
2. **Add the OpenAI tool definition** in `server/tools.ts`:
   ```ts
   {
     type: "function",
     function: {
       name: "your_tool",
       description: "1-3 sentences telling the LLM exactly when to call this. Be specific about inputs, outputs, and when NOT to use it.",
       parameters: { /* JSON Schema */ },
     },
   }
   ```
3. **Implement the handler** alongside the definition. Keep it pure where possible. Throw on hard failure — the platform's 3-layer recovery will handle retries.
4. **Decide voice-safety.** If the tool is read-only, idempotent, sub-second, and has no destructive side effects, add it to the Glasses Gateway allowlist (look for `VOICE_SAFE_TOOLS` in the codebase). If you're unsure, leave it off — voice-safety is opt-in by design.

For tools that need cost tracking, route any OpenAI client construction through `createMeteredOpenAIClient` in `server/providers.ts` instead of constructing `new OpenAI({...})` directly. This keeps the agent cost ledger accurate.

## How to add a new persona

1. Insert the persona row via `psql $DATABASE_URL` (the codebase uses direct ALTER, not drizzle-kit push, for production-shaped data). See `scripts/seed.ts` for the existing personas as examples.
2. Add the persona to `client/src/pages/about.tsx` `PERSONAS` array so it shows up on the About page.
3. If the persona has a unique role on the agent diagram, add a node in `client/src/pages/agent-diagram.tsx`.

## How to add a new skill

Skills are LLM-callable instruction blocks (in contrast to tools, which are code-callable). Add a row to the `skills` table with a name, description, and the prompt content. They appear automatically in the skills marketplace and are eligible for per-tenant disable lists.
- Use the `siteConfig` pattern for any platform branding (never hardcode company names)

## Architecture Notes

- **Frontend:** React 18 + Vite + TailwindCSS + shadcn/ui
- **Backend:** Express.js + Drizzle ORM + PostgreSQL
- **AI:** Multi-provider (OpenAI, Anthropic, xAI, Google, Perplexity, OpenRouter)
- **Tools** are defined in `server/tools.ts` — follow the existing pattern
- **Routes** live in `server/routes.ts` — keep route handlers thin, use the storage interface for data operations

## Pull Request Guidelines

- Describe what your PR does and why
- Reference any related issues
- Make sure the app starts without errors
- Test the feature you changed
- Keep PRs reasonably sized — large PRs are harder to review

## Reporting Issues

Open a GitHub Issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (OS, Node version, database)

## Questions?

Open a Discussion on GitHub or reach out via the contact info in the README.
